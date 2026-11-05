import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import type { RoomView } from './room-service.js';

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

async function createRoom(owner: TestUser, visibility: 'public' | 'private'): Promise<RoomView> {
  const response = await owner.request('POST', '/v1/rooms', { visibility });
  expect(response.statusCode).toBe(201);
  return response.json<RoomView>();
}

const users = (count: number) => Promise.all(Array.from({ length: count }, () => registerUser(app)));

describe('salas', () => {
  it('toda ruta exige autenticación', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/rooms?limit=1' });
    expect(response.statusCode).toBe(401);
  });

  it('una sala pública aparece en la lista y una privada no', async () => {
    const [a, b] = await users(2);
    if (a === undefined || b === undefined) throw new Error('Faltan usuarios');
    const open = await createRoom(a, 'public');
    const hidden = await createRoom(b, 'private');
    const { items } = (await a.request('GET', '/v1/rooms?limit=50')).json<{ items: RoomView[] }>();
    expect(items.map((room) => room.id)).toContain(open.id);
    expect(items.map((room) => room.id)).not.toContain(hidden.id);
    expect(JSON.stringify(items)).not.toContain(hidden.inviteCode);
  });

  it('la lista está paginada y valida el límite', async () => {
    const [a, b] = await users(2);
    if (a === undefined || b === undefined) throw new Error('Faltan usuarios');
    await createRoom(a, 'public');
    await createRoom(b, 'public');
    expect((await a.request('GET', '/v1/rooms?limit=1')).json<{ items: RoomView[] }>().items).toHaveLength(1);
    expect((await a.request('GET', '/v1/rooms?limit=500')).statusCode).toBe(400);
  });

  it('una sala privada solo admite entrar con código y no se puede sondear', async () => {
    const [owner, guest] = await users(2);
    if (owner === undefined || guest === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'private');
    expect((await guest.request('POST', `/v1/rooms/${room.id}/join`)).statusCode).toBe(404);
    expect((await guest.request('GET', `/v1/rooms/${room.id}`)).statusCode).toBe(404);
    const joined = await guest.request('POST', '/v1/rooms/join-by-code', { inviteCode: room.inviteCode ?? '' });
    expect(joined.statusCode).toBe(200);
    expect(joined.json<RoomView>().members).toHaveLength(2);
  });

  it('un código inexistente responde 404 y uno malformado 400', async () => {
    const [user] = await users(1);
    if (user === undefined) throw new Error('Faltan usuarios');
    expect((await user.request('POST', '/v1/rooms/join-by-code', { inviteCode: 'ABCDEFGH' })).statusCode).toBe(404);
    expect((await user.request('POST', '/v1/rooms/join-by-code', { inviteCode: "' OR 1=1" })).statusCode).toBe(400);
  });

  it('la capacidad se respeta con 10 uniones simultáneas', async () => {
    const [owner, ...others] = await users(11);
    if (owner === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    const responses = await Promise.all(others.map((user) => user.request('POST', `/v1/rooms/${room.id}/join`)));
    const codes = responses.map((response) => response.statusCode);
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    expect(codes.filter((code) => code === 409)).toHaveLength(9);
    expect((await owner.request('GET', `/v1/rooms/${room.id}`)).json<RoomView>().members).toHaveLength(2);
  });

  it('un usuario no puede estar en dos salas', async () => {
    const [a, b] = await users(2);
    if (a === undefined || b === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(a, 'public');
    await createRoom(b, 'public');
    const response = await b.request('POST', `/v1/rooms/${room.id}/join`);
    expect(response.json()).toMatchObject({ code: 'ALREADY_IN_ROOM' });
    expect((await a.request('POST', '/v1/rooms', { visibility: 'public' })).statusCode).toBe(409);
  });

  it('quien no es miembro no puede marcarse listo ni salir', async () => {
    const [owner, intruder] = await users(2);
    if (owner === undefined || intruder === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    expect((await intruder.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true })).statusCode).toBe(404);
    expect((await intruder.request('POST', `/v1/rooms/${room.id}/leave`)).statusCode).toBe(404);
  });

  it('no inicia con un solo jugador listo', async () => {
    const [owner] = await users(1);
    if (owner === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    const response = await owner.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
    expect(response.json<RoomView>().status).toBe('open');
    expect((await owner.request('GET', '/v1/me/match')).json()).toEqual({ matchId: null });
  });

  it('al salir, el otro hereda la sala y su "listo" se reinicia', async () => {
    const [owner, guest] = await users(2);
    if (owner === undefined || guest === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    await guest.request('POST', `/v1/rooms/${room.id}/join`);
    await guest.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
    expect((await owner.request('POST', `/v1/rooms/${room.id}/leave`)).statusCode).toBe(204);
    const after = (await guest.request('GET', `/v1/rooms/${room.id}`)).json<RoomView>();
    expect(after.ownerId).toBe(guest.id);
    expect(after.members).toEqual([expect.objectContaining({ userId: guest.id, ready: false })]);
  });

  it('una sala vacía se cierra', async () => {
    const [owner, other] = await users(2);
    if (owner === undefined || other === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    await owner.request('POST', `/v1/rooms/${room.id}/leave`);
    expect((await other.request('POST', `/v1/rooms/${room.id}/join`)).json()).toMatchObject({ code: 'ROOM_NOT_OPEN' });
  });

  it('con ambos listos a la vez inicia exactamente una partida para los dos', async () => {
    const [owner, guest] = await users(2);
    if (owner === undefined || guest === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    await guest.request('POST', `/v1/rooms/${room.id}/join`);
    await Promise.all(
      [owner, guest].map((user) => user.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true })),
    );
    const ownerMatch = (await owner.request('GET', '/v1/me/match')).json<{ matchId: string }>().matchId;
    const guestMatch = (await guest.request('GET', '/v1/me/match')).json<{ matchId: string }>().matchId;
    expect(ownerMatch).toBeTruthy();
    expect(guestMatch).toBe(ownerMatch);
    const { rows } = await db.pool.query('SELECT seq FROM match_events WHERE match_id = $1', [ownerMatch]);
    expect(rows).toEqual([{ seq: 1 }]);
    expect((await owner.request('GET', `/v1/rooms/${room.id}`)).json<RoomView>()).toMatchObject({
      status: 'started',
      matchId: ownerMatch,
    });
  });

  it('un jugador en partida no puede crear ni unirse a otra sala', async () => {
    const [owner, guest, third] = await users(3);
    if (owner === undefined || guest === undefined || third === undefined) throw new Error('Faltan usuarios');
    const room = await createRoom(owner, 'public');
    await guest.request('POST', `/v1/rooms/${room.id}/join`);
    await owner.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
    await guest.request('POST', `/v1/rooms/${room.id}/ready`, { ready: true });
    expect((await owner.request('POST', '/v1/rooms', { visibility: 'public' })).json()).toMatchObject({
      code: 'ALREADY_IN_MATCH',
    });
    const other = await createRoom(third, 'public');
    expect((await guest.request('POST', `/v1/rooms/${other.id}/join`)).json()).toMatchObject({ code: 'ALREADY_IN_MATCH' });
  });

  it('un id que no es UUID se rechaza antes de llegar a la base de datos', async () => {
    const [user] = await users(1);
    if (user === undefined) throw new Error('Faltan usuarios');
    expect((await user.request('GET', '/v1/rooms/no-uuid')).statusCode).toBe(400);
    expect((await user.request('GET', `/v1/rooms/${randomUUID()}`)).statusCode).toBe(404);
  });
});
