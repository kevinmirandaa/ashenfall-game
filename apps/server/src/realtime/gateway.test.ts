import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import { buildApp } from '../app.js';
import { registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { WsTestClient } from '../test-support/ws-client.js';

const ORIGIN = 'https://ashenfall.test';
let db: TestDatabase;
let redis: Redis;
let app: FastifyInstance;
let baseUrl: string;

async function startServer(gateway: { heartbeatMs?: number; maxMessagesPerSecond?: number } = {}): Promise<{ app: FastifyInstance; url: string }> {
  const instance = buildApp({
    pool: db.pool,
    auth: { jwtSecret: 'clave-de-prueba-solo-para-este-test-0123456789', accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
    realtime: { redis, namespace: `test-${randomUUID()}-`, gateway: { allowedOrigins: [ORIGIN], ...gateway } },
  });
  await instance.listen({ port: 0, host: '127.0.0.1' });
  const { port } = instance.server.address() as AddressInfo;
  return { app: instance, url: `ws://127.0.0.1:${port}/ws` };
}

beforeAll(async () => {
  db = await createTestDatabase();
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379');
  const started = await startServer();
  app = started.app;
  baseUrl = started.url;
});
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await db.destroy();
});

function openRaw(url: string, options: ClientOptions = {}): Promise<{ client?: WsTestClient; status?: number }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, options);
    const client = new WsTestClient(socket);
    socket.once('open', () => resolve({ client }));
    socket.once('unexpected-response', (_request, response) => {
      resolve({ status: response.statusCode ?? 0 });
      socket.terminate();
    });
    socket.once('error', () => resolve({ status: 0 }));
  });
}

async function ticketFor(user: TestUser): Promise<string> {
  const response = await user.request('POST', '/v1/ws-ticket');
  expect(response.statusCode).toBe(201);
  return response.json<{ ticket: string }>().ticket;
}

async function connect(user: TestUser, url = baseUrl, options: ClientOptions = {}): Promise<WsTestClient> {
  const { client, status } = await openRaw(`${url}?ticket=${await ticketFor(user)}`, options);
  if (client === undefined) throw new Error(`Conexión rechazada: ${String(status)}`);
  await client.until((messages) => messages.find((message) => message.type === 'welcome'));
  return client;
}

interface Duel {
  readonly a: TestUser;
  readonly b: TestUser;
  readonly clientA: WsTestClient;
  readonly clientB: WsTestClient;
  readonly matchId: string;
  readonly firstPlayerId: string;
}

async function startDuel(): Promise<Duel> {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const clientA = await connect(a);
  const clientB = await connect(b);
  const room = (await a.request('POST', '/v1/rooms', { visibility: 'private' })).json<{ id: string; inviteCode: string }>();
  await b.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode });
  await a.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  await b.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  const event = await clientA.until((messages) =>
    messages.find((message) => message.type === 'event' && message.event.payload.type === 'match_started'),
  );
  if (event.type !== 'event' || event.event.payload.type !== 'match_started') throw new Error('Evento inesperado');
  const { view } = event.event.payload;
  await clientB.until((messages) => messages.find((message) => message.type === 'event'));
  return { a, b, clientA, clientB, matchId: view.matchId, firstPlayerId: view.turn?.playerId ?? '' };
}

const MISS = { weaponId: 'dagger', angleDeg: 45, power: 10 };

function byTurn(duel: Duel, playerId: string): WsTestClient {
  return playerId === duel.a.id ? duel.clientA : duel.clientB;
}

describe('handshake', () => {
  it('rechaza sin ticket, con ticket falso y con origen no permitido', async () => {
    expect((await openRaw(baseUrl)).status).toBe(401);
    expect((await openRaw(`${baseUrl}?ticket=falso`)).status).toBe(401);
    const user = await registerUser(app);
    const ticket = await ticketFor(user);
    expect((await openRaw(`${baseUrl}?ticket=${ticket}`, { origin: 'https://malicioso.test' })).status).toBe(403);
  });

  it('el ticket es de un solo uso, también con dos conexiones simultáneas', async () => {
    const user = await registerUser(app);
    const ticket = await ticketFor(user);
    const results = await Promise.all([1, 2, 3].map(() => openRaw(`${baseUrl}?ticket=${ticket}`, { origin: ORIGIN })));
    expect(results.filter((result) => result.client !== undefined)).toHaveLength(1);
    expect(results.filter((result) => result.status === 401)).toHaveLength(2);
  });

  it('pedir un ticket exige autenticación', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/ws-ticket' })).statusCode).toBe(401);
  });

  it('limita las conexiones por usuario', async () => {
    const user = await registerUser(app);
    await Promise.all([connect(user), connect(user), connect(user)]);
    const { client } = await openRaw(`${baseUrl}?ticket=${await ticketFor(user)}`);
    expect(await client?.closed()).toBe(4008);
  });
});

describe('validación de mensajes', () => {
  it.each([
    ['JSON roto', 'esto no es json'],
    ['tipo desconocido', JSON.stringify({ v: 1, type: 'hack' })],
    ['versión incorrecta', JSON.stringify({ v: 9, type: 'sync', matchId: randomUUID() })],
    ['resultado enviado por el cliente', JSON.stringify({ v: 1, type: 'shoot', matchId: randomUUID(), actionId: randomUUID(), expectedVersion: 1, weaponId: 'dagger', angleDeg: 45, power: 50, damage: 999 })],
    ['ángulo fuera de rango', JSON.stringify({ v: 1, type: 'shoot', matchId: randomUUID(), actionId: randomUUID(), expectedVersion: 1, weaponId: 'dagger', angleDeg: 500, power: 50 })],
  ])('rechaza %s sin cerrar la conexión', async (_name, raw) => {
    const client = await connect(await registerUser(app));
    client.socket.send(raw);
    await client.until((messages) => messages.find((message) => message.type === 'error' && message.code === 'INVALID_MESSAGE'));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('un mensaje demasiado grande cierra con 1009', async () => {
    const client = await connect(await registerUser(app));
    client.socket.send('x'.repeat(5000));
    expect(await client.closed()).toBe(1009);
  });

  it('limita la tasa por conexión y cierra si el abuso continúa', async () => {
    const server = await startServer({ maxMessagesPerSecond: 3 });
    try {
      const client = await connect(await registerUser(server.app), server.url);
      for (let i = 0; i < 12; i += 1) client.socket.send('{}');
      await client.until((messages) => messages.find((message) => message.type === 'error' && message.code === 'RATE_LIMITED'));
      expect(await client.closed()).toBe(4029);
    } finally {
      await server.app.close();
    }
  });
});

describe('heartbeat', () => {
  it('cierra la conexión que no responde al ping', async () => {
    const server = await startServer({ heartbeatMs: 40 });
    try {
      const silent = await connect(await registerUser(server.app), server.url, { autoPong: false });
      const healthy = await connect(await registerUser(server.app), server.url);
      await silent.closed();
      expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      await server.app.close();
    }
  });
});

describe('jugadas', () => {
  it('ambos reciben el disparo; el rival nunca ve ángulo, potencia ni actionId', async () => {
    const duel = await startDuel();
    const shooter = byTurn(duel, duel.firstPlayerId);
    const rival = shooter === duel.clientA ? duel.clientB : duel.clientA;
    const actionId = randomUUID();
    shooter.send({ type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS });
    await shooter.until((messages) => messages.find((message) => message.type === 'ack' && message.actionId === actionId));
    const seen = await rival.until((messages) =>
      messages.find((message) => message.type === 'event' && message.event.payload.type === 'shot_resolved'),
    );
    const serialized = JSON.stringify(seen);
    expect(serialized).toContain('"path"');
    expect(serialized).not.toContain(actionId);
    expect(serialized).not.toContain('angleDeg');
    expect(serialized).not.toContain('"power"');
    await rival.until((messages) =>
      messages.find((message) => message.type === 'event' && message.event.payload.type === 'turn_started'),
    );
  });

  it('rechaza con error tipado al jugador sin turno y sobre versión vieja, sin cerrar', async () => {
    const duel = await startDuel();
    const shooter = byTurn(duel, duel.firstPlayerId);
    const other = shooter === duel.clientA ? duel.clientB : duel.clientA;
    const outOfTurn = randomUUID();
    other.send({ type: 'shoot', matchId: duel.matchId, actionId: outOfTurn, expectedVersion: 1, ...MISS });
    await other.until((messages) =>
      messages.find((message) => message.type === 'error' && message.code === 'NOT_YOUR_TURN' && message.actionId === outOfTurn),
    );
    const stale = randomUUID();
    shooter.send({ type: 'shoot', matchId: duel.matchId, actionId: stale, expectedVersion: 99, ...MISS });
    await shooter.until((messages) =>
      messages.find((message) => message.type === 'error' && message.code === 'STALE_VERSION' && message.actionId === stale),
    );
    expect(other.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('la misma jugada enviada 10 veces a la vez se aplica una sola vez', async () => {
    const duel = await startDuel();
    const shooter = byTurn(duel, duel.firstPlayerId);
    const actionId = randomUUID();
    for (let i = 0; i < 10; i += 1) {
      shooter.send({ type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS });
    }
    await shooter.until((messages) =>
      messages.filter((message) => message.type === 'ack' && message.actionId === actionId).length === 10 ? true : undefined,
    );
    const acks = shooter.messages.filter((message) => message.type === 'ack');
    expect(acks.filter((ack) => ack.type === 'ack' && !ack.duplicate)).toHaveLength(1);
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS shots FROM match_events WHERE match_id = $1 AND payload->>'type' = 'shot_resolved'`,
      [duel.matchId],
    );
    expect(rows).toEqual([{ shots: 1 }]);
  });

  it('un tercero no puede jugar ni ver la partida, y no distingue si existe', async () => {
    const duel = await startDuel();
    const intruder = await connect(await registerUser(app));
    intruder.send({ type: 'sync', matchId: duel.matchId });
    const actionId = randomUUID();
    intruder.send({ type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS });
    intruder.send({ type: 'sync', matchId: randomUUID() });
    await intruder.until((messages) =>
      messages.filter((message) => message.type === 'error' && message.code === 'MATCH_NOT_FOUND').length === 3 ? true : undefined,
    );
    expect(JSON.stringify(intruder.messages)).not.toContain('"snapshot"');
  });

  it('una jugada en una partida inexistente no afecta a las demás', async () => {
    const duel = await startDuel();
    const shooter = byTurn(duel, duel.firstPlayerId);
    shooter.send({ type: 'shoot', matchId: randomUUID(), actionId: randomUUID(), expectedVersion: 1, ...MISS });
    const actionId = randomUUID();
    shooter.send({ type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS });
    await shooter.until((messages) => messages.find((message) => message.type === 'ack' && message.actionId === actionId));
  });
});

describe('partida completa', () => {
  it('dos clientes juegan las 12 rondas hasta el final; el resultado queda registrado y los jugadores libres', async () => {
    const duel = await startDuel();
    let version = 1;
    let turn = duel.firstPlayerId;
    let shots = 0;
    let finished = false;
    // Avanza solo con lo que empuja el servidor: nunca consulta para saber si cambió el turno.
    while (!finished) {
      const seqSeen = duel.clientA.messages.length;
      const shooter = byTurn(duel, turn);
      shooter.send({ type: 'shoot', matchId: duel.matchId, actionId: randomUUID(), expectedVersion: version, ...MISS });
      shots += 1;
      await duel.clientA.until((messages) => {
        for (const message of messages.slice(seqSeen)) {
          if (message.type !== 'event') continue;
          const { payload } = message.event;
          if (payload.type === 'match_finished') {
            expect(payload.result).toMatchObject({ winnerId: null, reason: 'round_limit', rounds: 12 });
            finished = true;
            return true;
          }
          if (payload.type === 'turn_started') {
            version += 2;
            turn = payload.playerId;
            return true;
          }
        }
        return undefined;
      });
    }
    expect(shots).toBe(24);
    for (const client of [duel.clientA, duel.clientB]) {
      await client.until((messages) =>
        messages.find((message) => message.type === 'event' && message.event.payload.type === 'match_finished'),
      );
    }
    const seqs = duel.clientB.messages.flatMap((message) => (message.type === 'event' ? [message.event.seq] : []));
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
    expect((await duel.a.request('GET', '/v1/me/match')).json()).toEqual({ matchId: null });
    const { rows } = await db.pool.query('SELECT reason FROM match_results WHERE match_id = $1', [duel.matchId]);
    expect(rows).toEqual([{ reason: 'round_limit' }]);
  });

  it('al reconectar, un jugador recibe el estado actual, incluso desde otra réplica', async () => {
    const duel = await startDuel();
    const shooter = byTurn(duel, duel.firstPlayerId);
    const actionId = randomUUID();
    shooter.send({ type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS });
    await shooter.until((messages) => messages.find((message) => message.type === 'ack' && message.actionId === actionId));

    duel.clientA.socket.close();
    const other = await startServer();
    try {
      const response = await other.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: duel.a.email, password: duel.a.password },
      });
      const { accessToken } = response.json<{ accessToken: string }>();
      const ticket = await other.app.inject({ method: 'POST', url: '/v1/ws-ticket', headers: { authorization: `Bearer ${accessToken}` } });
      const { client } = await openRaw(`${other.url}?ticket=${ticket.json<{ ticket: string }>().ticket}`);
      const snapshot = await client?.until((messages) => messages.find((message) => message.type === 'snapshot'));
      if (snapshot?.type !== 'snapshot') throw new Error('Sin snapshot');
      expect(snapshot.view).toMatchObject({ matchId: duel.matchId, version: 3, you: { playerId: duel.a.id } });
      client?.socket.close();
    } finally {
      await other.app.close();
    }
  });
});
