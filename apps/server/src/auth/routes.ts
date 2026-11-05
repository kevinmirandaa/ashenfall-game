import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth-service.js';

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

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.post<{ Body: Static<typeof Register> }>('/v1/auth/register', { schema: { body: Register } }, async (request, reply) => {
    const { email, password, displayName } = request.body;
    return reply.code(201).send(await auth.register(email, password, displayName));
  });

  app.post<{ Body: Static<typeof Credentials> }>('/v1/auth/login', { schema: { body: Credentials } }, (request) =>
    auth.login(request.body.email, request.body.password),
  );

  app.post<{ Body: Static<typeof Refresh> }>('/v1/auth/refresh', { schema: { body: Refresh } }, (request) =>
    auth.refresh(request.body.refreshToken),
  );

  app.post<{ Body: Static<typeof Refresh> }>('/v1/auth/logout', { schema: { body: Refresh } }, async (request, reply) => {
    await auth.logout(request.body.refreshToken);
    return reply.code(204).send();
  });

  app.get('/v1/me', async (request) => {
    const principal = await auth.authenticate(request.headers.authorization);
    return auth.profile(principal.userId);
  });
}
