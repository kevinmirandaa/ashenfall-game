import { progressFor, type Progress } from '@ashenfall/domain';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AuthService } from '../auth/auth-service.js';

export interface PlayerStats extends Progress {
  readonly played: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

/**
 * Partidas, victorias, derrotas y empates de un jugador, y el nivel que sale de ellas. Siempre se calcula aquí:
 * el cliente no puede decir que tiene un nivel que no tiene.
 */
export async function loadStats(db: pg.Pool | pg.ClientBase, userId: string): Promise<PlayerStats> {
  const { rows } = await db.query<{ played: number; wins: number; losses: number }>(
    `SELECT count(*)::int AS played,
            count(*) FILTER (WHERE r.winner_id = $1)::int AS wins,
            count(*) FILTER (WHERE r.loser_id = $1)::int AS losses
       FROM match_players mp JOIN match_results r ON r.match_id = mp.match_id
      WHERE mp.user_id = $1`,
    [userId],
  );
  const row = rows[0] ?? { played: 0, wins: 0, losses: 0 };
  return { played: row.played, wins: row.wins, losses: row.losses, draws: row.played - row.wins - row.losses, ...progressFor(row.played, row.wins) };
}

export function registerStatsRoute(app: FastifyInstance, auth: AuthService, pool: pg.Pool): void {
  app.get('/v1/me/stats', async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    return loadStats(pool, userId);
  });
}
