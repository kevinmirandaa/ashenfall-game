import { randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { inTransaction, isUniqueViolation } from '../db/transaction.js';
import { activeMatchOf, createMatchInTransaction } from '../matches/start.js';
import { ProblemError } from '../problem.js';

export type Visibility = 'public' | 'private';

export interface RoomView {
  readonly id: string;
  readonly visibility: Visibility;
  readonly status: 'open' | 'started' | 'closed';
  readonly capacity: number;
  readonly ownerId: string;
  /** Solo lo ven los miembros de la sala. */
  readonly inviteCode?: string;
  readonly members: readonly { readonly userId: string; readonly displayName: string; readonly ready: boolean }[];
  readonly matchId: string | null;
}

interface RoomRow {
  id: string;
  owner_id: string;
  visibility: Visibility;
  invite_code: string | null;
  capacity: number;
  status: RoomView['status'];
  match_id: string | null;
}

// Sin 0/O ni 1/I, para que el código se pueda dictar sin ambigüedad.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const notFound = (): ProblemError => new ProblemError(404, 'ROOM_NOT_FOUND', 'La sala no existe');
const alreadyInRoom = (): ProblemError => new ProblemError(409, 'ALREADY_IN_ROOM', 'Ya estás en una sala');

function newInviteCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export class RoomService {
  constructor(private readonly pool: pg.Pool) {}

  async create(userId: string, visibility: Visibility): Promise<RoomView> {
    return inTransaction(this.pool, async (client) => {
      await this.assertNotInMatch(client, userId);
      const id = randomUUID();
      await client.query('INSERT INTO rooms (id, owner_id, visibility, invite_code) VALUES ($1, $2, $3, $4)', [
        id,
        userId,
        visibility,
        visibility === 'private' ? newInviteCode() : null,
      ]);
      await this.addMember(client, id, userId);
      return this.view(client, id, userId);
    });
  }

  async listPublic(limit: number, offset: number): Promise<readonly RoomView[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM rooms WHERE status = 'open' AND visibility = 'public' ORDER BY created_at, id LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return Promise.all(rows.map((row) => this.view(this.pool, row.id, null)));
  }

  /** Una sala privada no se puede sondear: responde igual que si no existiera. */
  async get(roomId: string, userId: string): Promise<RoomView> {
    const room = await this.view(this.pool, roomId, userId);
    const isMember = room.members.some((member) => member.userId === userId);
    if (room.visibility === 'private' && !isMember) throw notFound();
    return room;
  }

  async joinPublic(roomId: string, userId: string): Promise<RoomView> {
    return inTransaction(this.pool, async (client) => {
      const room = await this.lock(client, 'id = $1', roomId);
      if (room === undefined || room.visibility !== 'public') throw notFound();
      return this.join(client, room, userId);
    });
  }

  async joinByCode(inviteCode: string, userId: string): Promise<RoomView> {
    return inTransaction(this.pool, async (client) => {
      const room = await this.lock(client, 'invite_code = $1', inviteCode);
      if (room === undefined) throw notFound();
      return this.join(client, room, userId);
    });
  }

  async leave(roomId: string, userId: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const room = await this.lockAsMember(client, roomId, userId);
      await client.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
      const { rows } = await client.query<{ user_id: string }>('SELECT user_id FROM room_members WHERE room_id = $1', [roomId]);
      const heir = rows[0];
      if (heir === undefined) {
        await client.query(`UPDATE rooms SET status = 'closed' WHERE id = $1`, [roomId]);
      } else if (room.owner_id === userId) {
        await client.query('UPDATE rooms SET owner_id = $1 WHERE id = $2', [heir.user_id, roomId]);
      }
      // Si la sala cambió, nadie debe empezar con un "listo" dado antes de que se fuera el rival.
      await client.query('UPDATE room_members SET ready = false WHERE room_id = $1', [roomId]);
    });
  }

  /** La partida inicia en la misma transacción en que el último jugador se marca listo. */
  async setReady(roomId: string, userId: string, ready: boolean, nowMs: number): Promise<RoomView> {
    return inTransaction(this.pool, async (client) => {
      const room = await this.lockAsMember(client, roomId, userId);
      await client.query('UPDATE room_members SET ready = $1 WHERE room_id = $2 AND user_id = $3', [ready, roomId, userId]);
      const { rows } = await client.query<{ user_id: string; ready: boolean }>(
        'SELECT user_id, ready FROM room_members WHERE room_id = $1 ORDER BY user_id',
        [roomId],
      );
      const [first, second] = rows;
      if (first?.ready === true && second?.ready === true && rows.length === room.capacity) {
        const matchId = await createMatchInTransaction(client, [first.user_id, second.user_id], nowMs);
        await client.query(`UPDATE rooms SET status = 'started', match_id = $1 WHERE id = $2`, [matchId, roomId]);
        await client.query('DELETE FROM room_members WHERE room_id = $1', [roomId]);
      }
      return this.view(client, roomId, userId);
    });
  }

  private async join(client: pg.ClientBase, room: RoomRow, userId: string): Promise<RoomView> {
    if (room.status !== 'open') throw new ProblemError(409, 'ROOM_NOT_OPEN', 'La sala ya no está abierta');
    await this.assertNotInMatch(client, userId);
    const { rows } = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM room_members WHERE room_id = $1',
      [room.id],
    );
    // La fila de la sala está bloqueada: este conteo no puede cambiar hasta confirmar.
    if ((rows[0]?.count ?? 0) >= room.capacity) throw new ProblemError(409, 'ROOM_FULL', 'La sala está llena');
    await this.addMember(client, room.id, userId);
    return this.view(client, room.id, userId);
  }

  private async addMember(client: pg.ClientBase, roomId: string, userId: string): Promise<void> {
    try {
      await client.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
      await client.query('DELETE FROM matchmaking_queue WHERE user_id = $1', [userId]);
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyInRoom();
      throw error;
    }
  }

  private async assertNotInMatch(client: pg.ClientBase, userId: string): Promise<void> {
    if ((await activeMatchOf(client, userId)) !== null) {
      throw new ProblemError(409, 'ALREADY_IN_MATCH', 'Ya estás en una partida activa');
    }
  }

  private async lock(client: pg.ClientBase, where: 'id = $1' | 'invite_code = $1', value: string): Promise<RoomRow | undefined> {
    const { rows } = await client.query<RoomRow>(`SELECT * FROM rooms WHERE ${where} FOR UPDATE`, [value]);
    return rows[0];
  }

  private async lockAsMember(client: pg.ClientBase, roomId: string, userId: string): Promise<RoomRow> {
    const room = await this.lock(client, 'id = $1', roomId);
    if (room === undefined) throw notFound();
    const { rowCount } = await client.query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, userId]);
    // Quien no es miembro recibe lo mismo que si la sala no existiera.
    if (rowCount === 0) throw notFound();
    return room;
  }

  private async view(client: pg.ClientBase | pg.Pool, roomId: string, viewerId: string | null): Promise<RoomView> {
    const { rows } = await client.query<RoomRow>('SELECT * FROM rooms WHERE id = $1', [roomId]);
    const room = rows[0];
    if (room === undefined) throw notFound();
    const members = await client.query<{ user_id: string; display_name: string; ready: boolean }>(
      `SELECT m.user_id, u.display_name, m.ready FROM room_members m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = $1 ORDER BY u.id`,
      [roomId],
    );
    const isMember = members.rows.some((member) => member.user_id === viewerId);
    return {
      id: room.id,
      visibility: room.visibility,
      status: room.status,
      capacity: room.capacity,
      ownerId: room.owner_id,
      ...(isMember && room.invite_code !== null ? { inviteCode: room.invite_code } : {}),
      members: members.rows.map((member) => ({
        userId: member.user_id,
        displayName: member.display_name,
        ready: member.ready,
      })),
      matchId: isMember || viewerId === null ? null : room.match_id === null ? null : await this.matchIdFor(client, room.match_id, viewerId),
    };
  }

  /** Tras iniciar ya no hay miembros: el id de la partida solo se revela a sus participantes. */
  private async matchIdFor(client: pg.ClientBase | pg.Pool, matchId: string, viewerId: string): Promise<string | null> {
    const { rowCount } = await client.query('SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2', [matchId, viewerId]);
    return rowCount === 0 ? null : matchId;
  }
}
