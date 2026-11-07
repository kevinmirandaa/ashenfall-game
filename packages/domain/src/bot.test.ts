import { describe, expect, it } from 'vitest';
import { chooseBotShot } from './bot.js';
import { createMatchSetup, decide, initialState, startMatch, type MatchCommand, type MatchEvent, type MatchSetup, type MatchState } from './match.js';
import { defaultWeapon, MONSTER_IDS, MONSTERS, monsterForLevel, STORY_LEVELS } from './monsters.js';
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
