import type { ArenaId } from './arenas.js';
import type { EventPayload, MatchEvent, MatchResult, MatchState, PlayerSetup, TurnState } from './match.js';
import type { ImpactKind } from './physics.js';
import type { ActionId, MatchId, PlayerId, Vec2 } from './types.js';
import { defaultWeapon, type FighterId } from './monsters.js';
import type { PotionId } from './potions.js';
import type { HitZone, WeaponEffect, WeaponId } from './weapons.js';

export interface PlayerSideView {
  readonly playerId: PlayerId;
  readonly hp: number;
  readonly position: Vec2;
  readonly facing: 1 | -1;
  readonly connected: boolean;
  readonly characterId: FighterId;
  readonly displayName: string;
  readonly weaponId: WeaponId;
  /** Efectos de pociones activos: se ven en pantalla, así que son públicos. */
  readonly buffs: { readonly ward: boolean; readonly fury: boolean; readonly focus: boolean };
  /** Pociones que le quedan. Solo se envían al propio jugador: lo que lleva el rival es información oculta. */
  readonly potions?: readonly PotionId[];
}

/** Lo único que un jugador recibe del estado de la partida, también al reconectar. */
export interface PlayerMatchView {
  readonly matchId: MatchId;
  readonly status: MatchState['status'];
  readonly seq: number;
  readonly version: number;
  readonly arenaId: ArenaId;
  readonly windAccel: number;
  readonly maxRounds: number;
  readonly round: number;
  readonly physicsVersion: number;
  readonly turn: TurnState | null;
  readonly you: PlayerSideView;
  readonly opponent: PlayerSideView;
  readonly result: MatchResult | null;
}

export interface ShotView {
  readonly type: 'shot_resolved';
  readonly shooterId: PlayerId;
  readonly weaponId: WeaponId;
  readonly impactKind: ImpactKind;
  readonly impact: Vec2;
  readonly flightMs: number;
  readonly path: readonly Vec2[];
  readonly damage: number;
  readonly zone: HitZone | null;
  readonly targetHpAfter: number;
  /** Veneno o fuego del arma, o null: ya descontado de `targetHpAfter`. */
  readonly effect: WeaponEffect | null;
  /** Posición del impactado tras retroceder; la misma que tenía si no hubo daño. Pública para ambos jugadores. */
  readonly targetPosition: Vec2;
  /** Solo para quien disparó: confirma su intención. El rival nunca recibe estos tres campos. */
  readonly own?: { readonly actionId: ActionId; readonly angleDeg: number; readonly power: number };
}

export interface PotionView {
  readonly type: 'potion_used';
  readonly playerId: PlayerId;
  readonly potionId: PotionId;
  readonly hpAfter: number;
  /** Solo para quien la usó. El rival nunca recibe el id de la acción. */
  readonly own?: { readonly actionId: ActionId };
}

export type PlayerEventPayload = Exclude<EventPayload, { type: 'shot_resolved' | 'match_started' | 'potion_used' }> | ShotView | PotionView | MatchStartedView;

export interface MatchStartedView {
  readonly type: 'match_started';
  readonly view: PlayerMatchView;
}

export interface PlayerEvent {
  readonly seq: number;
  readonly atMs: number;
  readonly payload: PlayerEventPayload;
}

function sideView(state: MatchState, setup: PlayerSetup, own: boolean): PlayerSideView {
  const player = state.players.find((candidate) => candidate.playerId === setup.playerId);
  if (player === undefined) throw new Error('Estado corrupto: jugador sin estado');
  return {
    playerId: player.playerId,
    hp: player.hp,
    position: player.position,
    facing: setup.facing,
    connected: player.connected,
    characterId: setup.characterId ?? 'edrik',
    displayName: setup.displayName ?? 'Mercenario',
    weaponId: setup.weaponId ?? defaultWeapon(setup.characterId ?? 'edrik'),
    buffs: player.buffs,
    ...(own ? { potions: player.potions } : {}),
  };
}

/** Eventos de partidas anteriores al retroceso no traen posición: el impactado seguía donde estaba. */
function targetPositionBefore(stateAfter: MatchState, shooterId: PlayerId): Vec2 {
  const target = stateAfter.players.find((player) => player.playerId !== shooterId);
  if (target === undefined) throw new Error('Estado corrupto: partida sin rival');
  return target.position;
}

/**
 * Proyección autorizada del estado. Quien no participa recibe null: ninguna capa superior puede
 * construir una vista para un tercero por accidente.
 */
export function toPlayerView(state: MatchState, viewerId: PlayerId): PlayerMatchView | null {
  const [a, b] = state.setup.players;
  if (a.playerId !== viewerId && b.playerId !== viewerId) return null;
  const [mine, theirs] = a.playerId === viewerId ? [a, b] : [b, a];
  return {
    matchId: state.setup.matchId,
    status: state.status,
    seq: state.seq,
    version: state.version,
    arenaId: state.setup.arenaId,
    windAccel: state.setup.windAccel,
    maxRounds: state.setup.config.maxRounds,
    round: state.lastRound,
    physicsVersion: state.setup.physicsVersion,
    turn: state.turn,
    you: sideView(state, mine, true),
    opponent: sideView(state, theirs, false),
    result: state.result,
  };
}

/** Proyecta un evento para un jugador. `stateAfter` es el estado justo después de aplicar el evento. */
export function toPlayerEvent(event: MatchEvent, stateAfter: MatchState, viewerId: PlayerId): PlayerEvent | null {
  const view = toPlayerView(stateAfter, viewerId);
  if (view === null) return null;

  const { payload } = event;
  const base = { seq: event.seq, atMs: event.atMs };
  switch (payload.type) {
    case 'match_started':
      return { ...base, payload: { type: 'match_started', view } };
    case 'shot_resolved': {
      const shot: ShotView = {
        type: 'shot_resolved',
        shooterId: payload.shooterId,
        weaponId: payload.weaponId,
        impactKind: payload.outcome.impactKind,
        impact: payload.outcome.impact,
        flightMs: payload.outcome.flightMs,
        path: payload.outcome.path,
        damage: payload.damage,
        zone: payload.zone ?? null,
        targetHpAfter: payload.targetHpAfter,
        effect: payload.effect ?? null,
        targetPosition: payload.targetPosition ?? targetPositionBefore(stateAfter, payload.shooterId),
      };
      return {
        ...base,
        payload:
          payload.shooterId === viewerId
            ? { ...shot, own: { actionId: payload.actionId, angleDeg: payload.angleDeg, power: payload.power } }
            : shot,
      };
    }
    case 'potion_used': {
      const potion: PotionView = { type: 'potion_used', playerId: payload.playerId, potionId: payload.potionId, hpAfter: payload.hpAfter };
      return { ...base, payload: payload.playerId === viewerId ? { ...potion, own: { actionId: payload.actionId } } : potion };
    }
    default:
      return { ...base, payload };
  }
}
