import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser, type TestUser } from '../test-support/api.js';
import { CHARACTER_IDS, CHARACTER_PRICE, STARTER_CHARACTER, WEAPON_FAMILIES, WEAPONS } from '@ashenfall/domain';
import { createMatchInTransaction } from '../matches/start.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';

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

async function userWith(balance: number): Promise<TestUser> {
  const user = await registerUser(app);
  await db.pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [balance, user.id]);
  return user;
}
const buy = (user: TestUser, cosmeticId: string, purchaseId: string = randomUUID()) =>
  user.request('POST', '/v1/shop/purchases', { cosmeticId, purchaseId });
const balanceOf = async (user: TestUser) => (await user.request('GET', '/v1/me')).json<{ balance: number }>().balance;
const inventory = async (user: TestUser) =>
  (await user.request('GET', '/v1/me/inventory')).json<{ items: { id: string; equipped: boolean }[] }>().items;

describe('tienda', () => {
  it('el catálogo exige autenticación y lista los precios', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/shop/catalog' })).statusCode).toBe(401);
    const user = await userWith(0);
    const { items } = (await user.request('GET', '/v1/shop/catalog')).json<{ items: { id: string; price: number }[] }>();
    expect(items.find((item) => item.id === 'frame-ash')?.price).toBe(100);
  });

  it('comprar descuenta el precio del servidor y entrega el artículo', async () => {
    const user = await userWith(250);
    const response = await buy(user, 'frame-ash');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ balance: 150, duplicate: false });
    expect((await inventory(user)).map((item) => item.id)).toEqual(['frame-ash']);
  });

  it('el cliente no puede fijar el precio', async () => {
    const user = await userWith(100);
    const response = await user.request('POST', '/v1/shop/purchases', { cosmeticId: 'frame-ash', purchaseId: randomUUID(), price: 0 });
    if (response.statusCode === 200) expect(await balanceOf(user)).toBe(0);
    else expect(response.statusCode).toBe(400);
  });

  it('sin saldo suficiente rechaza sin cambiar nada', async () => {
    const user = await userWith(99);
    expect((await buy(user, 'frame-ash')).json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await balanceOf(user)).toBe(99);
    expect(await inventory(user)).toEqual([]);
  });

  it('rechaza artículos inexistentes y repetidos', async () => {
    const user = await userWith(500);
    expect((await buy(user, 'no-existe')).statusCode).toBe(404);
    await buy(user, 'frame-ash');
    expect((await buy(user, 'frame-ash')).json()).toMatchObject({ code: 'ALREADY_OWNED' });
    expect(await balanceOf(user)).toBe(400);
  });

  it('reintentar con el mismo id no cobra dos veces, ni siquiera a la vez', async () => {
    const user = await userWith(500);
    const purchaseId = randomUUID();
    const responses = await Promise.all(Array.from({ length: 10 }, () => buy(user, 'frame-ash', purchaseId)));
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.filter((response) => !response.json<{ duplicate: boolean }>().duplicate)).toHaveLength(1);
    expect(await balanceOf(user)).toBe(400);
  });

  it('compras simultáneas de artículos distintos nunca dejan saldo negativo', async () => {
    const user = await userWith(250);
    const items = ['frame-ash', 'emblem-brotherhood', 'wpn-dagger-2', 'wpn-dagger-3', 'cloak-frost', 'trail-embers'];
    const responses = await Promise.all(items.map((item) => buy(user, item)));
    const balance = await balanceOf(user);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(responses.some((response) => response.statusCode === 409)).toBe(true);
    const { rows } = await db.pool.query<{ total: number }>(
      `SELECT coalesce(sum(amount), 0)::int AS total FROM wallet_transactions WHERE user_id = $1`,
      [user.id],
    );
    expect(250 + (rows[0]?.total ?? 0)).toBe(balance);
  });

  it('el mismo artículo con ids distintos a la vez se compra una sola vez', async () => {
    const user = await userWith(1000);
    const responses = await Promise.all(Array.from({ length: 6 }, () => buy(user, 'frame-ash')));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(await balanceOf(user)).toBe(900);
  });
});

describe('equipar', () => {
  const equip = (user: TestUser, id: string, equipped: boolean) =>
    user.request('POST', `/v1/me/inventory/${id}/equip`, { equipped });

  it('solo se equipa lo propio y un artículo por tipo', async () => {
    const user = await userWith(3000);
    expect((await equip(user, 'wpn-dagger-2', true)).statusCode).toBe(404);
    await buy(user, 'wpn-dagger-2');
    await buy(user, 'wpn-dagger-3');
    expect((await equip(user, 'wpn-dagger-2', true)).statusCode).toBe(204);
    expect((await equip(user, 'wpn-dagger-3', true)).statusCode).toBe(204);
    expect(await inventory(user)).toEqual([
      expect.objectContaining({ id: 'wpn-dagger-2', equipped: false }),
      expect.objectContaining({ id: 'wpn-dagger-3', equipped: true }),
    ]);
    expect((await equip(user, 'wpn-dagger-3', false)).statusCode).toBe(204);
  });

  it('el inventario de otro usuario no se ve afectado', async () => {
    const owner = await userWith(100);
    const other = await userWith(0);
    await buy(owner, 'frame-ash');
    expect(await inventory(other)).toEqual([]);
    expect((await equip(other, 'frame-ash', true)).statusCode).toBe(404);
  });
});

describe('personajes y armas', () => {
  const choose = (user: TestUser, characterId: string) => user.request('POST', '/v1/me/character', { characterId });

  it('el catálogo replica los precios del dominio', async () => {
    const user = await userWith(0);
    const { items } = (await user.request('GET', '/v1/shop/catalog')).json<{ items: { id: string; price: number; kind: string }[] }>();
    for (const id of CHARACTER_IDS) {
      if (id === STARTER_CHARACTER) expect(items.find((item) => item.id === `char-${id}`)).toBeUndefined();
      else expect(items.find((item) => item.id === `char-${id}`)).toMatchObject({ kind: 'character', price: CHARACTER_PRICE[id] });
    }
    for (const family of WEAPON_FAMILIES) {
      for (const tier of ['_2', '_3', '_4'] as const) {
        const weapon = WEAPONS[`${family}${tier}`];
        expect(items.find((item) => item.id === `wpn-${family}-${tier.slice(1)}`)).toMatchObject({ kind: `weapon_${family}`, price: weapon.price });
      }
    }
  });

  it('se empieza solo con el inicial: los demás se eligen únicamente tras comprarlos', async () => {
    const user = await userWith(2000);
    expect((await choose(user, STARTER_CHARACTER)).statusCode).toBe(204);
    expect((await choose(user, 'sylwen')).json()).toMatchObject({ code: 'CHARACTER_NOT_OWNED' });
    expect((await user.request('GET', '/v1/me')).json<{ characterId: string }>().characterId).toBe(STARTER_CHARACTER);
    expect((await buy(user, 'char-sylwen')).statusCode).toBe(200);
    expect((await choose(user, 'sylwen')).statusCode).toBe(204);
    expect((await user.request('GET', '/v1/me')).json<{ characterId: string }>().characterId).toBe('sylwen');
  });

  it('el cliente no puede elegir un personaje inexistente', async () => {
    const user = await userWith(0);
    expect((await choose(user, 'dragon')).statusCode).toBe(400);
  });

  it('la partida usa el arma equipada de la familia del personaje y descarta las de otra', async () => {
    const [a, b] = [await userWith(5000), await userWith(5000)];
    await buy(a, 'wpn-dagger-3');
    await buy(a, 'wpn-bow-3');
    await a.request('POST', '/v1/me/inventory/wpn-dagger-3/equip', { equipped: true });
    await a.request('POST', '/v1/me/inventory/wpn-bow-3/equip', { equipped: true });
    const client = await db.pool.connect();
    let matchId: string;
    try {
      matchId = await createMatchInTransaction(client, [a.id, b.id], Date.now());
    } finally {
      client.release();
    }
    const { rows } = await db.pool.query<{ payload: { setup: { players: { playerId: string; weaponId?: string }[] } } }>(
      `SELECT payload FROM match_events WHERE match_id = $1 AND seq = 1`,
      [matchId],
    );
    const players = rows[0]?.payload.setup.players ?? [];
    // a es Edrik (dagas): la daga especial cuenta, el arco equipado no.
    expect(players.find((player) => player.playerId === a.id)?.weaponId).toBe('dagger_3');
    expect(players.find((player) => player.playerId === b.id)?.weaponId).toBeUndefined();
  });
});
