import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/auth-service.js';
import type { MatchmakingService } from './matchmaking-service.js';

export function registerMatchmakingRoutes(app: FastifyInstance, auth: AuthService, matchmaking: MatchmakingService): void {
  app.post('/v1/matchmaking', async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    return matchmaking.join(userId, Date.now());
  });

  app.get('/v1/matchmaking', async (request) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    return matchmaking.status(userId);
  });

  app.delete('/v1/matchmaking', async (request, reply) => {
    const { userId } = await auth.authenticate(request.headers.authorization);
    await matchmaking.leave(userId);
    return reply.code(204).send();
  });
}
