import { ARENAS } from './arenas.js';
import { ANGLE_RANGE, POWER_RANGE, type MatchState } from './match.js';
import { muzzlePosition, playerHitbox, simulateShot, type ShotOutcome } from './physics.js';
import type { PlayerId, RandomSource } from './types.js';
import { defaultWeapon } from './monsters.js';
import { WEAPONS } from './weapons.js';

export interface BotAim {
  readonly angleDeg: number;
  readonly power: number;
}

export interface BotSkill {
  readonly aimErrorDeg: number;
  readonly powerError: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * El bot calcula el disparo que un jugador experto haría —buscando con la misma física del servidor— y luego
 * le añade el error propio de su nivel. Es una función pura y acotada: unas 600 simulaciones como máximo.
 */
export function chooseBotShot(state: MatchState, botId: PlayerId, skill: BotSkill, random: RandomSource): BotAim {
  const [first, second] = state.setup.players;
  const botSetup = first.playerId === botId ? first : second;
  const foe = state.players.find((player) => player.playerId !== botId);
  const me = state.players.find((player) => player.playerId === botId);
  if (foe === undefined || me === undefined) throw new Error('Estado corrupto: partida sin los dos jugadores');
  const weapon = WEAPONS[botSetup.weaponId ?? (botSetup.characterId === undefined ? 'bow' : defaultWeapon(botSetup.characterId))];
  const arena = ARENAS[state.setup.arenaId];
  const target = playerHitbox(foe.position);
  const wind = me.buffs.focus ? 0 : state.setup.windAccel;
  const targetX = foe.position.x;

  const fire = (angleDeg: number, power: number): ShotOutcome =>
    simulateShot({ origin: muzzlePosition(me.position, botSetup.facing), facing: botSetup.facing, angleDeg, power, weapon, windAccel: wind, arena, target });
  // Menor es mejor: un impacto directo vale 0 y los demás se miden por lo lejos que caen del rival.
  const score = (outcome: ShotOutcome): number => (outcome.impactKind === 'player' ? 0 : 1 + Math.abs(outcome.impact.x - targetX));

  let best: BotAim = { angleDeg: 45, power: 60 };
  let bestScore = Number.POSITIVE_INFINITY;
  const consider = (angleDeg: number, power: number): void => {
    const value = score(fire(angleDeg, power));
    if (value < bestScore) {
      bestScore = value;
      best = { angleDeg, power };
    }
  };
  for (let angle = 8; angle <= 80; angle += 4) for (let power = 20; power <= 100; power += 5) consider(angle, power);
  const center = best;
  for (let angle = center.angleDeg - 3; angle <= center.angleDeg + 3; angle += 1) {
    for (let power = center.power - 4; power <= center.power + 4; power += 2) {
      consider(clamp(angle, ANGLE_RANGE.min, ANGLE_RANGE.max), clamp(power, POWER_RANGE.min, POWER_RANGE.max));
    }
  }
  // Error uniforme en [-máximo, +máximo]: a mayor nivel, más cerca del tiro perfecto.
  const noise = (limit: number): number => ((random.intBelow(2001) - 1000) / 1000) * limit;
  return {
    angleDeg: Math.round(clamp(best.angleDeg + noise(skill.aimErrorDeg), ANGLE_RANGE.min, ANGLE_RANGE.max) * 10) / 10,
    power: Math.round(clamp(best.power + noise(skill.powerError), POWER_RANGE.min, POWER_RANGE.max) * 10) / 10,
  };
}
