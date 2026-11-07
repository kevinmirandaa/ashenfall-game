import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp, type AppDependencies } from '../app.js';
import { REST_CONTRACT } from '../contracts/rest.js';
import { registerUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { WsTestClient } from '../test-support/ws-client.js';

const ORIGIN = 'https://ashenfall.test';
const JWT = 'x'.repeat(40);
let db: TestDatabase;
let redis: Redis;

beforeAll(async () => {
  db = await createTestDatabase();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
});
afterAll(async () => {
  redis.disconnect();
  await db.destroy();
});

function base(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    pool: db.pool,
    auth: { jwtSecret: JWT, accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
    allowedOrigins: [ORIGIN],
    ...overrides,
  };
}

async function withApp(dependencies: AppDependencies, work: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = buildApp(dependencies);
  await app.ready();
  try {
    await work(app);
  } finally {
    await app.close();
  }
}

describe('encabezados y CORS', () => {
  it('envía encabezados de seguridad', async () => {
    await withApp(base(), async (app) => {
      const { headers } = await app.inject({ method: 'GET', url: '/health/live' });
      expect(headers['strict-transport-security']).toContain('max-age');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['content-security-policy']).toBeDefined();
      expect(headers['x-powered-by']).toBeUndefined();
    });
  });

  it('en local la CSP no fuerza HTTPS y conserva los demás encabezados', async () => {
    await withApp(base(), async (app) => {
      const { headers } = await app.inject({ method: 'GET', url: '/health/live' });
      const csp = String(headers['content-security-policy']);
      expect(csp).not.toContain('upgrade-insecure-requests');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain('ws:');
      expect(headers['strict-transport-security']).toContain('max-age');
      expect(headers['x-content-type-options']).toBe('nosniff');
    });
  });

  it('en producción la CSP fuerza HTTPS y solo admite wss', async () => {
    await withApp(base({ enforceHttps: true }), async (app) => {
      const { headers } = await app.inject({ method: 'GET', url: '/health/live' });
      const csp = String(headers['content-security-policy']);
      expect(csp).toContain('upgrade-insecure-requests');
      expect(csp).toContain("connect-src 'self' wss:");
      expect(csp).not.toMatch(/\bws:/);
    });
  });

  it('solo permite orígenes configurados', async () => {
    await withApp(base(), async (app) => {
      const preflight = (origin: string) =>
        app.inject({
          method: 'OPTIONS',
          url: '/v1/me',
          headers: { origin, 'access-control-request-method': 'GET' },
        });
      expect((await preflight(ORIGIN)).headers['access-control-allow-origin']).toBe(ORIGIN);
      expect((await preflight('https://malicioso.test')).headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('autorización en todo el contrato', () => {
  // /v1/ws-ticket solo existe con tiempo real activo; se prueba en realtime/gateway.test.ts.
  const authRoutes = Object.entries(REST_CONTRACT).filter(([route, contract]) => contract.auth && route !== 'POST /v1/ws-ticket');
  const concrete = (path: string) =>
    path.replace(':cosmeticId', 'frame-ash').replace(/:\w+/g, randomUUID());

  it.each(authRoutes.map(([route]) => route))('%s rechaza sin token', async (route) => {
    const [method, path] = route.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
    await withApp(base(), async (app) => {
      const response = await app.inject({
        method,
        url: `${concrete(path)}${method === 'GET' ? '?limit=1' : ''}`,
        ...(method === 'POST' || method === 'PUT' ? { payload: validBodies(path) } : {}),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  it.each(authRoutes.filter(([route]) => route.includes('/admin/')).map(([route]) => route))(
    '%s rechaza a un jugador',
    async (route) => {
      const [method, path] = route.split(' ') as ['GET' | 'POST', string];
      await withApp(base(), async (app) => {
        const player = await registerUser(app);
        const response = await player.request(method, `${concrete(path)}${method === 'GET' ? '?limit=1' : ''}`, method === 'POST' ? { reason: 'motivo' } : undefined);
        expect(response.statusCode).toBe(403);
      });
    },
  );
});

function validBodies(path: string): object {
  if (path.endsWith('/rooms')) return { visibility: 'public' };
  if (path.endsWith('join-by-code')) return { inviteCode: 'ABCDEFGH' };
  if (path.endsWith('/ready')) return { ready: true };
  if (path.endsWith('/potions')) return { potionId: 'vital', purchaseId: randomUUID() };
  if (path.endsWith('/loadout')) return { potions: [] };
  if (path.endsWith('/matches/bot')) return { mode: 'quick' };
  if (path.endsWith('/purchases')) return { cosmeticId: 'frame-ash', purchaseId: randomUUID() };
  if (path.endsWith('/character')) return { characterId: 'sylwen' };
  if (path.endsWith('/equip')) return { equipped: true };
  if (path.includes('/admin/')) return { reason: 'motivo' };
  return {};
}

describe('límite por usuario', () => {
  it('cuenta a un usuario aunque cambie de IP; un token inválido no le consume su cupo', async () => {
    await withApp(base({ rateLimit: { globalPerMinute: 3, authPerMinute: 100, loginPerAccountPerMinute: 100 } }), async (app) => {
      const user = await registerUser(app);
      const call = (remoteAddress: string, authorization = user.authorization) =>
        app.inject({ method: 'GET', url: '/v1/me', remoteAddress, headers: { authorization } });
      // registerUser ya consumió una petición autenticada de /v1/me.
      expect((await call('10.1.0.1')).statusCode).toBe(200);
      expect((await call('10.1.0.2')).statusCode).toBe(200);
      const blocked = await call('10.1.0.3');
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect((await call('10.1.0.4', 'Bearer falso')).statusCode).toBe(401);
    });
  });
});

describe('logs', () => {
  it('no contienen contraseñas, tokens ni tickets', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const password = 'clave-super-secreta-para-el-log';
    const email = `${randomUUID()}@test.invalid`;
    await withApp(
      base({
        logger: { stream },
        realtime: { redis, namespace: `test-${randomUUID()}-`, gateway: { allowedOrigins: [] }, sweepIntervalMs: 3_600_000 },
      }),
      async (app) => {
        const response = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password, displayName: 'Log' } });
        const { accessToken, refreshToken } = response.json<{ accessToken: string; refreshToken: string }>();
        await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });
        const ticket = await app.inject({ method: 'POST', url: '/v1/ws-ticket', headers: { authorization: `Bearer ${accessToken}` } });
        const output = lines.join('');
        expect(output.length).toBeGreaterThan(0);
        for (const secret of [password, accessToken, refreshToken, ticket.json<{ ticket: string }>().ticket, email]) {
          expect(output).not.toContain(secret);
        }
      },
    );
  });
});

describe('errores internos', () => {
  it('no exponen detalles', async () => {
    const pool = { query: () => Promise.reject(new Error('password=secreta host=db-interna')) } as unknown as AppDependencies['pool'];
    await withApp(base({ pool }), async (app) => {
      const response = await app.inject({ method: 'GET', url: '/v1/rooms?limit=1', headers: { authorization: 'Bearer falso' } });
      expect(response.statusCode).toBe(401);
      const failing = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@test.invalid', password: 'una-clave-larga-de-prueba' } });
      expect(failing.statusCode).toBe(500);
      expect(failing.body).not.toContain('secreta');
      expect(failing.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    });
  });
});

describe('conexiones por usuario entre réplicas', () => {
  it('el máximo cuenta las conexiones de otras réplicas', async () => {
    const namespace = `test-${randomUUID()}-`;
    const start = async (): Promise<{ app: FastifyInstance; url: string }> => {
      const app = buildApp(
        base({ realtime: { redis, namespace, gateway: { allowedOrigins: [], maxConnectionsPerUser: 2 }, sweepIntervalMs: 3_600_000 } }),
      );
      await app.listen({ port: 0, host: '127.0.0.1' });
      return { app, url: `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws` };
    };
    const first = await start();
    const second = await start();
    try {
      const user = await registerUser(first.app);
      const open = async (url: string): Promise<WsTestClient> => {
        const ticket = (await user.request('POST', '/v1/ws-ticket')).json<{ ticket: string }>().ticket;
        return new WsTestClient(new WebSocket(`${url}?ticket=${ticket}`));
      };
      const a = await open(first.url);
      await a.until((messages) => messages.find((message) => message.type === 'welcome'));
      const b = await open(second.url);
      await b.until((messages) => messages.find((message) => message.type === 'welcome'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await (await open(first.url)).closed()).toBe(4008);
    } finally {
      await first.app.close();
      await second.app.close();
    }
  });
});
