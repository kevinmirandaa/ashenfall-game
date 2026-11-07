import { randomUUID } from 'node:crypto';
import { CHARACTER_IDS, CHARACTER_LEVEL, CHARACTER_PRICE, STARTER_CHARACTER } from '@ashenfall/domain';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { grantLevel } from '../test-support/progress.js';

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

/** Usuario con saldo y nivel a medida: el personaje exige las dos cosas a la vez. */
async function userWith(balance: number, level = 1): Promise<TestUser> {
  const user = await registerUser(app);
  await db.pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [balance, user.id]);
  if (level > 1) await grantLevel(db, user.id, level);
  return user;
}
const buy = (user: TestUser, cosmeticId: string, purchaseId: string = randomUUID()) =>
  user.request('POST', '/v1/shop/purchases', { cosmeticId, purchaseId });
const balanceOf = async (user: TestUser) => (await user.request('GET', '/v1/me')).json<{ balance: number }>().balance;
const inventory = async (user: TestUser) => (await user.request('GET', '/v1/me/inventory')).json<{ items: { id: string }[] }>().items;
const choose = (user: TestUser, characterId: string) => user.request('POST', '/v1/me/character', { characterId });
const stats = async (user: TestUser) => (await user.request('GET', '/v1/me/stats')).json<{ level: number; played: number; wins: number; losses: number; draws: number }>();

describe('catálogo', () => {
  it('exige autenticación y solo vende personajes, a los precios del dominio', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/shop/catalog' })).statusCode).toBe(401);
    const user = await userWith(0);
    const { items } = (await user.request('GET', '/v1/shop/catalog')).json<{ items: { id: string; price: number; kind: string }[] }>();
    expect(items.every((item) => item.kind === 'character')).toBe(true);
    expect(items.find((item) => item.id === `char-${STARTER_CHARACTER}`)).toBeUndefined();
    for (const id of CHARACTER_IDS) {
      if (id !== STARTER_CHARACTER) expect(items.find((item) => item.id === `char-${id}`)?.price).toBe(CHARACTER_PRICE[id]);
    }
    expect(items).toHaveLength(CHARACTER_IDS.length - 1);
  });
});

describe('comprar un personaje', () => {
  it('descuenta el precio del servidor y entrega el personaje', async () => {
    const user = await userWith(1000, CHARACTER_LEVEL.sylwen);
    const response = await buy(user, 'char-sylwen');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ balance: 1000 - CHARACTER_PRICE.sylwen, duplicate: false });
    expect((await inventory(user)).map((item) => item.id)).toEqual(['char-sylwen']);
  });

  it('necesita las dos cosas: con dinero pero sin nivel y con nivel pero sin dinero se rechaza sin cambiar nada', async () => {
    const lowLevel = await userWith(5000, 1);
    expect((await buy(lowLevel, 'char-sylwen')).json()).toMatchObject({ code: 'LEVEL_TOO_LOW' });
    expect(await balanceOf(lowLevel)).toBe(5000);
    expect(await inventory(lowLevel)).toEqual([]);

    const broke = await userWith(CHARACTER_PRICE.sylwen - 1, CHARACTER_LEVEL.sylwen);
    expect((await buy(broke, 'char-sylwen')).json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await balanceOf(broke)).toBe(CHARACTER_PRICE.sylwen - 1);
    expect(await inventory(broke)).toEqual([]);
  });

  it('el nivel exigido crece con el personaje', async () => {
    const user = await userWith(10_000, CHARACTER_LEVEL.borgrim);
    expect((await buy(user, 'char-borgrim')).statusCode).toBe(200);
    expect((await buy(user, 'char-morveth')).json()).toMatchObject({ code: 'LEVEL_TOO_LOW' });
  });

  it('el cliente no puede fijar el precio', async () => {
    const user = await userWith(CHARACTER_PRICE.sylwen, CHARACTER_LEVEL.sylwen);
    const response = await user.request('POST', '/v1/shop/purchases', { cosmeticId: 'char-sylwen', purchaseId: randomUUID(), price: 0 });
    if (response.statusCode === 200) expect(await balanceOf(user)).toBe(0);
    else expect(response.statusCode).toBe(400);
  });

  it('rechaza artículos inexistentes y repetidos', async () => {
    const user = await userWith(5000, 10);
    expect((await buy(user, 'no-existe')).statusCode).toBe(404);
    await buy(user, 'char-sylwen');
    expect((await buy(user, 'char-sylwen')).json()).toMatchObject({ code: 'ALREADY_OWNED' });
    expect(await balanceOf(user)).toBe(5000 - CHARACTER_PRICE.sylwen);
  });

  it('reintentar con el mismo purchaseId nunca cobra dos veces', async () => {
    const user = await userWith(5000, 10);
    const purchaseId = randomUUID();
    const responses = await Promise.all(Array.from({ length: 10 }, () => buy(user, 'char-sylwen', purchaseId)));
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.filter((response) => !response.json<{ duplicate: boolean }>().duplicate)).toHaveLength(1);
    expect(await balanceOf(user)).toBe(5000 - CHARACTER_PRICE.sylwen);
  });

  it('compras simultáneas de personajes distintos nunca dejan saldo negativo', async () => {
    const user = await userWith(CHARACTER_PRICE.sylwen + CHARACTER_PRICE.borgrim, 10);
    const responses = await Promise.all(['char-sylwen', 'char-borgrim', 'char-aldric', 'char-vaela', 'char-morveth'].map((item) => buy(user, item)));
    const balance = await balanceOf(user);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(responses.some((response) => response.statusCode === 409)).toBe(true);
    const { rows } = await db.pool.query<{ total: number }>(`SELECT coalesce(sum(amount), 0)::int AS total FROM wallet_transactions WHERE user_id = $1`, [user.id]);
    expect(CHARACTER_PRICE.sylwen + CHARACTER_PRICE.borgrim + (rows[0]?.total ?? 0)).toBe(balance);
  });

  it('el mismo personaje con ids distintos a la vez se compra una sola vez', async () => {
    const user = await userWith(5000, 10);
    const responses = await Promise.all(Array.from({ length: 6 }, () => buy(user, 'char-sylwen')));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(await balanceOf(user)).toBe(5000 - CHARACTER_PRICE.sylwen);
  });

  it('el inventario de otro usuario no se ve afectado', async () => {
    const owner = await userWith(5000, 10);
    const other = await userWith(0);
    await buy(owner, 'char-sylwen');
    expect(await inventory(other)).toEqual([]);
  });
});

describe('elegir personaje', () => {
  it('se empieza solo con el inicial y los demás se eligen únicamente tras comprarlos', async () => {
    const user = await userWith(5000, CHARACTER_LEVEL.sylwen);
    expect((await choose(user, STARTER_CHARACTER)).statusCode).toBe(204);
    expect((await choose(user, 'sylwen')).json()).toMatchObject({ code: 'CHARACTER_NOT_OWNED' });
    expect((await user.request('GET', '/v1/me')).json<{ characterId: string }>().characterId).toBe(STARTER_CHARACTER);
    expect((await buy(user, 'char-sylwen')).statusCode).toBe(200);
    expect((await choose(user, 'sylwen')).statusCode).toBe(204);
    expect((await user.request('GET', '/v1/me')).json<{ characterId: string }>().characterId).toBe('sylwen');
  });

  it('el cliente no puede elegir un personaje inexistente ni un monstruo', async () => {
    const user = await userWith(0);
    expect((await choose(user, 'dragon')).statusCode).toBe(400);
    expect((await choose(user, 'golem')).statusCode).toBe(400);
  });
});

describe('nivel y estadísticas', () => {
  it('un jugador nuevo es de nivel 1 sin partidas', async () => {
    const user = await userWith(0);
    expect(await stats(user)).toMatchObject({ level: 1, played: 0, wins: 0, losses: 0, draws: 0 });
  });

  it('el nivel sube con las victorias reales y las cifras cuadran', async () => {
    const user = await userWith(0, 5);
    const result = await stats(user);
    expect(result.level).toBeGreaterThanOrEqual(5);
    expect(result.wins).toBe(result.played);
    expect(result.wins + result.losses + result.draws).toBe(result.played);
  });
});
