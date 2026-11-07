import { ARENAS, ARENA_IDS, arenaFor, type ArenaId, type Obstacle } from './arenas.js';
import { generateLayout } from './layout.js';
import {
  applyKnockback,
  hitZone,
  muzzlePosition,
  playerHitbox,
  simulateShot,
  PHYSICS_VERSION,
  type Facing,
  type ShotOutcome,
} from './physics.js';
import type { ActionId, MatchId, PlayerId, RandomSource, Vec2 } from './types.js';
import { defaultWeapon, type FighterId } from './monsters.js';
import { computeDamage, effectTotal, isWeaponId, WEAPONS, type HitZone, type WeaponEffect, type WeaponId } from './weapons.js';

export const ANGLE_RANGE = { min: 0, max: 90 } as const;
export const POWER_RANGE = { min: 10, max: 100 } as const;

export interface MatchConfig {
  readonly startingHp: number;
  readonly maxRounds: number;
  readonly turnDurationMs: number;
  readonly gracePeriodMs: number;
  readonly maxConsecutiveTimeouts: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  startingHp: 100,
  maxRounds: 12,
  turnDurationMs: 30_000,
  gracePeriodMs: 60_000,
  maxConsecutiveTimeouts: 2,
};

export interface PlayerSetup {
  readonly playerId: PlayerId;
  readonly position: Vec2;
  readonly facing: Facing;
  /** Fijados al empezar. Ausentes en partidas anteriores a este cambio. */
  readonly characterId?: FighterId;
  readonly displayName?: string;
  /** Arma fijada al empezar (la de un monstruo). Ausente: la común de su personaje. */
  readonly weaponId?: WeaponId;
}

export interface MatchSetup {
  readonly matchId: MatchId;
  readonly arenaId: ArenaId;
  /** Terreno y objetos sorteados al empezar. Ausente en partidas anteriores: arena llana. */
  readonly obstacles?: readonly Obstacle[];
  readonly windAccel: number;
  readonly players: readonly [PlayerSetup, PlayerSetup];
  readonly firstPlayerId: PlayerId;
  readonly config: MatchConfig;
  readonly physicsVersion: number;
}

export type EndReason =
  | 'knockout'
  | 'round_limit'
  | 'timeout_forfeit'
  | 'disconnect_forfeit'
  | 'both_abandoned'
  | 'admin_terminated';

export interface MatchResult {
  /** null significa empate o partida terminada sin ganador. */
  readonly winnerId: PlayerId | null;
  readonly loserId: PlayerId | null;
  readonly reason: EndReason;
  readonly finalHp: readonly [number, number];
  readonly rounds: number;
}

export type EventPayload =
  | { readonly type: 'match_started'; readonly setup: MatchSetup; readonly turnDeadlineMs: number }
  | {
      readonly type: 'shot_resolved';
      readonly actionId: ActionId;
      readonly shooterId: PlayerId;
      readonly weaponId: WeaponId;
      readonly angleDeg: number;
      readonly power: number;
      readonly outcome: ShotOutcome;
      readonly damage: number;
      readonly zone?: HitZone | null;
      readonly targetHpAfter: number;
      /** Veneno o fuego que deja el arma: ya está descontado de `targetHpAfter` y se muestra segundo a segundo. */
      readonly effect?: WeaponEffect;
      /** Dónde queda el impactado tras retroceder. Ausente en partidas anteriores: no se movía. */
      readonly targetPosition?: Vec2;
    }
  | { readonly type: 'turn_timed_out'; readonly playerId: PlayerId }
  | { readonly type: 'turn_started'; readonly playerId: PlayerId; readonly round: number; readonly deadlineMs: number }
  | { readonly type: 'player_disconnected'; readonly playerId: PlayerId; readonly graceDeadlineMs: number }
  | { readonly type: 'player_reconnected'; readonly playerId: PlayerId }
  | { readonly type: 'match_finished'; readonly result: MatchResult };

export interface MatchEvent {
  readonly seq: number;
  readonly atMs: number;
  readonly payload: EventPayload;
}

export interface PlayerState {
  readonly playerId: PlayerId;
  readonly hp: number;
  /** Posición actual: parte de la de aparición y cambia con cada impacto recibido. */
  readonly position: Vec2;
  readonly connected: boolean;
  readonly graceDeadlineMs: number | null;
  readonly consecutiveTimeouts: number;
}

export interface TurnState {
  readonly playerId: PlayerId;
  readonly round: number;
  readonly deadlineMs: number;
}

export interface MatchState {
  readonly setup: MatchSetup;
  readonly status: 'in_progress' | 'finished';
  /** Número del último evento aplicado; incluye los de presencia. */
  readonly seq: number;
  /** Versión del juego. Los eventos de presencia no la cambian, para no invalidar una jugada en curso. */
  readonly version: number;
  readonly players: readonly [PlayerState, PlayerState];
  readonly turn: TurnState | null;
  readonly lastRound: number;
  readonly appliedActions: readonly { readonly actionId: ActionId; readonly playerId: PlayerId; readonly seq: number }[];
  readonly result: MatchResult | null;
}

export type MatchCommand =
  | {
      readonly type: 'shoot';
      readonly playerId: PlayerId;
      readonly actionId: ActionId;
      readonly expectedVersion: number;
      readonly weaponId: string;
      readonly angleDeg: number;
      readonly power: number;
      readonly nowMs: number;
    }
  | { readonly type: 'turn_timeout'; readonly expectedVersion: number; readonly nowMs: number }
  | { readonly type: 'player_disconnected'; readonly playerId: PlayerId; readonly nowMs: number }
  | { readonly type: 'player_reconnected'; readonly playerId: PlayerId; readonly nowMs: number }
  | { readonly type: 'grace_expired'; readonly playerId: PlayerId; readonly nowMs: number }
  | { readonly type: 'admin_terminate'; readonly nowMs: number };

export type MatchErrorCode =
  | 'NOT_A_PARTICIPANT'
  | 'MATCH_FINISHED'
  | 'NOT_YOUR_TURN'
  | 'STALE_VERSION'
  | 'TURN_EXPIRED'
  | 'TURN_NOT_EXPIRED'
  | 'INVALID_WEAPON'
  | 'INVALID_ANGLE'
  | 'INVALID_POWER'
  | 'ACTION_ID_CONFLICT'
  | 'GRACE_NOT_EXPIRED'
  | 'PLAYER_CONNECTED';

export type Decision =
  | { readonly kind: 'applied'; readonly events: readonly MatchEvent[] }
  /** La misma jugada ya se confirmó: quien reintenta recibe el número del evento original. */
  | { readonly kind: 'duplicate'; readonly seq: number }
  | { readonly kind: 'rejected'; readonly code: MatchErrorCode };

export class MatchInvariantError extends Error {
  override readonly name = 'MatchInvariantError';
}

export interface CreateSetupInput {
  readonly matchId: MatchId;
  readonly playerIds: readonly [PlayerId, PlayerId];
  readonly config?: MatchConfig;
  /** Por jugador; quien no aparezca juega como Edrik. */
  readonly profiles?: Readonly<Record<PlayerId, { readonly characterId: FighterId; readonly displayName: string; readonly weaponId?: WeaponId }>>;
}

/**
 * Arena, obstáculos, posiciones y primer jugador los decide siempre el servidor. Todas las arenas tienen viento 0
 * (SCRUM-66); el campo se conserva para que las partidas guardadas se sigan reproduciendo igual.
 */
export function createMatchSetup(input: CreateSetupInput, random: RandomSource): MatchSetup {
  const [firstId, secondId] = input.playerIds;
  if (firstId === secondId) throw new MatchInvariantError('Una partida necesita dos jugadores distintos');

  const arenaId = pick(ARENA_IDS, random);
  const arena = ARENAS[arenaId];
  const { obstacles, spawn } = generateLayout(arenaId, random);
  const leftIsFirst = random.intBelow(2) === 0;
  const [leftId, rightId] = leftIsFirst ? [firstId, secondId] : [secondId, firstId];
  const windAccel = random.intBelow(arena.maxWind * 2 + 1) - arena.maxWind;

  return {
    matchId: input.matchId,
    arenaId,
    obstacles,
    windAccel,
    players: [
      { playerId: leftId, position: spawn.left, facing: 1, ...(input.profiles?.[leftId] ?? {}) },
      { playerId: rightId, position: spawn.right, facing: -1, ...(input.profiles?.[rightId] ?? {}) },
    ],
    firstPlayerId: random.intBelow(2) === 0 ? firstId : secondId,
    config: input.config ?? DEFAULT_MATCH_CONFIG,
    physicsVersion: PHYSICS_VERSION,
  };
}

function pick<T>(items: readonly T[], random: RandomSource): T {
  const item = items[random.intBelow(items.length)];
  if (item === undefined) throw new MatchInvariantError('RandomSource devolvió un índice fuera de rango');
  return item;
}

export function startMatch(setup: MatchSetup, nowMs: number): MatchEvent {
  return {
    seq: 1,
    atMs: nowMs,
    payload: { type: 'match_started', setup, turnDeadlineMs: nowMs + setup.config.turnDurationMs },
  };
}

/** Reconstruye el estado desde el log de eventos: base de la recuperación tras un reinicio y de la reproducción. */
export function replay(events: readonly MatchEvent[]): MatchState {
  const [first, ...rest] = events;
  if (first === undefined) throw new MatchInvariantError('El log de eventos está vacío');
  return rest.reduce(evolve, initialState(first));
}

export function initialState(event: MatchEvent): MatchState {
  const { payload } = event;
  if (payload.type !== 'match_started' || event.seq !== 1) {
    throw new MatchInvariantError('El primer evento debe ser match_started con seq 1');
  }
  const { setup } = payload;
  const toPlayer = (player: PlayerSetup): PlayerState => ({
    playerId: player.playerId,
    hp: setup.config.startingHp,
    position: player.position,
    connected: true,
    graceDeadlineMs: null,
    consecutiveTimeouts: 0,
  });
  return {
    setup,
    status: 'in_progress',
    seq: 1,
    version: 1,
    players: [toPlayer(setup.players[0]), toPlayer(setup.players[1])],
    turn: { playerId: setup.firstPlayerId, round: 1, deadlineMs: payload.turnDeadlineMs },
    lastRound: 1,
    appliedActions: [],
    result: null,
  };
}

function updatePlayer(
  players: MatchState['players'],
  playerId: PlayerId,
  change: (player: PlayerState) => PlayerState,
): MatchState['players'] {
  const update = (player: PlayerState): PlayerState => (player.playerId === playerId ? change(player) : player);
  return [update(players[0]), update(players[1])];
}

/** Aplica un evento ya decidido. No valida reglas, solo que el log sea coherente. */
export function evolve(state: MatchState, event: MatchEvent): MatchState {
  if (event.seq !== state.seq + 1) {
    throw new MatchInvariantError(`Secuencia inválida: se esperaba ${state.seq + 1} y llegó ${event.seq}`);
  }
  if (state.status === 'finished') {
    throw new MatchInvariantError('El resultado es inmutable: no se aplican eventos tras match_finished');
  }
  const base = { ...state, seq: event.seq };
  const { payload } = event;

  switch (payload.type) {
    case 'match_started':
      throw new MatchInvariantError('match_started solo puede ser el primer evento');
    case 'shot_resolved':
      return {
        ...base,
        version: state.version + 1,
        players: updatePlayer(
          updatePlayer(state.players, payload.shooterId, (player) => ({ ...player, consecutiveTimeouts: 0 })),
          opponentOf(state, payload.shooterId).playerId,
          (player) => ({ ...player, hp: payload.targetHpAfter, position: payload.targetPosition ?? player.position }),
        ),
        appliedActions: [
          ...state.appliedActions,
          { actionId: payload.actionId, playerId: payload.shooterId, seq: event.seq },
        ],
      };
    case 'turn_timed_out':
      return {
        ...base,
        version: state.version + 1,
        players: updatePlayer(state.players, payload.playerId, (player) => ({
          ...player,
          consecutiveTimeouts: player.consecutiveTimeouts + 1,
        })),
      };
    case 'turn_started':
      return {
        ...base,
        version: state.version + 1,
        turn: { playerId: payload.playerId, round: payload.round, deadlineMs: payload.deadlineMs },
        lastRound: payload.round,
      };
    case 'player_disconnected':
      return {
        ...base,
        players: updatePlayer(state.players, payload.playerId, (player) => ({
          ...player,
          connected: false,
          graceDeadlineMs: payload.graceDeadlineMs,
        })),
      };
    case 'player_reconnected':
      return {
        ...base,
        players: updatePlayer(state.players, payload.playerId, (player) => ({
          ...player,
          connected: true,
          graceDeadlineMs: null,
        })),
      };
    case 'match_finished':
      return { ...base, version: state.version + 1, status: 'finished', turn: null, result: payload.result };
  }
}

/** Próximo instante en que algo debe ocurrir sin intervención de los jugadores; null si la partida terminó. */
export function nextDeadline(state: MatchState): number | null {
  if (state.status === 'finished') return null;
  const deadlines = state.players.flatMap((player) => (player.graceDeadlineMs === null ? [] : [player.graceDeadlineMs]));
  if (state.turn !== null) deadlines.push(state.turn.deadlineMs);
  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

function findPlayer(state: MatchState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((player) => player.playerId === playerId);
}

function opponentOf(state: MatchState, playerId: PlayerId): PlayerState {
  const [a, b] = state.players;
  return a.playerId === playerId ? b : a;
}

function setupOf(state: MatchState, playerId: PlayerId): PlayerSetup {
  const [a, b] = state.setup.players;
  return a.playerId === playerId ? a : b;
}

function finished(state: MatchState, winnerId: PlayerId | null, reason: EndReason): EventPayload {
  const [a, b] = state.players;
  const result: MatchResult = {
    winnerId,
    loserId: winnerId === null ? null : opponentOf(state, winnerId).playerId,
    reason,
    finalHp: [a.hp, b.hp],
    rounds: state.lastRound,
  };
  return { type: 'match_finished', result };
}

/** Tras un disparo o un timeout: decide si la partida termina o a quién le toca. */
function followUp(state: MatchState, actorId: PlayerId, nowMs: number): EventPayload {
  const [a, b] = state.players;
  const opponent = opponentOf(state, actorId);
  const actor = opponentOf(state, opponent.playerId);

  if (opponent.hp <= 0) return finished(state, actorId, 'knockout');
  if (actor.consecutiveTimeouts >= state.setup.config.maxConsecutiveTimeouts) {
    return finished(state, opponent.playerId, 'timeout_forfeit');
  }

  const round = state.lastRound;
  const roundIsComplete = actorId !== state.setup.firstPlayerId;
  if (roundIsComplete && round >= state.setup.config.maxRounds) {
    const winnerId = a.hp === b.hp ? null : a.hp > b.hp ? a.playerId : b.playerId;
    return finished(state, winnerId, 'round_limit');
  }
  return {
    type: 'turn_started',
    playerId: opponent.playerId,
    round: roundIsComplete ? round + 1 : round,
    deadlineMs: nowMs + state.setup.config.turnDurationMs,
  };
}

/** Sella la carga con su secuencia y la encadena con la continuación que necesite el estado resultante. */
function emit(
  state: MatchState,
  nowMs: number,
  payload: EventPayload,
  next?: (after: MatchState) => EventPayload,
): Decision {
  const first: MatchEvent = { seq: state.seq + 1, atMs: nowMs, payload };
  if (next === undefined) return { kind: 'applied', events: [first] };
  const second: MatchEvent = { seq: state.seq + 2, atMs: nowMs, payload: next(evolve(state, first)) };
  return { kind: 'applied', events: [first, second] };
}

function rejected(code: MatchErrorCode): Decision {
  return { kind: 'rejected', code };
}

function inRange(value: number, range: { readonly min: number; readonly max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

function decideShoot(state: MatchState, command: Extract<MatchCommand, { type: 'shoot' }>): Decision {
  const { playerId, actionId, nowMs } = command;
  if (findPlayer(state, playerId) === undefined) return rejected('NOT_A_PARTICIPANT');

  const previous = state.appliedActions.find((action) => action.actionId === actionId);
  if (previous !== undefined) {
    return previous.playerId === playerId ? { kind: 'duplicate', seq: previous.seq } : rejected('ACTION_ID_CONFLICT');
  }

  if (state.turn === null) return rejected('MATCH_FINISHED');
  if (state.turn.playerId !== playerId) return rejected('NOT_YOUR_TURN');
  if (command.expectedVersion !== state.version) return rejected('STALE_VERSION');
  if (nowMs >= state.turn.deadlineMs) return rejected('TURN_EXPIRED');
  if (!isWeaponId(command.weaponId)) return rejected('INVALID_WEAPON');
  if (!inRange(command.angleDeg, ANGLE_RANGE)) return rejected('INVALID_ANGLE');
  if (!inRange(command.power, POWER_RANGE)) return rejected('INVALID_POWER');

  const weapon = WEAPONS[command.weaponId];
  const shooter = setupOf(state, playerId);
  // Cada luchador dispara siempre su arma (la de su personaje o la de su monstruo): no hay cambio de armas.
  if (shooter.characterId !== undefined && (shooter.weaponId ?? defaultWeapon(shooter.characterId)) !== weapon.id) return rejected('INVALID_WEAPON');
  const opponent = opponentOf(state, playerId);
  const shooterPosition = opponentOf(state, opponent.playerId).position;
  const targetBox = playerHitbox(opponent.position);
  const outcome = simulateShot({
    origin: muzzlePosition(shooterPosition, shooter.facing),
    facing: shooter.facing,
    angleDeg: command.angleDeg,
    power: command.power,
    weapon,
    windAccel: state.setup.windAccel,
    arena: arenaFor(state.setup),
    target: targetBox,
  });
  const zone = outcome.impactKind === 'player' ? hitZone(outcome.impact, targetBox) : null;
  const damage = zone === null ? 0 : computeDamage(weapon, command.power, zone);
  const effect: WeaponEffect | undefined = damage > 0 ? weapon.effect : undefined;
  const targetPosition =
    damage > 0
      ? applyKnockback(opponent.position, setupOf(state, opponent.playerId).facing, damage, arenaFor(state.setup))
      : opponent.position;

  return emit(
    state,
    nowMs,
    {
      type: 'shot_resolved',
      actionId,
      shooterId: playerId,
      weaponId: weapon.id,
      angleDeg: command.angleDeg,
      power: command.power,
      outcome,
      damage,
      zone,
      targetHpAfter: Math.max(0, opponent.hp - damage - effectTotal(effect)),
      ...(effect === undefined ? {} : { effect }),
      targetPosition,
    },
    (after) => followUp(after, playerId, nowMs),
  );
}

/** Función pura de decisión: estado + intención producen eventos, o un rechazo tipado que no altera la partida. */
export function decide(state: MatchState, command: MatchCommand): Decision {
  if (command.type === 'shoot') return decideShoot(state, command);
  if (state.status === 'finished') return rejected('MATCH_FINISHED');

  const { nowMs } = command;
  switch (command.type) {
    case 'turn_timeout': {
      const turn = state.turn;
      if (turn === null) return rejected('MATCH_FINISHED');
      if (command.expectedVersion !== state.version) return rejected('STALE_VERSION');
      if (nowMs < turn.deadlineMs) return rejected('TURN_NOT_EXPIRED');
      return emit(state, nowMs, { type: 'turn_timed_out', playerId: turn.playerId }, (after) =>
        followUp(after, turn.playerId, nowMs),
      );
    }
    case 'player_disconnected': {
      const player = findPlayer(state, command.playerId);
      if (player === undefined) return rejected('NOT_A_PARTICIPANT');
      if (!player.connected) return { kind: 'applied', events: [] };
      return emit(state, nowMs, {
        type: 'player_disconnected',
        playerId: command.playerId,
        graceDeadlineMs: nowMs + state.setup.config.gracePeriodMs,
      });
    }
    case 'player_reconnected': {
      const player = findPlayer(state, command.playerId);
      if (player === undefined) return rejected('NOT_A_PARTICIPANT');
      if (player.connected) return { kind: 'applied', events: [] };
      return emit(state, nowMs, { type: 'player_reconnected', playerId: command.playerId });
    }
    case 'grace_expired': {
      const player = findPlayer(state, command.playerId);
      if (player === undefined) return rejected('NOT_A_PARTICIPANT');
      if (player.connected || player.graceDeadlineMs === null) return rejected('PLAYER_CONNECTED');
      if (nowMs < player.graceDeadlineMs) return rejected('GRACE_NOT_EXPIRED');
      const opponent = opponentOf(state, command.playerId);
      return emit(
        state,
        nowMs,
        opponent.connected
          ? finished(state, opponent.playerId, 'disconnect_forfeit')
          : finished(state, null, 'both_abandoned'),
      );
    }
    case 'admin_terminate':
      return emit(state, nowMs, finished(state, null, 'admin_terminated'));
  }
}
