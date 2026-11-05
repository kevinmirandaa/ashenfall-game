import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createTestDatabase, type TestDatabase } from './test-support/database.js';

const auth = { jwtSecret: 'x'.repeat(32), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 };
const rateLimit = { globalPerMinute: 1, authPerMinute: 1, loginPerAccountPerMinute: 1 };
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(() => db.destroy());

function appWith(ping: () => Promise<string>) {
  return buildApp({ pool: db.pool, auth, rateLimit, health: { redis: { ping } as unknown as Redis } });
}

describe('sondas', () => {
  it('live y ready responden 200 sin depender del límite global, y ready tiene su propio límite', async () => {
    const app = appWith(() => Promise.resolve('PONG'));
    for (let i = 0; i < 3; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    }
    const codes: number[] = [];
    for (let i = 0; i < 120; i += 1) codes.push((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode);
    expect(codes).toContain(429);
    await app.close();
  });

  it('ready responde 503 si falla una dependencia, sin detalles internos; live sigue en 200', async () => {
    const app = appWith(() => Promise.reject(new Error('redis://secreto@host')));
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.body).not.toContain('secreto');
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    await app.close();
  });
});
