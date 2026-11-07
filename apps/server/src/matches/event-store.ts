import { randomUUID } from 'node:crypto';
import { MONSTER_IDS, type EventPayload, type MatchEvent, type MatchSetup, type MonsterId } from '@ashenfall/domain';
import type pg from 'pg';

/** Otra réplica confirmó antes esa secuencia: hay que recargar el log y volver a decidir. */
export class SequenceConflictError extends Error {
  override readonly name = 'SequenceConflictError';
}

/** Marcas de Ceniza por victoria. */
export const WIN_REWARD = 100;

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === UNIQUE_VIOLATION;
}

interface EventRow {
  seq: number;
  at_ms: string;
  payload: EventPayload;
}

export class MatchEventStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Crea la partida y su primer evento de forma atómica. Falla si un jugador ya está en otra partida activa. */
  async create(setup: MatchSetup, firstEvent: MatchEvent): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(`INSERT INTO matches (id, status) VALUES ($1, 'in_progress')`, [setup.matchId]);
      for (const player of setup.players) {
        await client.query('INSERT INTO match_players (match_id, user_id) VALUES ($1, $2)', [
          setup.matchId,
          player.playerId,
        ]);
      }
      await this.insertEvents(client, setup.matchId, [firstEvent]);
    });
  }

  /**
   * Confirma eventos antes de avisar a los clientes. La clave (match_id, seq) serializa a las réplicas:
   * si dos escriben la misma secuencia, solo una gana y la otra recibe SequenceConflictError.
   */
  async append(matchId: string, events: readonly MatchEvent[], nextDeadlineMs?: number | null, botDueMs?: number | null): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.transaction(async (client) => {
        await this.insertEvents(client, matchId, events);
        if (nextDeadlineMs !== undefined) {
          await client.query('UPDATE matches SET next_deadline_ms = $1 WHERE id = $2', [nextDeadlineMs, matchId]);
        }
        if (botDueMs !== undefined) {
          await client.query('UPDATE matches SET bot_due_ms = $1 WHERE id = $2', [botDueMs, matchId]);
        }
        for (const { payload } of events) {
          if (payload.type !== 'match_finished') continue;
          const { result } = payload;
          await client.query(`UPDATE matches SET status = 'finished', ended_at = now() WHERE id = $1`, [matchId]);
          await client.query('UPDATE match_players SET active = false WHERE match_id = $1', [matchId]);
          await client.query(
            'INSERT INTO match_results (match_id, winner_id, loser_id, reason, result) VALUES ($1, $2, $3, $4, $5)',
            [matchId, result.winnerId, result.loserId, result.reason, JSON.stringify(result)],
          );
          if (result.winnerId !== null) await this.grantReward(client, matchId, result.winnerId);
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SequenceConflictError(`Conflicto de secuencia en la partida ${matchId}`);
      throw error;
    }
  }

  async load(matchId: string): Promise<readonly MatchEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      'SELECT seq, at_ms, payload FROM match_events WHERE match_id = $1 ORDER BY seq',
      [matchId],
    );
    return rows.map((row) => ({ seq: row.seq, atMs: Number(row.at_ms), payload: row.payload }));
  }

  async listActiveMatchIds(): Promise<readonly string[]> {
    const { rows } = await this.pool.query<{ id: string }>(`SELECT id FROM matches WHERE status = 'in_progress'`);
    return rows.map((row) => row.id);
  }

  /**
   * En la misma transacción que el resultado; la clave única impide pagar dos veces. Cada partida trae su premio
   * (100 contra humanos, menos contra un bot) y un monstruo nunca cobra. Vencer un nivel de historia lo desbloquea.
   */
  private async grantReward(client: pg.ClientBase, matchId: string, winnerId: string): Promise<void> {
    const info = await client.query<{ reward: number; mode: string; monster_id: string | null; is_bot: boolean }>(
      `SELECT m.reward, m.mode, m.monster_id, u.is_bot FROM matches m, users u WHERE m.id = $1 AND u.id = $2`,
      [matchId, winnerId],
    );
    const row = info.rows[0];
    if (row === undefined || row.is_bot) return;
    const inserted = await client.query(
      `INSERT INTO wallet_transactions (id, user_id, amount, kind, idempotency_key)
       VALUES ($1, $2, $3, 'match_reward', $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [randomUUID(), winnerId, row.reward, `match-reward:${matchId}`],
    );
    if ((inserted.rowCount ?? 0) > 0) {
      await client.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [row.reward, winnerId]);
      if (row.mode === 'story' && row.monster_id !== null) {
        const level = MONSTER_IDS.indexOf(row.monster_id as MonsterId) + 1;
        if (level > 0) {
          await client.query(
            `INSERT INTO story_progress (user_id, cleared) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET cleared = GREATEST(story_progress.cleared, EXCLUDED.cleared)`,
            [winnerId, level],
          );
        }
      }
    }
  }

  private async insertEvents(client: pg.ClientBase, matchId: string, events: readonly MatchEvent[]): Promise<void> {
    for (const event of events) {
      await client.query('INSERT INTO match_events (match_id, seq, at_ms, payload) VALUES ($1, $2, $3, $4)', [
        matchId,
        event.seq,
        event.atMs,
        JSON.stringify(event.payload),
      ]);
    }
  }

  private async transaction(work: (client: pg.PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
