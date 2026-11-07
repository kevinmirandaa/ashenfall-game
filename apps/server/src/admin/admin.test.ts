import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../app.js';
import { registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { WsTestClient } from '../test-support/ws-client.js';

let db: TestDatabase;
let redis: Redis;
let app: FastifyInstance;
let wsUrl: string;
let admin: TestUser;

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
  admin = await registerUser(app);
  await db.pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
});
afterAll(async () => {
  await app.close();
  redis.disconnect();
  await db.destroy();
});

async function startMatch(): Promise<{ a: TestUser; b: TestUser; matchId: string }> {
  const a = await registerUser(app);
  const b = await registerUser(app);
  const room = (await a.request('POST', '/v1/rooms', { visibility: 'private' })).json<{ id: string; inviteCode: string }>();
  await b.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode });
  await a.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  await b.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
  const { matchId } = (await a.request('GET', '/v1/me/match')).json<{ matchId: string }>();
  return { a, b, matchId };
}

const reason = { reason: 'prueba automatizada' };

describe('autorización', () => {
  it.each([
    ['GET', '/v1/admin/matches?limit=1', undefined],
    ['GET', '/v1/admin/audit?limit=1', undefined],
    ['POST', `/v1/admin/matches/${randomUUID()}/terminate`, reason],
    ['POST', `/v1/admin/users/${randomUUID()}/suspend`, reason],
    ['POST', `/v1/admin/users/${randomUUID()}/unsuspend`, reason],
  ] as const)('%s %s: 401 sin token y 403 para un jugador', async (method, url, payload) => {
    expect((await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) })).statusCode).toBe(401);
    const player = await registerUser(app);
    const response = await player.request(method, url, payload);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('quitar el rol surte efecto de inmediato, sin esperar a que venza el token', async () => {
    const temporary = await registerUser(app);
    await db.pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [temporary.id]);
    expect((await temporary.request('GET', '/v1/admin/matches?limit=1')).statusCode).toBe(200);
    await db.pool.query(`UPDATE users SET role = 'player' WHERE id = $1`, [temporary.id]);
    expect((await temporary.request('GET', '/v1/admin/matches?limit=1')).statusCode).toBe(403);
  });
});

describe('partidas', () => {
  it('lista las activas; terminar una no da ganador, libera a los jugadores y queda auditado', async () => {
    const { a, matchId } = await startMatch();
    const list = (await admin.request('GET', '/v1/admin/matches?limit=100')).json<{ items: { matchId: string; players: unknown[] }[] }>();
    expect(list.items.find((item) => item.matchId === matchId)?.players).toHaveLength(2);

    expect((await admin.request('POST', `/v1/admin/matches/${matchId}/terminate`, reason)).statusCode).toBe(204);
    expect((await a.request('GET', '/v1/me/match')).json()).toEqual({ matchId: null });
    const { rows } = await db.pool.query('SELECT winner_id, reason FROM match_results WHERE match_id = $1', [matchId]);
    expect(rows).toEqual([{ winner_id: null, reason: 'admin_terminated' }]);

    const audit = (await admin.request('GET', '/v1/admin/audit?limit=100')).json<{ items: { action: string; target: string; adminId: string }[] }>();
    expect(audit.items).toContainEqual(expect.objectContaining({ action: 'match.terminate', target: matchId, adminId: admin.id }));
  });

  it('muestra las conexiones vivas de cada jugador de la partida', async () => {
    const { a, b, matchId } = await startMatch();
    const ticket = (await a.request('POST', '/v1/ws-ticket')).json<{ ticket: string }>().ticket;
    const client = new WsTestClient(new WebSocket(`${wsUrl}?ticket=${ticket}`));
    await client.until((messages) => messages.find((message) => message.type === 'snapshot'));
    type Player = { playerId: string; connected: boolean; connections: number };
    const list = (await admin.request('GET', '/v1/admin/matches?limit=100')).json<{ items: { matchId: string; players: Player[] }[] }>();
    const players = list.items.find((item) => item.matchId === matchId)?.players ?? [];
    expect(players.find((player) => player.playerId === a.id)).toMatchObject({ connected: true, connections: 1 });
    expect(players.find((player) => player.playerId === b.id)).toMatchObject({ connections: 0 });
    client.socket.close();
  });

  it('terminar dos veces o una inexistente da error y no se audita de nuevo', async () => {
    const { matchId } = await startMatch();
    await admin.request('POST', `/v1/admin/matches/${matchId}/terminate`, reason);
    expect((await admin.request('POST', `/v1/admin/matches/${matchId}/terminate`, reason)).statusCode).toBe(409);
    expect((await admin.request('POST', `/v1/admin/matches/${randomUUID()}/terminate`, reason)).statusCode).toBe(404);
    const { rows } = await db.pool.query(`SELECT 1 FROM admin_audit_logs WHERE target = $1`, [matchId]);
    expect(rows).toHaveLength(1);
  });
});

describe('suspensión', () => {
  it('bloquea el acceso, revoca sesiones, cierra el WebSocket abierto y queda auditada', async () => {
    const user = await registerUser(app);
    const ticket = (await user.request('POST', '/v1/ws-ticket')).json<{ ticket: string }>().ticket;
    const client = new WsTestClient(new WebSocket(`${wsUrl}?ticket=${ticket}`));
    await client.until((messages) => messages.find((message) => message.type === 'welcome'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await admin.request('POST', `/v1/admin/users/${user.id}/suspend`, reason)).statusCode).toBe(204);
    expect(await client.closed()).toBe(4003);
    expect((await user.request('GET', '/v1/me')).json()).toMatchObject({ code: 'USER_SUSPENDED' });
    expect((await user.request('POST', '/v1/ws-ticket')).statusCode).toBe(403);
    const { rows } = await db.pool.query(`SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
    expect(rows).toEqual([]);

    expect((await admin.request('POST', `/v1/admin/users/${user.id}/unsuspend`, reason)).statusCode).toBe(204);
    expect((await user.request('GET', '/v1/me')).statusCode).toBe(200);
    const audit = await db.pool.query<{ action: string }>('SELECT action FROM admin_audit_logs WHERE target = $1 ORDER BY created_at', [user.id]);
    expect(audit.rows.map((row) => row.action)).toEqual(['user.suspend', 'user.unsuspend']);
  });

  it('un administrador no puede suspenderse, y un usuario inexistente da 404', async () => {
    expect((await admin.request('POST', `/v1/admin/users/${admin.id}/suspend`, reason)).statusCode).toBe(409);
    expect((await admin.request('POST', `/v1/admin/users/${randomUUID()}/suspend`, reason)).statusCode).toBe(404);
  });

  it('exige un motivo', async () => {
    const user = await registerUser(app);
    expect((await admin.request('POST', `/v1/admin/users/${user.id}/suspend`, {})).statusCode).toBe(400);
  });
});
