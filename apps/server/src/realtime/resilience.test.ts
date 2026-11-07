import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../app.js';
import { MatchEventStore } from '../matches/event-store.js';
import { MatchEngine } from '../matches/match-engine.js';
import { MatchSweeper } from '../matches/sweeper.js';
import { registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { WsTestClient } from '../test-support/ws-client.js';
import { RedisEventBus } from './event-bus.js';

const JWT = 'clave-de-prueba-solo-para-este-test-0123456789';
const MISS = { weaponId: 'dagger', angleDeg: 45, power: 10 };
let db: TestDatabase;
let redis: Redis;
const apps: FastifyInstance[] = [];

const silentLog = { error: () => undefined, warn: () => undefined } as never;

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

interface Replica {
  readonly app: FastifyInstance;
  readonly url: string;
}

async function startReplica(namespace: string): Promise<Replica> {
  const app = buildApp({
    pool: db.pool,
    auth: { jwtSecret: JWT, accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
    realtime: { redis, namespace, gateway: { allowedOrigins: [] }, sweepIntervalMs: 3_600_000 },
  });
  apps.push(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws` };
}

async function connect(user: TestUser, replica: Replica): Promise<WsTestClient> {
  const ticket = await replica.app.inject({
    method: 'POST',
    url: '/v1/ws-ticket',
    headers: { authorization: user.authorization },
  });
  const socket = new WebSocket(`${replica.url}?ticket=${ticket.json<{ ticket: string }>().ticket}`);
  const client = new WsTestClient(socket);
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

async function startDuel(replicaA: Replica, replicaB: Replica): Promise<Duel> {
  const a = await registerUser(replicaA.app);
  const b = await registerUser(replicaA.app);
  const clientA = await connect(a, replicaA);
  const clientB = await connect(b, replicaB);
  const room = (await a.request('POST', '/v1/rooms', { visibility: 'private' })).json<{ id: string; inviteCode: string }>();
  await b.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode });
  await a.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  await b.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  const started = await clientB.untilEvent('match_started');
  if (started.type !== 'match_started') throw new Error('Evento inesperado');
  await clientA.untilEvent('match_started');
  return { a, b, clientA, clientB, matchId: started.view.matchId, firstPlayerId: started.view.turn?.playerId ?? '' };
}

/** Una réplica aparte que barre con un reloj adelantado: simula que pasó el tiempo. */
function sweeperFor(namespace: string): MatchSweeper {
  const bus = new RedisEventBus(redis, namespace, silentLog);
  const engine = new MatchEngine(new MatchEventStore(db.pool), (matchId, events) => bus.publish(matchId, events));
  return new MatchSweeper(db.pool, engine, silentLog);
}

async function balanceOf(user: TestUser): Promise<number> {
  return (await user.request('GET', '/v1/me')).json<{ balance: number }>().balance;
}

describe('varias réplicas', () => {
  it('un jugador en otra réplica recibe los eventos', async () => {
    const namespace = `test-${randomUUID()}-`;
    const duel = await startDuel(await startReplica(namespace), await startReplica(namespace));
    const shooter = duel.firstPlayerId === duel.a.id ? duel.clientA : duel.clientB;
    const rival = shooter === duel.clientA ? duel.clientB : duel.clientA;
    shooter.send({ type: 'shoot', matchId: duel.matchId, actionId: randomUUID(), expectedVersion: 1, ...MISS });
    await rival.untilEvent('shot_resolved');
    await rival.untilEvent('turn_started');
  });

  it('la misma jugada enviada a dos réplicas a la vez se aplica una sola vez', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replicaA = await startReplica(namespace);
    const replicaB = await startReplica(namespace);
    const duel = await startDuel(replicaA, replicaB);
    const shooterUser = duel.firstPlayerId === duel.a.id ? duel.a : duel.b;
    const first = await connect(shooterUser, replicaA);
    const second = await connect(shooterUser, replicaB);
    const actionId = randomUUID();
    const message = { type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS };
    first.send(message);
    second.send(message);
    for (const client of [first, second]) {
      await client.until((messages) => messages.find((candidate) => candidate.type === 'ack' && candidate.actionId === actionId));
    }
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS shots FROM match_events WHERE match_id = $1 AND payload->>'type' = 'shot_resolved'`,
      [duel.matchId],
    );
    expect(rows).toEqual([{ shots: 1 }]);
  });
});

describe('temporizador del servidor', () => {
  it('al vencer el turno lo pasa al rival; dos timeouts del mismo jugador son abandono y dan la recompensa', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replica = await startReplica(namespace);
    const duel = await startDuel(replica, replica);
    const sweeper = sweeperFor(namespace);
    const later = Date.now() + 31_000;
    await sweeper.runOnce(later);
    await duel.clientA.untilEvent('turn_timed_out');
    await duel.clientA.untilEvent('turn_started');
    await sweeper.runOnce(later + 31_000);
    await sweeper.runOnce(later + 62_000);
    const finished = await duel.clientB.untilEvent('match_finished');
    if (finished.type !== 'match_finished') throw new Error('Evento inesperado');
    expect(finished.result.reason).toBe('timeout_forfeit');
    const winner = finished.result.winnerId === duel.a.id ? duel.a : duel.b;
    const loser = winner === duel.a ? duel.b : duel.a;
    expect(await balanceOf(winner)).toBe(100);
    expect(await balanceOf(loser)).toBe(0);
  });

  it('barrer varias veces a la vez aplica un solo timeout y el plazo no vencido no se toca', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replica = await startReplica(namespace);
    const duel = await startDuel(replica, replica);
    await sweeperFor(namespace).runOnce(Date.now() + 1000);
    const later = Date.now() + 31_000;
    await Promise.all([1, 2, 3, 4].map(() => sweeperFor(namespace).runOnce(later)));
    const { rows } = await db.pool.query<{ type: string }>(
      `SELECT payload->>'type' AS type FROM match_events WHERE match_id = $1 ORDER BY seq`,
      [duel.matchId],
    );
    expect(rows.map((row) => row.type)).toEqual(['match_started', 'turn_timed_out', 'turn_started']);
  });
});

describe('desconexión', () => {
  it('avisa al rival, y reconectar dentro del plazo evita el abandono', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replica = await startReplica(namespace);
    const duel = await startDuel(replica, replica);
    duel.clientA.socket.close();
    await duel.clientB.untilEvent('player_disconnected');
    const back = await connect(duel.a, replica);
    await duel.clientB.untilEvent('player_reconnected');
    await back.until((messages) => messages.find((message) => message.type === 'snapshot'));
  });

  it('si reconecta en otra réplica antes de cerrarse la vieja, no se marca como desconectado', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replicaA = await startReplica(namespace);
    const replicaB = await startReplica(namespace);
    const duel = await startDuel(replicaA, replicaA);
    const replacement = await connect(duel.a, replicaB);
    await replacement.until((messages) => messages.find((message) => message.type === 'snapshot'));
    duel.clientA.socket.close();
    await duel.clientA.closed();
    duel.clientB.send({ type: 'sync', matchId: duel.matchId });
    const snapshot = await duel.clientB.until((messages) => messages.find((message) => message.type === 'snapshot'));
    if (snapshot.type !== 'snapshot') throw new Error('Mensaje inesperado');
    expect(snapshot.view.opponent.connected).toBe(true);
    const { rows } = await db.pool.query(
      `SELECT 1 FROM match_events WHERE match_id = $1 AND payload->>'type' = 'player_disconnected'`,
      [duel.matchId],
    );
    expect(rows).toEqual([]);
  });

  it('al vencer la gracia gana el rival, una sola vez aunque se barra de nuevo', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replica = await startReplica(namespace);
    const duel = await startDuel(replica, replica);
    duel.clientA.socket.close();
    await duel.clientB.untilEvent('player_disconnected');
    const sweeper = sweeperFor(namespace);
    const later = Date.now() + 61_000;
    await sweeper.runOnce(later);
    const finished = await duel.clientB.untilEvent('match_finished');
    if (finished.type !== 'match_finished') throw new Error('Evento inesperado');
    expect(finished.result).toMatchObject({ winnerId: duel.b.id, reason: 'disconnect_forfeit' });
    await sweeper.runOnce(later + 1000);
    expect(await balanceOf(duel.b)).toBe(100);
    expect(await balanceOf(duel.a)).toBe(0);
  });
});

describe('reinicio', () => {
  it('tras apagar la única réplica, la partida continúa en una nueva sin perder jugadas', async () => {
    const namespace = `test-${randomUUID()}-`;
    const old = await startReplica(namespace);
    const duel = await startDuel(old, old);
    const shooter = duel.firstPlayerId === duel.a.id ? duel.clientA : duel.clientB;
    const shooterUser = duel.firstPlayerId === duel.a.id ? duel.a : duel.b;
    const nextUser = shooterUser === duel.a ? duel.b : duel.a;
    const actionId = randomUUID();
    shooter.send({ type: 'shoot', matchId: duel.matchId, actionId, expectedVersion: 1, ...MISS });
    await shooter.until((messages) => messages.find((message) => message.type === 'ack' && message.actionId === actionId));
    await old.app.close();
    apps.splice(apps.indexOf(old.app), 1);

    const fresh = await startReplica(namespace);
    const next = await connect(nextUser, fresh);
    const snapshot = await next.until((messages) => messages.find((message) => message.type === 'snapshot'));
    if (snapshot.type !== 'snapshot') throw new Error('Mensaje inesperado');
    expect(snapshot.view.turn?.playerId).toBe(nextUser.id);
    const secondAction = randomUUID();
    next.send({ type: 'shoot', matchId: duel.matchId, actionId: secondAction, expectedVersion: snapshot.view.version, ...MISS });
    await next.until((messages) => messages.find((message) => message.type === 'ack' && message.actionId === secondAction));
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS shots FROM match_events WHERE match_id = $1 AND payload->>'type' = 'shot_resolved'`,
      [duel.matchId],
    );
    expect(rows).toEqual([{ shots: 2 }]);
  });
});

describe('limpieza', () => {
  it('cierra salas viejas y libera a sus miembros', async () => {
    const namespace = `test-${randomUUID()}-`;
    const replica = await startReplica(namespace);
    const owner = await registerUser(replica.app);
    const room = (await owner.request('POST', '/v1/rooms', { visibility: 'public' })).json<{ id: string }>();
    await db.pool.query(`UPDATE rooms SET created_at = now() - interval '2 hours' WHERE id = $1`, [room.id]);
    await sweeperFor(namespace).runOnce(Date.now());
    expect((await owner.request('POST', '/v1/rooms', { visibility: 'public' })).statusCode).toBe(201);
  });
});
