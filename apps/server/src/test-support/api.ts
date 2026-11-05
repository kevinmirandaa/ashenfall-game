import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import type { TestDatabase } from './database.js';

export function buildTestApp(db: TestDatabase): FastifyInstance {
  return buildApp({
    pool: db.pool,
    auth: { jwtSecret: randomBytes(32).toString('hex'), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
  });
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly authorization: string;
  request(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object): Promise<LightMyRequestResponse>;
}

export async function registerUser(app: FastifyInstance): Promise<TestUser> {
  const email = `${randomUUID()}@test.invalid`;
  const password = 'una-clave-larga-de-prueba';
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, password, displayName: 'Jugador' },
  });
  const { accessToken } = response.json<{ accessToken: string }>();
  const headers = { authorization: `Bearer ${accessToken}` };
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers });
  return {
    id: me.json<{ id: string }>().id,
    email,
    password,
    authorization: headers.authorization,
    request: (method, url, payload) => app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) }),
  };
}
