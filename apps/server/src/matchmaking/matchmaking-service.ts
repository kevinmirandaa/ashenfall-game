import type pg from 'pg';
import { inTransaction } from '../db/transaction.js';
import { activeMatchOf, createMatchInTransaction } from '../matches/start.js';
import { ProblemError } from '../problem.js';

export type QueueStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'queued'; readonly expiresAt: string }
  | { readonly status: 'timed_out' }
  | { readonly status: 'matched'; readonly matchId: string };

/** Número fijo. Serializa la cola: con entradas simultáneas sin confirmar, dos jugadores no se verían entre sí. */
const QUEUE_LOCK_ID = 727_002;

export class MatchmakingService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly maxWaitMs: number,
    private readonly onMatchStarted: (matchId: string) => void = () => undefined,
  ) {}

  async join(userId: string, nowMs: number): Promise<QueueStatus> {
    const result = await this.joinInTransaction(userId, nowMs);
    if (result.created) this.onMatchStarted(result.created);
    return result.status;
  }

  private joinInTransaction(userId: string, nowMs: number): Promise<{ status: QueueStatus; created?: string }> {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [QUEUE_LOCK_ID]);
      const active = await activeMatchOf(client, userId);
      if (active !== null) return { status: { status: 'matched', matchId: active } };

      const room = await client.query('SELECT 1 FROM room_members WHERE user_id = $1', [userId]);
      if ((room.rowCount ?? 0) > 0) throw new ProblemError(409, 'ALREADY_IN_ROOM', 'Sal de la sala antes de buscar partida');

      await client.query('DELETE FROM matchmaking_queue WHERE expires_at <= now() AND user_id <> $1', [userId]);
      const rival = await client.query<{ user_id: string }>(
        `SELECT user_id FROM matchmaking_queue
         WHERE user_id <> $1 AND expires_at > now() ORDER BY enqueued_at, user_id LIMIT 1`,
        [userId],
      );
      const rivalId = rival.rows[0]?.user_id;
      if (rivalId !== undefined) {
        await client.query('DELETE FROM matchmaking_queue WHERE user_id = ANY($1::uuid[])', [[userId, rivalId]]);
        const matchId = await createMatchInTransaction(client, [rivalId, userId], nowMs);
        return { status: { status: 'matched', matchId }, created: matchId };
      }

      // Volver a entrar conserva el turno en la cola y renueva el plazo de espera.
      const { rows } = await client.query<{ expires_at: Date }>(
        `INSERT INTO matchmaking_queue (user_id, expires_at) VALUES ($1, now() + make_interval(secs => $2))
         ON CONFLICT (user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
         RETURNING expires_at`,
        [userId, this.maxWaitMs / 1000],
      );
      const expiresAt = rows[0]?.expires_at;
      if (expiresAt === undefined) throw new Error('La cola no devolvió la fila insertada');
      return { status: { status: 'queued', expiresAt: expiresAt.toISOString() } };
    });
  }

  async status(userId: string): Promise<QueueStatus> {
    const active = await activeMatchOf(this.pool, userId);
    if (active !== null) return { status: 'matched', matchId: active };
    const { rows } = await this.pool.query<{ expires_at: Date; expired: boolean }>(
      'SELECT expires_at, expires_at <= now() AS expired FROM matchmaking_queue WHERE user_id = $1',
      [userId],
    );
    const entry = rows[0];
    if (entry === undefined) return { status: 'idle' };
    if (entry.expired) {
      await this.pool.query('DELETE FROM matchmaking_queue WHERE user_id = $1', [userId]);
      return { status: 'timed_out' };
    }
    return { status: 'queued', expiresAt: entry.expires_at.toISOString() };
  }

  async leave(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM matchmaking_queue WHERE user_id = $1', [userId]);
  }
}
