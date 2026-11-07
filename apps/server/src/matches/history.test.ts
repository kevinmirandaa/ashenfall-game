import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decide, evolve, replay, type PlayerEvent } from '@ashenfall/domain';
import { buildTestApp, registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { MatchEventStore } from './event-store.js';

let db: TestDatabase;
let app: FastifyInstance;
let store: MatchEventStore;

beforeAll(async () => {
  db = await createTestDatabase();
  app = buildTestApp(db);
  store = new MatchEventStore(db.pool);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

/** Juega una partida de un disparo fallido terminada por el administrador. */
async function playFinished(a: TestUser, b: TestUser, actionId = randomUUID(), finish = true): Promise<string> {
  const room = (await a.request('POST', '/v1/rooms', { visibility: 'private' })).json<{ id: string; inviteCode: string }>();
  await b.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode });
  await a.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  await b.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  const { matchId } = (await a.request('GET', '/v1/me/match')).json<{ matchId: string }>();
  let state = replay(await store.load(matchId));
  const nowMs = Date.now();
  const shot = decide(state, {
    type: 'shoot',
    playerId: state.turn?.playerId ?? '',
    actionId,
    expectedVersion: state.version,
    weaponId: 'dagger',
    angleDeg: 43.21,
    power: 56.78,
    nowMs,
  });
  if (shot.kind !== 'applied') throw new Error('Rechazada');
  await store.append(matchId, shot.events);
  state = shot.events.reduce(evolve, state);
  if (finish) {
    const end = decide(state, { type: 'admin_terminate', nowMs });
    if (end.kind !== 'applied') throw new Error('Rechazada');
    await store.append(matchId, end.events);
  }
  return matchId;
}

describe('historial', () => {
  it('exige autenticación', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me/matches?limit=1' })).statusCode).toBe(401);
  });

  it('está paginado y solo incluye las partidas propias', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const other = await registerUser(app);
    const first = await playFinished(a, b);
    const second = await playFinished(a, b);
    const page = (await a.request('GET', '/v1/me/matches?limit=1')).json<{ total: number; items: { matchId: string }[] }>();
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    const next = (await a.request('GET', '/v1/me/matches?limit=1&offset=1')).json<{ items: { matchId: string }[] }>();
    expect([page.items[0]?.matchId, next.items[0]?.matchId].sort()).toEqual([first, second].sort());
    expect((await other.request('GET', '/v1/me/matches?limit=50')).json()).toEqual({ total: 0, items: [] });
    expect((await a.request('GET', '/v1/me/matches?limit=999')).statusCode).toBe(400);
  });

  it('una partida sin ganador aparece como empate', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await playFinished(a, b);
    const page = (await a.request('GET', '/v1/me/matches?limit=1')).json<{ items: { outcome: string; reason: string }[] }>();
    expect(page.items[0]).toMatchObject({ outcome: 'draw', reason: 'admin_terminated' });
  });
});

describe('reproducción', () => {
  it('reproduce la partida jugada por jugada con secuencia completa', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const matchId = await playFinished(a, b);
    const body = (await a.request('GET', `/v1/matches/${matchId}/replay`)).json<{ events: PlayerEvent[]; result: { reason: string } }>();
    expect(body.events.map((event) => event.payload.type)).toEqual(['match_started', 'shot_resolved', 'turn_started', 'match_finished']);
    expect(body.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(body.result.reason).toBe('admin_terminated');
  });

  it('un tercero recibe 404, igual que con una partida inexistente', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const intruder = await registerUser(app);
    const matchId = await playFinished(a, b);
    const foreign = await intruder.request('GET', `/v1/matches/${matchId}/replay`);
    const missing = await intruder.request('GET', `/v1/matches/${randomUUID()}/replay`);
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'MATCH_NOT_FOUND' });
    expect(missing.json()).toMatchObject({ code: 'MATCH_NOT_FOUND' });
  });

  it('no se puede reproducir una partida en curso', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const matchId = await playFinished(a, b, randomUUID(), false);
    expect((await a.request('GET', `/v1/matches/${matchId}/replay`)).json()).toMatchObject({ code: 'MATCH_IN_PROGRESS' });
  });

  it('solo quien disparó ve su ángulo, potencia y actionId en la reproducción', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const actionId = randomUUID();
    const matchId = await playFinished(a, b, actionId);
    const bodies = await Promise.all([a, b].map(async (user) => (await user.request('GET', `/v1/matches/${matchId}/replay`)).body));
    expect(bodies.filter((body) => body.includes(actionId))).toHaveLength(1);
    expect(bodies.filter((body) => body.includes('43.21'))).toHaveLength(1);
  });
});
