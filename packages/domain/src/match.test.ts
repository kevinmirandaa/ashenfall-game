import { describe, expect, it } from 'vitest';
import {
  createMatchSetup,
  decide,
  evolve,
  initialState,
  replay,
  startMatch,
  DEFAULT_MATCH_CONFIG,
  MatchInvariantError,
  type Decision,
  type MatchCommand,
  type MatchEvent,
  type MatchSetup,
  type MatchState,
} from './match.js';
import { muzzlePosition, playerHitbox, simulateShot } from './physics.js';
import { ARENAS, ARENA_IDS } from './arenas.js';
import type { RandomSource } from './types.js';
import { WEAPONS } from './weapons.js';

const T0 = 1_000_000;
const A = 'player-a';
const B = 'player-b';

/** Devuelve siempre el mismo orden: A a la izquierda y A empieza, en la primera arena y aparición. */
const zeroRandom: RandomSource = { intBelow: () => 0 };

function sequenceRandom(values: readonly number[]): RandomSource {
  let index = 0;
  return {
    intBelow: (max) => {
      const value = values[index % values.length] ?? 0;
      index += 1;
      return value % max;
    },
  };
}

function setup(overrides: Partial<MatchSetup> = {}): MatchSetup {
  return { ...createMatchSetup({ matchId: 'm1', playerIds: [A, B] }, zeroRandom), windAccel: 0, ...overrides };
}

function begin(overrides: Partial<MatchSetup> = {}): MatchState {
  return initialState(startMatch(setup(overrides), T0));
}

function applied(decision: Decision): readonly MatchEvent[] {
  if (decision.kind !== 'applied') throw new Error(`Se esperaba applied y llegó ${JSON.stringify(decision)}`);
  return decision.events;
}

function run(state: MatchState, command: MatchCommand): MatchState {
  return applied(decide(state, command)).reduce(evolve, state);
}

/** Encuentra un tiro que impacta al rival con la configuración de la partida. */
function aimingAtOpponent(state: MatchState, shooterId: string): { angleDeg: number; power: number } {
  const shooter = state.setup.players.find((player) => player.playerId === shooterId);
  const target = state.setup.players.find((player) => player.playerId !== shooterId);
  if (shooter === undefined || target === undefined) throw new Error('Jugadores inválidos');
  for (let angleDeg = 10; angleDeg <= 85; angleDeg += 1) {
    for (let power = 30; power <= 100; power += 1) {
      const outcome = simulateShot({
        origin: muzzlePosition(shooter.position, shooter.facing),
        facing: shooter.facing,
        angleDeg,
        power,
        weapon: WEAPONS.bow,
        windAccel: state.setup.windAccel,
        arena: ARENAS[state.setup.arenaId],
        target: playerHitbox(target.position),
      });
      if (outcome.impactKind === 'player') return { angleDeg, power };
    }
  }
  throw new Error('No hay tiro posible');
}

let actionCounter = 0;
function shoot(state: MatchState, playerId: string, aim: { angleDeg: number; power: number }, nowMs = T0 + 1): Extract<MatchCommand, { type: 'shoot' }> {
  actionCounter += 1;
  return {
    type: 'shoot',
    playerId,
    actionId: `action-${actionCounter}`,
    expectedVersion: state.version,
    weaponId: 'bow',
    nowMs,
    ...aim,
  };
}

/** Tiro corto que siempre cae cerca del tirador. */
const MISS = { angleDeg: 45, power: 10 };

function currentPlayer(state: MatchState): string {
  if (state.turn === null) throw new Error('La partida terminó');
  return state.turn.playerId;
}

describe('createMatchSetup', () => {
  it('rechaza una partida contra uno mismo', () => {
    expect(() => createMatchSetup({ matchId: 'm', playerIds: [A, A] }, zeroRandom)).toThrow(MatchInvariantError);
  });

  it('usa todo lo que el azar del servidor decide: arena, lados, viento y primer turno', () => {
    const seen = {
      arenas: new Set<string>(),
      winds: new Set<number>(),
      leftPlayers: new Set<string>(),
      first: new Set<string>(),
    };
    for (let seed = 0; seed < 300; seed += 1) {
      const result = createMatchSetup(
        { matchId: 'm', playerIds: [A, B] },
        sequenceRandom([seed, seed >> 1, seed >> 2, seed >> 3, seed >> 4]),
      );
      seen.arenas.add(result.arenaId);
      seen.winds.add(result.windAccel);
      seen.leftPlayers.add(result.players[0].playerId);
      seen.first.add(result.firstPlayerId);
      expect(Math.abs(result.windAccel)).toBeLessThanOrEqual(ARENAS[result.arenaId].maxWind);
    }
    expect(seen.arenas.size).toBe(ARENA_IDS.length);
    expect(seen.winds.size).toBeGreaterThan(1);
    expect(seen.leftPlayers).toEqual(new Set([A, B]));
    expect(seen.first).toEqual(new Set([A, B]));
  });

  it('los jugadores se enfrentan y no cambian de posición durante la partida', () => {
    let state = begin();
    const positions = state.setup.players.map((player) => player.position);
    expect(state.setup.players[0].facing).toBe(1);
    expect(state.setup.players[1].facing).toBe(-1);
    state = run(state, shoot(state, currentPlayer(state), MISS));
    expect(state.setup.players.map((player) => player.position)).toEqual(positions);
  });
});

describe('turnos', () => {
  it('la partida empieza con el primer jugador, 100 HP y la ronda 1', () => {
    const state = begin();
    expect(state.turn).toEqual({ playerId: A, round: 1, deadlineMs: T0 + 30_000 });
    expect(state.players.map((player) => player.hp)).toEqual([100, 100]);
  });

  it('alterna turno tras cada disparo y la ronda sube cuando ambos actuaron', () => {
    let state = begin();
    state = run(state, shoot(state, A, MISS));
    expect(state.turn).toMatchObject({ playerId: B, round: 1 });
    state = run(state, shoot(state, B, MISS));
    expect(state.turn).toMatchObject({ playerId: A, round: 2 });
  });

  it('rechaza con error tipado al jugador sin turno, sin alterar la partida', () => {
    const state = begin();
    expect(decide(state, shoot(state, B, MISS))).toEqual({ kind: 'rejected', code: 'NOT_YOUR_TURN' });
  });

  it('rechaza a quien no participa en la partida', () => {
    const state = begin();
    expect(decide(state, shoot(state, 'intruso', MISS))).toEqual({ kind: 'rejected', code: 'NOT_A_PARTICIPANT' });
  });

  it('rechaza una jugada sobre una versión vieja', () => {
    let state = begin();
    const stale = state.version;
    state = run(state, shoot(state, A, MISS));
    state = run(state, shoot(state, B, MISS));
    const command = { ...shoot(state, A, MISS), expectedVersion: stale };
    expect(decide(state, command)).toEqual({ kind: 'rejected', code: 'STALE_VERSION' });
  });

  it('rechaza un disparo después del plazo del turno', () => {
    const state = begin();
    expect(decide(state, shoot(state, A, MISS, T0 + 30_000))).toEqual({ kind: 'rejected', code: 'TURN_EXPIRED' });
  });

  it.each([
    ['ángulo negativo', { angleDeg: -1 }, 'INVALID_ANGLE'],
    ['ángulo mayor a 90', { angleDeg: 90.1 }, 'INVALID_ANGLE'],
    ['ángulo NaN', { angleDeg: Number.NaN }, 'INVALID_ANGLE'],
    ['ángulo infinito', { angleDeg: Number.POSITIVE_INFINITY }, 'INVALID_ANGLE'],
    ['potencia baja', { power: 9.99 }, 'INVALID_POWER'],
    ['potencia alta', { power: 100.01 }, 'INVALID_POWER'],
    ['arma inexistente', { weaponId: 'bazooka' }, 'INVALID_WEAPON'],
    ['arma con nombre de prototipo', { weaponId: '__proto__' }, 'INVALID_WEAPON'],
  ])('rechaza %s', (_name, change, code) => {
    const state = begin();
    expect(decide(state, { ...shoot(state, A, MISS), ...change })).toEqual({ kind: 'rejected', code });
  });

  it('acepta los valores límite de ángulo y potencia', () => {
    const state = begin();
    for (const aim of [
      { angleDeg: 0, power: 10 },
      { angleDeg: 90, power: 100 },
    ]) {
      expect(decide(state, shoot(state, A, aim)).kind).toBe('applied');
    }
  });
});

describe('idempotencia', () => {
  it('reenviar la misma jugada no la aplica dos veces y devuelve el evento original', () => {
    const state = begin();
    const command = shoot(state, A, MISS);
    const events = applied(decide(state, command));
    const after = events.reduce(evolve, state);
    expect(decide(after, command)).toEqual({ kind: 'duplicate', seq: events[0]?.seq });
    expect(after.version).toBe(state.version + 2);
  });

  it('también reconoce el reintento después de que la partida terminó', () => {
    let state = begin({ config: { ...DEFAULT_MATCH_CONFIG, startingHp: 1 } });
    const command = shoot(state, A, aimingAtOpponent(state, A));
    state = run(state, command);
    expect(state.status).toBe('finished');
    expect(decide(state, command).kind).toBe('duplicate');
  });

  it('un jugador no puede reutilizar el actionId del rival', () => {
    let state = begin();
    const command = shoot(state, A, MISS);
    state = run(state, command);
    expect(decide(state, { ...shoot(state, B, MISS), actionId: command.actionId })).toEqual({
      kind: 'rejected',
      code: 'ACTION_ID_CONFLICT',
    });
  });
});

describe('daño y fin de partida', () => {
  it('un impacto resta vida solo al rival y registra el daño', () => {
    const state = begin();
    const events = applied(decide(state, shoot(state, A, aimingAtOpponent(state, A))));
    const shot = events[0]?.payload;
    if (shot?.type !== 'shot_resolved') throw new Error('Se esperaba shot_resolved');
    expect(shot.outcome.impactKind).toBe('player');
    expect(shot.damage).toBeGreaterThan(0);
    const after = events.reduce(evolve, state);
    expect(after.players[0].hp).toBe(100);
    expect(after.players[1].hp).toBe(100 - shot.damage);
  });

  it('un tiro fallido no hace daño', () => {
    const state = begin();
    const after = run(state, shoot(state, A, MISS));
    expect(after.players.map((player) => player.hp)).toEqual([100, 100]);
  });

  it('termina por knockout, sin bajar de 0 HP y sin más turnos', () => {
    let state = begin({ config: { ...DEFAULT_MATCH_CONFIG, startingHp: 5 } });
    state = run(state, shoot(state, A, aimingAtOpponent(state, A)));
    expect(state.status).toBe('finished');
    expect(state.turn).toBeNull();
    expect(state.players[1].hp).toBe(0);
    expect(state.result).toMatchObject({ winnerId: A, loserId: B, reason: 'knockout', finalHp: [5, 0], rounds: 1 });
  });

  it('en el límite de rondas gana quien tiene más vida', () => {
    let state = begin({ config: { ...DEFAULT_MATCH_CONFIG, maxRounds: 1 } });
    state = run(state, shoot(state, A, aimingAtOpponent(state, A)));
    expect(state.status).toBe('in_progress');
    state = run(state, shoot(state, B, MISS));
    expect(state.result).toMatchObject({ winnerId: A, loserId: B, reason: 'round_limit', rounds: 1 });
  });

  it('en el límite de rondas con igual vida hay empate', () => {
    let state = begin({ config: { ...DEFAULT_MATCH_CONFIG, maxRounds: 2 } });
    for (let i = 0; i < 4; i += 1) state = run(state, shoot(state, currentPlayer(state), MISS));
    expect(state.result).toMatchObject({ winnerId: null, loserId: null, reason: 'round_limit', rounds: 2 });
  });

  it('una partida completa no supera 12 rondas', () => {
    let state = begin();
    let shots = 0;
    while (state.status === 'in_progress') {
      state = run(state, shoot(state, currentPlayer(state), MISS));
      shots += 1;
    }
    expect(shots).toBe(24);
    expect(state.result?.rounds).toBe(12);
  });

  it('el resultado es inmutable: toda acción posterior se rechaza', () => {
    let state = begin({ config: { ...DEFAULT_MATCH_CONFIG, startingHp: 1 } });
    state = run(state, shoot(state, A, aimingAtOpponent(state, A)));
    const result = state.result;
    expect(decide(state, shoot(state, B, MISS)).kind).toBe('rejected');
    expect(decide(state, { type: 'admin_terminate', nowMs: T0 })).toEqual({ kind: 'rejected', code: 'MATCH_FINISHED' });
    expect(decide(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: T0 + 99_999 })).toEqual({
      kind: 'rejected',
      code: 'MATCH_FINISHED',
    });
    expect(state.result).toBe(result);
    expect(() => evolve(state, { seq: state.seq + 1, atMs: T0, payload: { type: 'player_reconnected', playerId: A } })).toThrow(
      MatchInvariantError,
    );
  });
});

describe('timeout', () => {
  const afterDeadline = T0 + 30_000;

  it('no se aplica antes del plazo', () => {
    const state = begin();
    expect(decide(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: afterDeadline - 1 })).toEqual({
      kind: 'rejected',
      code: 'TURN_NOT_EXPIRED',
    });
  });

  it('un temporizador viejo no afecta a un turno nuevo', () => {
    const before = begin();
    const after = run(before, shoot(before, A, MISS));
    expect(decide(after, { type: 'turn_timeout', expectedVersion: before.version, nowMs: afterDeadline })).toEqual({
      kind: 'rejected',
      code: 'STALE_VERSION',
    });
  });

  it('pasa el turno sin daño y reinicia el plazo', () => {
    const state = begin();
    const after = run(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: afterDeadline });
    expect(after.turn).toEqual({ playerId: B, round: 1, deadlineMs: afterDeadline + 30_000 });
    expect(after.players.map((player) => player.hp)).toEqual([100, 100]);
    expect(after.players[0].consecutiveTimeouts).toBe(1);
  });

  it('dos timeouts consecutivos del mismo jugador son abandono', () => {
    let state = begin();
    state = run(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: afterDeadline });
    state = run(state, shoot(state, B, MISS, afterDeadline + 1));
    state = run(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: afterDeadline + 30_001 });
    expect(state.result).toMatchObject({ winnerId: B, loserId: A, reason: 'timeout_forfeit' });
  });

  it('disparar entre medias reinicia el contador', () => {
    let state = begin();
    state = run(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: afterDeadline });
    state = run(state, shoot(state, B, MISS, afterDeadline + 1));
    state = run(state, shoot(state, A, MISS, afterDeadline + 2));
    expect(state.players[0].consecutiveTimeouts).toBe(0);
  });

  it('un timeout en el último turno de la última ronda cierra la partida', () => {
    let state = begin({ config: { ...DEFAULT_MATCH_CONFIG, maxRounds: 1 } });
    state = run(state, shoot(state, A, MISS));
    state = run(state, { type: 'turn_timeout', expectedVersion: state.version, nowMs: T0 + 31_000 });
    expect(state.result).toMatchObject({ winnerId: null, reason: 'round_limit' });
  });
});

describe('desconexión y reconexión', () => {
  const disconnect = (state: MatchState, playerId: string, nowMs = T0 + 10): MatchState =>
    run(state, { type: 'player_disconnected', playerId, nowMs });

  it('marca la desconexión con plazo de gracia sin cambiar la versión de juego', () => {
    const state = begin();
    const after = disconnect(state, B);
    expect(after.players[1]).toMatchObject({ connected: false, graceDeadlineMs: T0 + 10 + 60_000 });
    expect(after.version).toBe(state.version);
    expect(after.seq).toBe(state.seq + 1);
    // La desconexión del rival no invalida la jugada que A ya tenía en camino.
    expect(decide(after, shoot(state, A, MISS)).kind).toBe('applied');
  });

  it('desconectar o reconectar dos veces no genera eventos repetidos', () => {
    const state = disconnect(begin(), B);
    expect(applied(decide(state, { type: 'player_disconnected', playerId: B, nowMs: T0 + 20 }))).toEqual([]);
    expect(applied(decide(begin(), { type: 'player_reconnected', playerId: B, nowMs: T0 + 20 }))).toEqual([]);
  });

  it('reconectar dentro del plazo cancela la gracia', () => {
    let state = disconnect(begin(), B);
    state = run(state, { type: 'player_reconnected', playerId: B, nowMs: T0 + 100 });
    expect(state.players[1]).toMatchObject({ connected: true, graceDeadlineMs: null });
    expect(decide(state, { type: 'grace_expired', playerId: B, nowMs: T0 + 90_000 })).toEqual({
      kind: 'rejected',
      code: 'PLAYER_CONNECTED',
    });
  });

  it('la gracia no vence antes de su plazo', () => {
    const state = disconnect(begin(), B);
    expect(decide(state, { type: 'grace_expired', playerId: B, nowMs: T0 + 100 })).toEqual({
      kind: 'rejected',
      code: 'GRACE_NOT_EXPIRED',
    });
  });

  it('al vencer la gracia, el jugador desconectado pierde por abandono', () => {
    let state = disconnect(begin(), B);
    state = run(state, { type: 'grace_expired', playerId: B, nowMs: T0 + 60_010 });
    expect(state.result).toMatchObject({ winnerId: A, loserId: B, reason: 'disconnect_forfeit' });
  });

  it('si ambos están desconectados, la partida termina sin ganador', () => {
    let state = disconnect(disconnect(begin(), B), A);
    state = run(state, { type: 'grace_expired', playerId: B, nowMs: T0 + 60_010 });
    expect(state.result).toMatchObject({ winnerId: null, reason: 'both_abandoned' });
  });

  it('un tercero no puede cambiar la presencia de la partida', () => {
    const state = begin();
    for (const type of ['player_disconnected', 'player_reconnected', 'grace_expired'] as const) {
      expect(decide(state, { type, playerId: 'intruso', nowMs: T0 })).toEqual({
        kind: 'rejected',
        code: 'NOT_A_PARTICIPANT',
      });
    }
  });
});

describe('administración', () => {
  it('terminar una partida no declara ganador', () => {
    const state = run(begin(), { type: 'admin_terminate', nowMs: T0 });
    expect(state.result).toMatchObject({ winnerId: null, reason: 'admin_terminated' });
  });
});

describe('log de eventos', () => {
  it('reproducir los eventos reconstruye exactamente el mismo estado', () => {
    let state = begin();
    const log: MatchEvent[] = [startMatch(setup(), T0)];
    const step = (command: MatchCommand): void => {
      const events = applied(decide(state, command));
      log.push(...events);
      state = events.reduce(evolve, state);
    };
    step(shoot(state, A, aimingAtOpponent(state, A)));
    step({ type: 'player_disconnected', playerId: A, nowMs: T0 + 5 });
    step(shoot(state, B, MISS));
    step({ type: 'player_reconnected', playerId: A, nowMs: T0 + 6 });
    step({ type: 'turn_timeout', expectedVersion: state.version, nowMs: T0 + 60_000 });
    expect(replay(log)).toEqual(state);
  });

  it('los números de secuencia son consecutivos, sin huecos', () => {
    let state = begin();
    const seqs: number[] = [state.seq];
    for (let i = 0; i < 6; i += 1) {
      const events = applied(decide(state, shoot(state, currentPlayer(state), MISS)));
      seqs.push(...events.map((event) => event.seq));
      state = events.reduce(evolve, state);
    }
    expect(seqs).toEqual(seqs.map((_, index) => index + 1));
  });

  it('rechaza un log con huecos, un log vacío o un inicio inválido', () => {
    const state = begin();
    expect(() => evolve(state, { seq: 5, atMs: T0, payload: { type: 'player_reconnected', playerId: A } })).toThrow(
      MatchInvariantError,
    );
    expect(() => replay([])).toThrow(MatchInvariantError);
    expect(() => initialState({ seq: 1, atMs: T0, payload: { type: 'player_reconnected', playerId: A } })).toThrow(
      MatchInvariantError,
    );
    expect(() => evolve(state, { ...startMatch(setup(), T0), seq: 2 })).toThrow(MatchInvariantError);
  });

  it('decidir no muta el estado de entrada', () => {
    const state = begin();
    const snapshot = structuredClone(state);
    decide(state, shoot(state, A, aimingAtOpponent(state, A)));
    expect(state).toEqual(snapshot);
  });
});
