import type { EventPayload, MatchEvent, MatchSetup } from '@ashenfall/domain';
import type pg from 'pg';

/** Otra réplica confirmó antes esa secuencia: hay que recargar el log y volver a decidir. */
export class SequenceConflictError extends Error {
  override readonly name = 'SequenceConflictError';
}

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
  async append(matchId: string, events: readonly MatchEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.transaction(async (client) => {
        await this.insertEvents(client, matchId, events);
        for (const { payload } of events) {
          if (payload.type !== 'match_finished') continue;
          const { result } = payload;
          await client.query(`UPDATE matches SET status = 'finished', ended_at = now() WHERE id = $1`, [matchId]);
          await client.query('UPDATE match_players SET active = false WHERE match_id = $1', [matchId]);
          await client.query(
            'INSERT INTO match_results (match_id, winner_id, loser_id, reason, result) VALUES ($1, $2, $3, $4, $5)',
            [matchId, result.winnerId, result.loserId, result.reason, JSON.stringify(result)],
          );
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
