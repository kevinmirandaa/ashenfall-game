import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type RateLimitConfig } from '../app.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';

const auth = { jwtSecret: randomBytes(32).toString('hex'), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 };
const body = { email: 'objetivo@test.invalid', password: 'una-clave-larga-de-prueba' };
const OPEN: RateLimitConfig = { globalPerMinute: 1000, authPerMinute: 1000, loginPerAccountPerMinute: 1000 };

let db: TestDatabase;
let redis: Redis;
const apps: FastifyInstance[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
afterAll(async () => {
  redis.disconnect();
  await db.destroy();
});

async function start(rateLimit: RateLimitConfig): Promise<FastifyInstance> {
  const app = buildApp({ pool: db.pool, auth, rateLimit });
  apps.push(app);
  await app.ready();
  return app;
}

const login = (app: FastifyInstance, remoteAddress: string, email = body.email) =>
  app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress, payload: { ...body, email } });

describe('límites de tasa', () => {
  it('login por IP: responde 429 con Retry-After y Problem Details', async () => {
    const app = await start({ ...OPEN, authPerMinute: 2 });
    expect((await login(app, '10.0.0.1')).statusCode).toBe(401);
    expect((await login(app, '10.0.0.1', 'otro@test.invalid')).statusCode).toBe(401);
    const blocked = await login(app, '10.0.0.1', 'tercero@test.invalid');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(blocked.json()).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect((await login(app, '10.0.0.2')).statusCode).toBe(401);
  });

  it('login por cuenta: frena la fuerza bruta aunque cambie la IP, sin afectar a otras cuentas', async () => {
    const app = await start({ ...OPEN, loginPerAccountPerMinute: 2 });
    expect((await login(app, '10.0.1.1')).statusCode).toBe(401);
    expect((await login(app, '10.0.1.2', body.email.toUpperCase())).statusCode).toBe(401);
    expect((await login(app, '10.0.1.3')).statusCode).toBe(429);
    expect((await login(app, '10.0.1.3', 'otra@test.invalid')).statusCode).toBe(401);
  });

  it('el perfil usa el límite global', async () => {
    const app = await start({ ...OPEN, globalPerMinute: 1 });
    const me = () => app.inject({ method: 'GET', url: '/v1/me', remoteAddress: '10.0.2.1' });
    expect((await me()).statusCode).toBe(401);
    expect((await me()).statusCode).toBe(429);
  });

  it('con Redis, el contador se comparte entre réplicas', async () => {
    const shared = { ...OPEN, authPerMinute: 2, redis, namespace: `test-${randomUUID()}-` };
    const replicaA = await start(shared);
    const replicaB = await start(shared);
    expect((await login(replicaA, '10.0.3.1')).statusCode).toBe(401);
    expect((await login(replicaB, '10.0.3.1', 'b@test.invalid')).statusCode).toBe(401);
    expect((await login(replicaA, '10.0.3.1', 'c@test.invalid')).statusCode).toBe(429);
    expect((await login(replicaB, '10.0.3.1', 'd@test.invalid')).statusCode).toBe(429);
  });
});
