import { createHash } from 'node:crypto';
import { isMonsterId, MONSTER_IDS, MONSTERS, type MatchState, type MonsterId, type MonsterProfile } from '@ashenfall/domain';

/** Identificador fijo de la cuenta de cada monstruo, creada por la migración 008. */
export function botUserId(monster: MonsterId): string {
  return `00000000-0000-4000-8000-${String(MONSTER_IDS.indexOf(monster) + 1).padStart(12, '0')}`;
}

/** Id de acción determinista: si dos réplicas deciden a la vez el mismo turno del bot, la segunda se descarta como duplicada. */
export function botActionId(matchId: string, version: number): string {
  const hex = createHash('sha256').update(`${matchId}:${String(version)}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Espera antes de que el bot dispare, para que se vea pensar y el jugador alcance a seguir la jugada. */
export function botThinkMs(matchId: string, version: number): number {
  const byte = createHash('sha256').update(`think:${matchId}:${String(version)}`).digest()[0] ?? 0;
  return 1400 + Math.round((byte / 255) * 1600);
}

export interface BotOnTurn {
  readonly playerId: string;
  readonly monster: MonsterProfile;
}

/** Quién mueve ahora, si es un monstruo; null si le toca a un humano o la partida terminó. */
export function botOnTurn(state: MatchState): BotOnTurn | null {
  if (state.status !== 'in_progress' || state.turn === null) return null;
  const turnId = state.turn.playerId;
  const setup = state.setup.players.find((player) => player.playerId === turnId);
  const fighter = setup?.characterId;
  return fighter !== undefined && isMonsterId(fighter) ? { playerId: turnId, monster: MONSTERS[fighter] } : null;
}

/** Tiempo que tarda el cliente en animar la jugada anterior antes de que el bot responda. */
export const ANIMATION_GRACE_MS = 3500;
