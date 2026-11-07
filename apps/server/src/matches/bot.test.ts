import { randomUUID } from 'node:crypto';
import { MONSTERS, monsterForLevel, POTIONS, type MatchSetup } from '@ashenfall/domain';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser, type TestUser } from '../test-support/api.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';
import { botActionId, botOnTurn, botUserId } from './bots.js';
import { MatchEngine } from './match-engine.js';
import { MatchEventStore } from './event-store.js';

let db: TestDatabase;
let app: FastifyInstance;
let engine: MatchEngine;

beforeAll(async () => {
  db = await createTestDatabase();
  app = buildTestApp(db);
  await app.ready();
  engine = new MatchEngine(new MatchEventStore(db.pool), () => undefined);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const startBot = (user: TestUser, body: object) => user.request('POST', '/v1/matches/bot', body);
const balanceOf = async (user: TestUser) => (await user.request('GET', '/v1/me')).json<{ balance: number }>().balance;

async function setupOf(matchId: string): Promise<MatchSetup> {
  const { rows } = await db.pool.query<{ payload: { setup: MatchSetup } }>('SELECT payload FROM match_events WHERE match_id = $1 AND seq = 1', [matchId]);
  const setup = rows[0]?.payload.setup;
  if (setup === undefined) throw new Error('Partida sin evento inicial');
  return setup;
}

describe('modo contra bot', () => {
  it('una partida rápida enfrenta a un monstruo con su arma y no cuenta como segunda partida del bot', async () => {
    const [one, two] = [await registerUser(app), await registerUser(app)];
    const first = await startBot(one, { mode: 'quick' });
    const second = await startBot(two, { mode: 'quick' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const { matchId, monsterId } = first.json<{ matchId: string; monsterId: keyof typeof MONSTERS }>();
    const setup = await setupOf(matchId);
    const bot = setup.players.find((player) => player.characterId === monsterId);
    expect(bot).toMatchObject({ characterId: monsterId, displayName: MONSTERS[monsterId].name, weaponId: MONSTERS[monsterId].weaponId });
    expect(bot?.playerId).toBe(botUserId(monsterId));
    const human = setup.players.find((player) => player.playerId === one.id);
    expect(human?.characterId).toBe('edrik');
    // Un humano no puede estar en dos partidas; un monstruo sí.
    expect((await startBot(one, { mode: 'quick' })).json()).toMatchObject({ code: 'ALREADY_IN_MATCH' });
  });

  it('los niveles de historia se desbloquean en orden y no se puede iniciar sesión como monstruo', async () => {
    const user = await registerUser(app);
    expect((await startBot(user, { mode: 'story', level: 2 })).json()).toMatchObject({ code: 'STORY_LEVEL_LOCKED' });
    expect((await startBot(user, { mode: 'story' })).statusCode).toBe(400);
    expect((await startBot(user, { mode: 'story', level: 11 })).statusCode).toBe(400);
    const story = (await user.request('GET', '/v1/me/story')).json<{ cleared: number; levels: { unlocked: boolean }[] }>();
    expect(story.cleared).toBe(0);
    expect(story.levels.map((level) => level.unlocked)).toEqual([true, ...Array<boolean>(9).fill(false)]);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'bot-skeleton@bots.ashenfall.invalid', password: 'cualquier-clave-larga' } });
    expect(login.statusCode).toBe(401);
  });

  it('el bot responde por su cuenta con una jugada válida y la partida sigue', async () => {
    const user = await registerUser(app);
    const { matchId } = (await startBot(user, { mode: 'story', level: 1 })).json<{ matchId: string }>();
    let state = await engine.state(matchId);
    if (botOnTurn(state) === null) {
      const decision = await engine.execute(matchId, { type: 'shoot', playerId: user.id, actionId: randomUUID(), expectedVersion: state.version, weaponId: 'dagger', angleDeg: 45, power: 10, nowMs: Date.now() });
      expect(decision.kind).toBe('applied');
      state = await engine.state(matchId);
      const { rows } = await db.pool.query<{ bot_due_ms: string | null }>('SELECT bot_due_ms FROM matches WHERE id = $1', [matchId]);
      expect(Number(rows[0]?.bot_due_ms)).toBeGreaterThan(Date.now());
    }
    expect(botOnTurn(state)).not.toBeNull();
    const before = state.seq;
    await engine.botTurn(matchId, Date.now());
    const after = await engine.state(matchId);
    expect(after.seq).toBeGreaterThan(before);
    expect(botOnTurn(after)).toBeNull();
    // Repetirlo con la misma versión no dispara dos veces: el id de la acción es el mismo.
    await engine.botTurn(matchId, Date.now());
    expect((await engine.state(matchId)).seq).toBe(after.seq);
    expect(botActionId(matchId, state.version)).toBe(botActionId(matchId, state.version));
    const { rows } = await db.pool.query<{ bot_due_ms: string | null }>('SELECT bot_due_ms FROM matches WHERE id = $1', [matchId]);
    expect(rows[0]?.bot_due_ms).toBeNull();
  });

  it('vencer a un monstruo paga su premio una sola vez y desbloquea el siguiente nivel; perder no paga', async () => {
    const user = await registerUser(app);
    const level = monsterForLevel(1);
    const { matchId } = (await startBot(user, { mode: 'story', level: 1 })).json<{ matchId: string }>();
    const before = await balanceOf(user);
    // El monstruo se queda sin conexión y vence su gracia: gana el humano.
    await engine.execute(matchId, { type: 'player_disconnected', playerId: botUserId('skeleton'), nowMs: Date.now() });
    await engine.execute(matchId, { type: 'grace_expired', playerId: botUserId('skeleton'), nowMs: Date.now() + 120_000 });
    expect((await engine.state(matchId)).result).toMatchObject({ winnerId: user.id });
    expect(await balanceOf(user)).toBe(before + (level?.reward ?? 0));
    const story = (await user.request('GET', '/v1/me/story')).json<{ cleared: number; levels: { unlocked: boolean }[] }>();
    expect(story.cleared).toBe(1);
    expect(story.levels[1]?.unlocked).toBe(true);
    expect((await startBot(user, { mode: 'story', level: 2 })).statusCode).toBe(201);

    // Perder contra un monstruo no entrega monedas ni al monstruo.
    const loser = await registerUser(app);
    const lost = (await startBot(loser, { mode: 'quick' })).json<{ matchId: string }>();
    const balance = await balanceOf(loser);
    await engine.execute(lost.matchId, { type: 'player_disconnected', playerId: loser.id, nowMs: Date.now() });
    await engine.execute(lost.matchId, { type: 'grace_expired', playerId: loser.id, nowMs: Date.now() + 120_000 });
    expect(await balanceOf(loser)).toBe(balance);
    const { rows } = await db.pool.query('SELECT 1 FROM wallet_transactions WHERE user_id = ANY($1::uuid[])', [[...Object.keys(MONSTERS).map((id) => botUserId(id as keyof typeof MONSTERS))]]);
    expect(rows).toHaveLength(0);
  });
});

describe('pociones', () => {
  const buy = (user: TestUser, potionId: string, purchaseId: string = randomUUID()) => user.request('POST', '/v1/shop/potions', { potionId, purchaseId });
  const funded = async (balance: number): Promise<TestUser> => {
    const user = await registerUser(app);
    await db.pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [balance, user.id]);
    return user;
  };

  it('se compran con el precio del dominio, sin cobrar dos veces un reintento ni dejar saldo negativo', async () => {
    const user = await funded(400);
    const purchaseId = randomUUID();
    const responses = await Promise.all(Array.from({ length: 5 }, () => buy(user, 'vital', purchaseId)));
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(await balanceOf(user)).toBe(400 - POTIONS.vital.price);
    const broke = await funded(POTIONS.vital.price - 1);
    expect((await buy(broke, 'vital')).json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await balanceOf(broke)).toBe(POTIONS.vital.price - 1);
    expect((await buy(user, 'inventada')).statusCode).toBe(400);
  });

  it('solo se pueden llevar las que se tienen, con un máximo, y se descuentan al empezar la partida', async () => {
    const user = await funded(2000);
    await buy(user, 'vital');
    await buy(user, 'fury');
    const loadout = (potions: string[]) => user.request('PUT', '/v1/me/loadout', { potions });
    expect((await loadout(['vital', 'vital'])).json()).toMatchObject({ code: 'POTION_NOT_OWNED' });
    expect((await loadout(['ward'])).json()).toMatchObject({ code: 'POTION_NOT_OWNED' });
    expect((await loadout(['vital', 'fury', 'vital', 'fury'])).statusCode).toBe(400);
    expect((await loadout(['vital', 'fury'])).statusCode).toBe(204);
    const { matchId } = (await startBot(user, { mode: 'quick' })).json<{ matchId: string }>();
    const human = (await setupOf(matchId)).players.find((player) => player.playerId === user.id);
    expect(human?.potions).toEqual(['vital', 'fury']);
    const stock = (await user.request('GET', '/v1/me/potions')).json<{ items: { id: string; quantity: number }[]; loadout: string[] }>();
    expect(stock.items.filter((item) => item.quantity > 0)).toEqual([]);
    expect(stock.loadout).toEqual([]);
  });

  it('lo que no se lleva a la partida se queda en el inventario', async () => {
    const user = await funded(2000);
    await buy(user, 'vital');
    await buy(user, 'vital');
    await user.request('PUT', '/v1/me/loadout', { potions: ['vital'] });
    await startBot(user, { mode: 'quick' });
    const stock = (await user.request('GET', '/v1/me/potions')).json<{ items: { id: string; quantity: number }[] }>();
    expect(stock.items.find((item) => item.id === 'vital')?.quantity).toBe(1);
  });
});
