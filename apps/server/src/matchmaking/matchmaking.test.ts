import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import type { QueueStatus } from './matchmaking-service.js';

let db: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDatabase();
  app = buildTestApp(db);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
beforeEach(() => db.pool.query('DELETE FROM matchmaking_queue'));

const join = async (user: TestUser) => (await user.request('POST', '/v1/matchmaking')).json<QueueStatus>();
const status = async (user: TestUser) => (await user.request('GET', '/v1/matchmaking')).json<QueueStatus>();

describe('emparejamiento', () => {
  it('exige autenticación', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/matchmaking' })).statusCode).toBe(401);
  });

  it('el primero espera y el segundo forma partida con él', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    expect(await join(a)).toMatchObject({ status: 'queued' });
    const matched = await join(b);
    if (matched.status !== 'matched') throw new Error('Debía emparejar');
    expect(await status(a)).toEqual(matched);
    const { rows } = await db.pool.query('SELECT user_id FROM match_players WHERE match_id = $1', [matched.matchId]);
    expect(rows.map((row: { user_id: string }) => row.user_id).sort()).toEqual([a.id, b.id].sort());
  });

  it('entrar dos veces no empareja a un jugador consigo mismo', async () => {
    const a = await registerUser(app);
    await join(a);
    expect(await join(a)).toMatchObject({ status: 'queued' });
    const { rows } = await db.pool.query('SELECT 1 FROM matchmaking_queue WHERE user_id = $1', [a.id]);
    expect(rows).toHaveLength(1);
  });

  it('con 20 jugadores simultáneos, todos quedan en exactamente una partida', async () => {
    const players = await Promise.all(Array.from({ length: 20 }, () => registerUser(app)));
    const results = await Promise.all(players.map(join));
    expect(results.every((result) => result.status === 'queued' || result.status === 'matched')).toBe(true);

    const finals = await Promise.all(players.map(status));
    const perMatch = new Map<string, number>();
    for (const final of finals) {
      if (final.status !== 'matched') throw new Error(`Jugador sin partida: ${final.status}`);
      perMatch.set(final.matchId, (perMatch.get(final.matchId) ?? 0) + 1);
    }
    expect(perMatch.size).toBe(10);
    expect([...perMatch.values()].every((count) => count === 2)).toBe(true);
  });

  it('reintentar la entrada tras emparejar devuelve la misma partida, sin crear otra', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await join(a);
    const matched = await join(b);
    expect(await join(a)).toEqual(matched);
    expect(await join(b)).toEqual(matched);
  });

  it('salir de la cola impide que te emparejen', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await join(a);
    expect((await a.request('DELETE', '/v1/matchmaking')).statusCode).toBe(204);
    expect(await status(a)).toEqual({ status: 'idle' });
    expect(await join(b)).toMatchObject({ status: 'queued' });
  });

  it('al vencer la espera máxima se informa y no se empareja a ese jugador', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await join(a);
    await db.pool.query(`UPDATE matchmaking_queue SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [a.id]);
    expect(await status(a)).toEqual({ status: 'timed_out' });
    expect(await status(a)).toEqual({ status: 'idle' });
    expect(await join(b)).toMatchObject({ status: 'queued' });
  });

  it('quien está en una sala no puede entrar en la cola, y entrar a una sala lo saca de ella', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    await a.request('POST', '/v1/rooms', { visibility: 'public' });
    expect((await a.request('POST', '/v1/matchmaking')).json()).toMatchObject({ code: 'ALREADY_IN_ROOM' });
    await join(b);
    await b.request('POST', '/v1/rooms', { visibility: 'public' });
    expect(await status(b)).toEqual({ status: 'idle' });
  });
});
