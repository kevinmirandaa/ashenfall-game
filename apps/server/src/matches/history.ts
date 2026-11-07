import { evolve, initialState, toPlayerEvent, type MatchResult, type PlayerEvent } from '@ashenfall/domain';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AuthService } from '../auth/auth-service.js';
import { ProblemError } from '../problem.js';
import type { MatchEventStore } from './event-store.js';

const Page = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 50, default: 20 }),
  offset: Type.Integer({ minimum: 0, maximum: 100_000, default: 0 }),
});
const MatchParams = Type.Object({ matchId: Type.String({ format: 'uuid' }) });

const notFound = (): ProblemError => new ProblemError(404, 'MATCH_NOT_FOUND', 'La partida no existe');

export function registerHistoryRoutes(app: FastifyInstance, auth: AuthService, pool: pg.Pool, store: MatchEventStore): void {
  // La consulta parte de los participantes: una partida ajena no puede aparecer aquí.
  app.get<{ Querystring: Static<typeof Page> }>('/v1/me/matches', { schema: { querystring: Page } }, async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    const { rows } = await pool.query<{ match_id: string; result: MatchResult; ended_at: Date; opponent: string | null }>(
      `SELECT r.match_id, r.result, r.ended_at,
              (SELECT u.display_name FROM match_players o JOIN users u ON u.id = o.user_id WHERE o.match_id = r.match_id AND o.user_id <> $1 LIMIT 1) AS opponent
       FROM match_players p JOIN match_results r ON r.match_id = p.match_id
       WHERE p.user_id = $1 ORDER BY r.ended_at DESC, r.match_id LIMIT $2 OFFSET $3`,
      [userId, request.query.limit, request.query.offset],
    );
    const { rows: totals } = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM match_players p JOIN match_results r ON r.match_id = p.match_id WHERE p.user_id = $1`,
      [userId],
    );
    return {
      total: totals[0]?.total ?? 0,
      items: rows.map((row) => ({
        matchId: row.match_id,
        outcome: row.result.winnerId === null ? 'draw' : row.result.winnerId === userId ? 'win' : 'loss',
        opponent: row.opponent ?? 'Rival',
        reason: row.result.reason,
        rounds: row.result.rounds,
        endedAt: row.ended_at.toISOString(),
      })),
    };
  });

  app.get<{ Params: Static<typeof MatchParams> }>('/v1/matches/:matchId/replay', { schema: { params: MatchParams } }, async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    const { matchId } = request.params;
    const participant = await pool.query('SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
    // Ajena o inexistente responde igual, para que no se pueda sondear.
    if ((participant.rowCount ?? 0) === 0) throw notFound();

    const [first, ...rest] = await store.load(matchId);
    if (first === undefined) throw notFound();
    let state = initialState(first);
    if (rest.at(-1)?.payload.type !== 'match_finished') {
      throw new ProblemError(409, 'MATCH_IN_PROGRESS', 'La partida aún no ha terminado');
    }
    const events: PlayerEvent[] = [];
    const firstEvent = toPlayerEvent(first, state, userId);
    if (firstEvent !== null) events.push(firstEvent);
    for (const event of rest) {
      state = evolve(state, event);
      const projected = toPlayerEvent(event, state, userId);
      if (projected !== null) events.push(projected);
    }
    return { matchId, result: state.result, events };
  });
}
