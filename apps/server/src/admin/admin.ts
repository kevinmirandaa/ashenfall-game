import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AuthService } from '../auth/auth-service.js';
import { inTransaction } from '../db/transaction.js';
import { MatchNotFoundError, type MatchEngine } from '../matches/match-engine.js';
import { ProblemError } from '../problem.js';

const Page = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 50 }),
  offset: Type.Integer({ minimum: 0, maximum: 100_000, default: 0 }),
});
const MatchParams = Type.Object({ matchId: Type.String({ format: 'uuid' }) });
const UserParams = Type.Object({ userId: Type.String({ format: 'uuid' }) });
const Reason = Type.Object({ reason: Type.String({ minLength: 3, maxLength: 200 }) }, { additionalProperties: false });

async function audit(
  client: pg.ClientBase | pg.Pool,
  adminId: string,
  action: string,
  target: string,
  details: Readonly<Record<string, unknown>>,
): Promise<void> {
  await client.query('INSERT INTO admin_audit_logs (id, admin_id, action, target, details) VALUES ($1, $2, $3, $4, $5)', [
    randomUUID(),
    adminId,
    action,
    target,
    JSON.stringify(details),
  ]);
}

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: AuthService,
  pool: pg.Pool,
  engine: MatchEngine,
  onUserSuspended: (userId: string) => void,
  /** Conexiones WebSocket vivas de un usuario en todas las réplicas. Sin tiempo real, siempre 0. */
  connectionsOf: (userId: string) => Promise<number> = () => Promise.resolve(0),
): void {
  /** El rol se lee de la base en cada petición, no del token: revocarlo surte efecto de inmediato. */
  const requireAdmin = async (request: FastifyRequest): Promise<string> => {
    const principal = await auth.authenticate(request.headers.authorization);
    if (principal.role !== 'admin') throw new ProblemError(403, 'FORBIDDEN', 'Se requiere rol de administrador');
    return principal.userId;
  };

  app.get<{ Querystring: Static<typeof Page> }>('/v1/admin/matches', { schema: { querystring: Page } }, async (request) => {
    await requireAdmin(request);
    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at FROM matches WHERE status = 'in_progress' ORDER BY created_at, id LIMIT $1 OFFSET $2`,
      [request.query.limit, request.query.offset],
    );
    const items = await Promise.all(
      rows.map(async (row) => {
        const state = await engine.state(row.id);
        return {
          matchId: row.id,
          createdAt: row.created_at.toISOString(),
          round: state.lastRound,
          players: await Promise.all(
            state.players.map(async (player) => ({
              playerId: player.playerId,
              connected: player.connected,
              connections: await connectionsOf(player.playerId),
              hp: player.hp,
            })),
          ),
        };
      }),
    );
    return { items };
  });

  app.post<{ Params: Static<typeof MatchParams>; Body: Static<typeof Reason> }>(
    '/v1/admin/matches/:matchId/terminate',
    { schema: { params: MatchParams, body: Reason } },
    async (request, reply) => {
      const adminId = await requireAdmin(request);
      const { matchId } = request.params;
      let decision;
      try {
        decision = await engine.execute(matchId, { type: 'admin_terminate', nowMs: Date.now() });
      } catch (error) {
        if (error instanceof MatchNotFoundError) throw new ProblemError(404, 'MATCH_NOT_FOUND', 'La partida no existe');
        throw error;
      }
      if (decision.kind !== 'applied') throw new ProblemError(409, 'MATCH_FINISHED', 'La partida ya terminó');
      await audit(pool, adminId, 'match.terminate', matchId, { reason: request.body.reason });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof UserParams>; Body: Static<typeof Reason> }>(
    '/v1/admin/users/:userId/suspend',
    { schema: { params: UserParams, body: Reason } },
    async (request, reply) => {
      const adminId = await requireAdmin(request);
      const { userId } = request.params;
      if (userId === adminId) throw new ProblemError(409, 'CANNOT_SUSPEND_SELF', 'No puedes suspenderte a ti mismo');
      await inTransaction(pool, async (client) => {
        const updated = await client.query('UPDATE users SET suspended_at = coalesce(suspended_at, now()) WHERE id = $1', [userId]);
        if ((updated.rowCount ?? 0) === 0) throw new ProblemError(404, 'USER_NOT_FOUND', 'El usuario no existe');
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
        await audit(client, adminId, 'user.suspend', userId, { reason: request.body.reason });
      });
      onUserSuspended(userId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: Static<typeof UserParams>; Body: Static<typeof Reason> }>(
    '/v1/admin/users/:userId/unsuspend',
    { schema: { params: UserParams, body: Reason } },
    async (request, reply) => {
      const adminId = await requireAdmin(request);
      const { userId } = request.params;
      await inTransaction(pool, async (client) => {
        const updated = await client.query('UPDATE users SET suspended_at = NULL WHERE id = $1', [userId]);
        if ((updated.rowCount ?? 0) === 0) throw new ProblemError(404, 'USER_NOT_FOUND', 'El usuario no existe');
        await audit(client, adminId, 'user.unsuspend', userId, { reason: request.body.reason });
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Querystring: Static<typeof Page> }>('/v1/admin/audit', { schema: { querystring: Page } }, async (request) => {
    await requireAdmin(request);
    const { rows } = await pool.query(
      `SELECT id, admin_id AS "adminId", action, target, details, created_at AS "createdAt"
       FROM admin_audit_logs ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`,
      [request.query.limit, request.query.offset],
    );
    return { items: rows };
  });
}
