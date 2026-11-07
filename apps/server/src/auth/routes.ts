import { CHARACTER_IDS, type CharacterId } from '@ashenfall/domain';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { RateLimitConfig } from '../app.js';
import type { AuthService } from './auth-service.js';
import { LoginThrottle } from './login-throttle.js';

const ChooseCharacter = Type.Object(
  { characterId: Type.Union(CHARACTER_IDS.map((id) => Type.Literal(id))) },
  { additionalProperties: false },
);

const Credentials = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 254 }),
    // El máximo evita gastar CPU de Argon2 en contraseñas enormes.
    password: Type.String({ minLength: 10, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const Register = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 254 }),
    password: Type.String({ minLength: 10, maxLength: 128 }),
    displayName: Type.String({ minLength: 2, maxLength: 32, pattern: '^[\\p{L}\\p{N} _-]+$' }),
  },
  { additionalProperties: false },
);
const Refresh = Type.Object({ refreshToken: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService, limits: RateLimitConfig): void {
  // Límite por IP, más estricto que el global, para todo lo que gasta Argon2 o toca sesiones.
  const authLimit = { rateLimit: { max: limits.authPerMinute, timeWindow: '1 minute' } };
  // Límite por cuenta: frena la fuerza bruta distribuida entre muchas IP.
  const throttle = new LoginThrottle(limits.loginPerAccountPerMinute, limits.redis, limits.namespace ?? 'ashenfall-rl-');

  app.post<{ Body: Static<typeof Register> }>(
    '/v1/auth/register',
    { schema: { body: Register }, config: authLimit },
    async (request, reply) => {
      const { email, password, displayName } = request.body;
      return reply.code(201).send(await auth.register(email, password, displayName));
    },
  );

  app.post<{ Body: Static<typeof Credentials> }>(
    '/v1/auth/login',
    { schema: { body: Credentials }, config: authLimit },
    async (request) => {
      await throttle.check(request.body.email);
      return auth.login(request.body.email, request.body.password);
    },
  );

  app.post<{ Body: Static<typeof Refresh> }>('/v1/auth/refresh', { schema: { body: Refresh }, config: authLimit }, (request) =>
    auth.refresh(request.body.refreshToken),
  );

  app.post<{ Body: Static<typeof Refresh> }>(
    '/v1/auth/logout',
    { schema: { body: Refresh }, config: authLimit },
    async (request, reply) => {
      await auth.logout(request.body.refreshToken);
      return reply.code(204).send();
    },
  );

  app.get('/v1/me', async (request) => {
    const principal = await auth.authenticate(request.headers.authorization);
    return auth.profile(principal.userId);
  });

  app.post<{ Body: Static<typeof ChooseCharacter> }>('/v1/me/character', { schema: { body: ChooseCharacter } }, async (request, reply) => {
    const principal = await auth.authenticate(request.headers.authorization);
    await auth.chooseCharacter(principal.userId, request.body.characterId as CharacterId);
    return reply.code(204).send();
  });
}
