import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Parser } from '@asyncapi/parser';
import { Validator } from '@seriousme/openapi-schema-validator';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TSchema } from '@sinclair/typebox';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../app.js';
import { registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { WsTestClient } from '../test-support/ws-client.js';
import { buildAsyncApi } from './asyncapi.js';
import { ServerMessageSchema } from './messages.js';
import { ProblemSchema, REST_CONTRACT } from './rest.js';

const CONTRACTS_DIR = fileURLToPath(new URL('../../../../contracts/', import.meta.url));
let db: TestDatabase;
let redis: Redis;
let app: FastifyInstance;
let wsUrl: string;

beforeAll(async () => {
  db = await createTestDatabase();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
  app = buildApp({
    pool: db.pool,
    auth: { jwtSecret: 'x'.repeat(40), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
    realtime: { redis, namespace: `test-${randomUUID()}-`, gateway: { allowedOrigins: [] }, sweepIntervalMs: 3_600_000 },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  wsUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await db.destroy();
});

/** Con UPDATE_CONTRACTS=1 reescribe el archivo; si no, falla si difiere del código. */
function assertPublished(name: string, document: unknown): void {
  const path = `${CONTRACTS_DIR}${name}`;
  const generated = `${JSON.stringify(document, null, 2)}\n`;
  if (process.env['UPDATE_CONTRACTS'] === '1') {
    mkdirSync(CONTRACTS_DIR, { recursive: true });
    writeFileSync(path, generated);
  }
  expect(existsSync(path), `Falta ${name}; genera con UPDATE_CONTRACTS=1 npm test`).toBe(true);
  expect(readFileSync(path, 'utf8'), `${name} no coincide con el código`).toBe(generated);
}

describe('OpenAPI', () => {
  it('es un documento 3.1 válido, cubre todas las rutas y está publicado sin diferencias', async () => {
    const document = app.swagger() as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(document.openapi).toBe('3.1.0');
    const result = await new Validator().validate(structuredClone(document) as never);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);

    const documented = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`),
    );
    expect(Object.keys(REST_CONTRACT).filter((route) => !documented.includes(route))).toEqual([]);
    expect(documented.filter((route) => REST_CONTRACT[route] === undefined)).toEqual([]);
    assertPublished('openapi.json', document);
  });

  it('se sirve en /docs', async () => {
    expect((await app.inject({ method: 'GET', url: '/docs/' })).statusCode).toBe(200);
    const json = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(json.json<{ openapi: string }>().openapi).toBe('3.1.0');
  });

  it('el servidor no acepta una ruta sin contrato', () => {
    const extra = buildApp({
      pool: db.pool,
      auth: { jwtSecret: 'x'.repeat(40), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
      rateLimit: { globalPerMinute: 1, authPerMinute: 1, loginPerAccountPerMinute: 1 },
    });
    expect(() => extra.get('/v1/sin-contrato', () => 'x')).toThrow(/contrato/);
    void extra.close();
  });
});

const checks = new Map<string, ReturnType<typeof TypeCompiler.Compile>>();
function assertMatches(key: string, schema: TSchema, value: unknown): void {
  const check = checks.get(key) ?? TypeCompiler.Compile(schema);
  checks.set(key, check);
  expect(check.Check(value), `${key}: ${JSON.stringify([...check.Errors(value)].slice(0, 3))} en ${JSON.stringify(value).slice(0, 400)}`).toBe(true);
}

const covered = new Set<string>();
function assertRoute(route: string, response: LightMyRequestResponse): void {
  const contract = REST_CONTRACT[route];
  if (contract === undefined) throw new Error(`Ruta sin contrato: ${route}`);
  expect(response.statusCode, `${route}: ${response.body.slice(0, 300)}`).toBe(contract.status);
  if (contract.status !== 204) assertMatches(route, contract.response, response.json());
  covered.add(route);
}

describe('las respuestas reales cumplen el contrato', () => {
  it('recorrido completo de la API y del WebSocket', async () => {
    const live = (url: string) => app.inject({ method: 'GET', url });
    assertRoute('GET /health/live', await live('/health/live'));
    assertRoute('GET /health/ready', await live('/health/ready'));

    const email = `${randomUUID()}@test.invalid`;
    const password = 'una-clave-larga-de-prueba';
    const reg = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password, displayName: 'Uno' } });
    assertRoute('POST /v1/auth/register', reg);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });
    assertRoute('POST /v1/auth/login', login);
    const { refreshToken } = login.json<{ refreshToken: string }>();
    const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });
    assertRoute('POST /v1/auth/refresh', refreshed);
    assertRoute(
      'POST /v1/auth/logout',
      await app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refreshToken: refreshed.json<{ refreshToken: string }>().refreshToken } }),
    );

    const a = await registerUser(app);
    const b = await registerUser(app);
    const admin = await registerUser(app);
    await db.pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
    assertRoute('GET /v1/me', await a.request('GET', '/v1/me'));

    const socketFor = async (user: TestUser): Promise<WsTestClient> => {
      const ticket = await user.request('POST', '/v1/ws-ticket');
      assertRoute('POST /v1/ws-ticket', ticket);
      const client = new WsTestClient(new WebSocket(`${wsUrl}?ticket=${ticket.json<{ ticket: string }>().ticket}`));
      await client.until((messages) => messages.find((message) => message.type === 'welcome'));
      return client;
    };
    const clientA = await socketFor(a);
    const clientB = await socketFor(b);

    const created = await a.request('POST', '/v1/rooms', { visibility: 'private' });
    assertRoute('POST /v1/rooms', created);
    const room = created.json<{ id: string; inviteCode: string }>();
    assertRoute('GET /v1/rooms', await a.request('GET', '/v1/rooms?limit=5'));
    assertRoute('GET /v1/rooms/:roomId', await a.request('GET', `/v1/rooms/${room.id}`));
    assertRoute('POST /v1/rooms/join-by-code', await b.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode }));
    assertRoute('POST /v1/rooms/:roomId/leave', await b.request('POST', `/v1/rooms/${room.id}/leave`));
    const pub = (await b.request('POST', '/v1/rooms', { visibility: 'public' })).json<{ id: string }>();
    await a.request('POST', `/v1/rooms/${room.id}/leave`);
    assertRoute('POST /v1/rooms/:roomId/join', await a.request('POST', `/v1/rooms/${pub.id}/join`));
    await a.request('POST', `/v1/rooms/${pub.id}/ready`, { ready: true });
    assertRoute('POST /v1/rooms/:roomId/ready', await b.request('POST', `/v1/rooms/${pub.id}/ready`, { ready: true }));

    const current = await a.request('GET', '/v1/me/match');
    assertRoute('GET /v1/me/match', current);
    const { matchId } = current.json<{ matchId: string }>();

    const started = await clientA.untilEvent('match_started');
    if (started.type !== 'match_started') throw new Error('Evento inesperado');
    await clientB.untilEvent('match_started');
    const shooter = started.view.turn?.playerId === a.id ? clientA : clientB;
    const rival = shooter === clientA ? clientB : clientA;
    shooter.send({ type: 'shoot', matchId, actionId: randomUUID(), expectedVersion: 1, weaponId: 'bow', angleDeg: 45, power: 10 });
    await rival.untilEvent('shot_resolved');
    await rival.untilEvent('turn_started');
    rival.send({ type: 'sync', matchId });
    await rival.until((messages) => messages.find((message) => message.type === 'snapshot'));
    rival.socket.send('no es json');
    await rival.until((messages) => messages.find((message) => message.type === 'error'));
    clientB.socket.close();
    await clientA.untilEvent('player_disconnected');
    const back = await socketFor(b);
    await clientA.untilEvent('player_reconnected');

    assertRoute('GET /v1/admin/matches', await admin.request('GET', '/v1/admin/matches?limit=5'));
    assertRoute('POST /v1/admin/matches/:matchId/terminate', await admin.request('POST', `/v1/admin/matches/${matchId}/terminate`, { reason: 'contrato' }));
    await clientA.untilEvent('match_finished');
    assertRoute('POST /v1/admin/users/:userId/suspend', await admin.request('POST', `/v1/admin/users/${b.id}/suspend`, { reason: 'contrato' }));
    assertRoute('POST /v1/admin/users/:userId/unsuspend', await admin.request('POST', `/v1/admin/users/${b.id}/unsuspend`, { reason: 'contrato' }));
    assertRoute('GET /v1/admin/audit', await admin.request('GET', '/v1/admin/audit?limit=5'));

    assertRoute('GET /v1/me/matches', await a.request('GET', '/v1/me/matches?limit=5'));
    assertRoute('GET /v1/matches/:matchId/replay', await a.request('GET', `/v1/matches/${matchId}/replay`));

    assertRoute('POST /v1/matchmaking', await a.request('POST', '/v1/matchmaking'));
    assertRoute('GET /v1/matchmaking', await a.request('GET', '/v1/matchmaking'));
    assertRoute('DELETE /v1/matchmaking', await a.request('DELETE', '/v1/matchmaking'));

    await db.pool.query('UPDATE wallets SET balance = 500 WHERE user_id = $1', [a.id]);
    assertRoute('GET /v1/shop/catalog', await a.request('GET', '/v1/shop/catalog'));
    assertRoute('POST /v1/shop/purchases', await a.request('POST', '/v1/shop/purchases', { cosmeticId: 'frame-ash', purchaseId: randomUUID() }));
    assertRoute('GET /v1/me/inventory', await a.request('GET', '/v1/me/inventory'));
    assertRoute('POST /v1/me/inventory/:cosmeticId/equip', await a.request('POST', '/v1/me/inventory/frame-ash/equip', { equipped: true }));

    assertMatches('problem', ProblemSchema, (await a.request('GET', '/v1/no-existe')).json());
    expect([...covered].sort()).toEqual(Object.keys(REST_CONTRACT).sort());

    const received = [...clientA.messages, ...clientB.messages, ...back.messages];
    for (const message of received) assertMatches('ws', ServerMessageSchema, message);
    const types = new Set(received.map((message) => message.type));
    expect(types).toEqual(new Set(['welcome', 'snapshot', 'event', 'ack', 'error']));
    const eventTypes = new Set(received.flatMap((message) => (message.type === 'event' ? [message.event.payload.type] : [])));
    expect(eventTypes).toEqual(
      new Set(['match_started', 'shot_resolved', 'turn_started', 'player_disconnected', 'player_reconnected', 'match_finished']),
    );
  });
});

describe('AsyncAPI', () => {
  it('es un documento 3.0 válido y está publicado sin diferencias', async () => {
    const document = buildAsyncApi();
    const { diagnostics } = await new Parser().parse(JSON.stringify(document));
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 0)).toEqual([]);
    assertPublished('asyncapi.json', document);
  });

  it('los ejemplos cumplen su propio esquema', () => {
    const { components } = buildAsyncApi() as {
      components: { messages: Record<string, { payload: TSchema; examples: { payload: unknown }[] }> };
    };
    for (const [name, message] of Object.entries(components.messages)) {
      assertMatches(`ejemplo-${name}`, message.payload, message.examples[0]?.payload);
    }
  });
});
