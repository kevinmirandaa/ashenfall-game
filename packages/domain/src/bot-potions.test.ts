import { describe, expect, it } from 'vitest';
import { chooseBotShot } from './bot.js';
import { createMatchSetup, decide, evolve, initialState, startMatch, type MatchCommand, type MatchEvent, type MatchSetup, type MatchState } from './match.js';
import { defaultWeapon, MONSTER_IDS, MONSTERS, monsterForLevel, STORY_LEVELS } from './monsters.js';
import { POTIONS, POTION_IDS, VITAL_HEAL, type PotionId } from './potions.js';
import { toPlayerView } from './view.js';
import { WEAPONS } from './weapons.js';

const A = 'a';
const B = 'b';
const zero = { intBelow: () => 0 };
const T0 = 1_000_000;

function begin(profiles: Parameters<typeof createMatchSetup>[0]['profiles'] = {}, overrides: Partial<MatchSetup> = {}): MatchState {
  const setup = { ...createMatchSetup({ matchId: 'm', playerIds: [A, B], profiles }, zero), windAccel: 0, ...overrides };
  return initialState(startMatch(setup, T0));
}

function applied(decision: ReturnType<typeof decide>): readonly MatchEvent[] {
  if (decision.kind !== 'applied') throw new Error(`Se esperaba applied y llegó ${JSON.stringify(decision)}`);
  return decision.events;
}

let counter = 0;
const id = (): string => `accion-${String(++counter)}`;

function shoot(state: MatchState, playerId: string, aim: { angleDeg: number; power: number }, weaponId: string): MatchCommand {
  return { type: 'shoot', playerId, actionId: id(), expectedVersion: state.version, weaponId, nowMs: T0 + 1, ...aim };
}

function drink(state: MatchState, playerId: string, potionId: string): MatchCommand {
  return { type: 'use_potion', playerId, actionId: id(), expectedVersion: state.version, potionId, nowMs: T0 + 1 };
}

const perfect = { aimErrorDeg: 0, powerError: 0 };

describe('monstruos', () => {
  it('son diez, no se pueden comprar y cada nivel apunta mejor y paga más', () => {
    expect(MONSTER_IDS).toHaveLength(10);
    expect(STORY_LEVELS).toBe(10);
    MONSTER_IDS.forEach((monster, index) => {
      const profile = MONSTERS[monster];
      expect(monsterForLevel(index + 1)).toBe(profile);
      expect(WEAPONS[profile.weaponId]).toBeDefined();
      expect(defaultWeapon(monster)).toBe(profile.weaponId);
      if (index > 0) {
        const previous = MONSTERS[MONSTER_IDS[index - 1] ?? 'skeleton'];
        expect(profile.aimErrorDeg).toBeLessThan(previous.aimErrorDeg);
        expect(profile.reward).toBeGreaterThan(previous.reward);
      }
    });
    expect(monsterForLevel(0)).toBeUndefined();
    expect(monsterForLevel(11)).toBeUndefined();
  });
});

describe('bot', () => {
  it('con error cero encuentra un disparo que impacta, con cualquier monstruo y arena', () => {
    for (const monster of MONSTER_IDS) {
      const state = begin({ [B]: { characterId: monster, displayName: MONSTERS[monster].name, weaponId: MONSTERS[monster].weaponId } });
      // El bot es B: se le da el turno.
      const botTurn: MatchState = { ...state, turn: state.turn === null ? null : { ...state.turn, playerId: B } };
      const aim = chooseBotShot(botTurn, B, perfect, zero);
      const events = applied(decide(botTurn, shoot(botTurn, B, aim, MONSTERS[monster].weaponId)));
      const shot = events[0]?.payload;
      expect(shot?.type === 'shot_resolved' ? shot.outcome.impactKind : null, monster).toBe('player');
    }
  });

  it('es determinista sin error y su error crece con el nivel bajo', () => {
    const state = begin({ [B]: { characterId: 'skeleton', displayName: 'Esqueleto' } });
    const botTurn: MatchState = { ...state, turn: state.turn === null ? null : { ...state.turn, playerId: B } };
    expect(chooseBotShot(botTurn, B, perfect, zero)).toEqual(chooseBotShot(botTurn, B, perfect, zero));
    const noisy = chooseBotShot(botTurn, B, { aimErrorDeg: 9, powerError: 14 }, { intBelow: () => 2000 });
    const exact = chooseBotShot(botTurn, B, perfect, zero);
    expect(Math.abs(noisy.angleDeg - exact.angleDeg)).toBeGreaterThan(0);
    expect(Math.abs(noisy.angleDeg - exact.angleDeg)).toBeLessThanOrEqual(9.1);
  });

  it('los monstruos usan su arma y una partida contra uno se reproduce igual que cualquier otra', () => {
    const state = begin({ [B]: { characterId: 'wraith', displayName: 'Sombra', weaponId: 'dagger_4' } });
    expect(toPlayerView(state, A)?.opponent).toMatchObject({ characterId: 'wraith', weaponId: 'dagger_4' });
  });
});

describe('pociones', () => {
  const loaded = (...potions: PotionId[]): MatchState => begin({ [A]: { characterId: 'sylwen', displayName: 'A', potions }, [B]: { characterId: 'sylwen', displayName: 'B' } });

  it('el catálogo tiene cuatro con su descripción y precio', () => {
    expect(POTION_IDS).toHaveLength(4);
    for (const potion of POTION_IDS) expect(POTIONS[potion].price).toBeGreaterThan(0);
  });

  it('solo se usan las que se llevan a la partida, una vez cada una', () => {
    const state = loaded('fury');
    expect(decide(state, drink(state, A, 'vital'))).toEqual({ kind: 'rejected', code: 'POTION_NOT_AVAILABLE' });
    expect(decide(state, drink(state, A, 'veneno'))).toEqual({ kind: 'rejected', code: 'POTION_NOT_AVAILABLE' });
    const after = applied(decide(state, drink(state, A, 'fury'))).reduce(evolve, state);
    expect(after.players[0].potions).toEqual([]);
    expect(after.players[0].buffs.fury).toBe(true);
  });

  it('usar una poción ocupa el turno y el rival no puede usarla por ti', () => {
    const state = loaded('vital');
    expect(decide(state, drink(state, B, 'vital'))).toEqual({ kind: 'rejected', code: 'NOT_YOUR_TURN' });
    const events = applied(decide(state, drink(state, A, 'vital')));
    const after = events.reduce(evolve, state);
    expect(after.turn?.playerId).toBe(B);
  });

  it('la acción repetida no se aplica dos veces', () => {
    const state = loaded('vital', 'vital');
    const command = drink(state, A, 'vital');
    const after = applied(decide(state, command)).reduce(evolve, state);
    expect(decide(after, command)).toMatchObject({ kind: 'duplicate' });
  });

  it('el elixir vital cura sin pasar de la vida inicial', () => {
    const base = loaded('vital');
    const hurt: MatchState = { ...base, players: [{ ...base.players[0], hp: 50 }, base.players[1]] };
    expect(applied(decide(hurt, drink(hurt, A, 'vital'))).reduce(evolve, hurt).players[0].hp).toBe(50 + VITAL_HEAL);
    const almost: MatchState = { ...base, players: [{ ...base.players[0], hp: 95 }, base.players[1]] };
    expect(applied(decide(almost, drink(almost, A, 'vital'))).reduce(evolve, almost).players[0].hp).toBe(100);
  });

  const damageOf = (state: MatchState, shooter: string, weaponId: string): number => {
    const aim = chooseBotShot(state, shooter, perfect, zero);
    const payload = applied(decide(state, shoot(state, shooter, aim, weaponId)))[0]?.payload;
    if (payload?.type !== 'shot_resolved') throw new Error('Se esperaba un disparo');
    return payload.damage;
  };

  it('la furia aumenta el siguiente disparo y se gasta, acierte o no', () => {
    const plain = loaded();
    const baseDamage = damageOf(plain, A, 'bow');
    const state = loaded('fury');
    const furious = applied(decide(state, drink(state, A, 'fury'))).reduce(evolve, state);
    const back: MatchState = { ...furious, turn: furious.turn === null ? null : { ...furious.turn, playerId: A } };
    expect(damageOf(back, A, 'bow')).toBeGreaterThan(baseDamage);
    const fired = applied(decide(back, shoot(back, A, { angleDeg: 45, power: 10 }, 'bow'))).reduce(evolve, back);
    expect(fired.players[0].buffs.fury).toBe(false);
  });

  it('la piel de piedra reduce el siguiente daño recibido y se gasta al recibirlo', () => {
    const plain = loaded();
    const baseDamage = damageOf(plain, A, 'bow');
    const state = begin({ [A]: { characterId: 'sylwen', displayName: 'A' }, [B]: { characterId: 'sylwen', displayName: 'B', potions: ['ward'] } });
    const onB: MatchState = { ...state, turn: state.turn === null ? null : { ...state.turn, playerId: B } };
    const warded = applied(decide(onB, drink(onB, B, 'ward'))).reduce(evolve, onB);
    const toA: MatchState = { ...warded, turn: warded.turn === null ? null : { ...warded.turn, playerId: A } };
    expect(damageOf(toA, A, 'bow')).toBeLessThan(baseDamage);
    const hit = applied(decide(toA, shoot(toA, A, chooseBotShot(toA, A, perfect, zero), 'bow'))).reduce(evolve, toA);
    expect(hit.players[1].buffs.ward).toBe(false);
  });

  it('el ojo de halcón ignora el viento en el siguiente disparo', () => {
    const windy = begin({ [A]: { characterId: 'sylwen', displayName: 'A', potions: ['focus'] }, [B]: { characterId: 'sylwen', displayName: 'B' } }, { windAccel: -100 });
    const focused = applied(decide(windy, drink(windy, A, 'focus'))).reduce(evolve, windy);
    const back: MatchState = { ...focused, turn: focused.turn === null ? null : { ...focused.turn, playerId: A } };
    const aim = chooseBotShot({ ...back, setup: { ...back.setup, windAccel: 0 } }, A, perfect, zero);
    const payload = applied(decide(back, shoot(back, A, aim, 'bow')))[0]?.payload;
    expect(payload?.type === 'shot_resolved' ? payload.outcome.impactKind : null).toBe('player');
  });

  it('lo que lleva el rival es información oculta, y su id de acción no viaja', () => {
    const state = loaded('vital', 'fury');
    expect(toPlayerView(state, A)?.you.potions).toEqual(['vital', 'fury']);
    expect(toPlayerView(state, B)?.opponent.potions).toBeUndefined();
    expect(JSON.stringify(toPlayerView(state, B))).not.toContain('vital');
  });
});
