import { starterWeapon, type CharacterId, type WeaponId } from './weapons.js';

/** Los monstruos solo existen como rivales del servidor: no se compran ni se eligen. */
export const MONSTER_IDS = ['skeleton', 'spider', 'werewolf', 'specter', 'witch', 'vampire', 'treant', 'wraith', 'dark_knight', 'golem'] as const;
export type MonsterId = (typeof MONSTER_IDS)[number];

/** Cualquiera que pueda aparecer en un duelo: un mercenario o un monstruo. */
export type FighterId = CharacterId | MonsterId;

export interface MonsterProfile {
  readonly id: MonsterId;
  readonly name: string;
  readonly title: string;
  readonly weaponId: WeaponId;
  /** Error máximo del bot al apuntar, en grados de ángulo y en puntos de potencia. */
  readonly aimErrorDeg: number;
  readonly powerError: number;
  /** Marcas de Ceniza por vencerlo en el modo historia. */
  readonly reward: number;
}

/**
 * El orden de la lista es el del modo historia: cada nivel apunta mejor y trae un arma más temible.
 */
export const MONSTERS: Readonly<Record<MonsterId, MonsterProfile>> = {
  skeleton: { id: 'skeleton', name: 'Esqueleto guerrero', title: 'Guardián de la cripta', weaponId: 'bow', aimErrorDeg: 9, powerError: 14, reward: 50 },
  spider: { id: 'spider', name: 'Araña de campanario', title: 'Tejedora de veneno', weaponId: 'flask_3', aimErrorDeg: 7.5, powerError: 12, reward: 70 },
  werewolf: { id: 'werewolf', name: 'Licántropo', title: 'Marcado por la luna', weaponId: 'dagger_3', aimErrorDeg: 6.5, powerError: 10, reward: 90 },
  specter: { id: 'specter', name: 'Espectro de ceniza', title: 'Eco de un viajero', weaponId: 'staff_2', aimErrorDeg: 5.5, powerError: 9, reward: 110 },
  witch: { id: 'witch', name: 'Bruja de hollín', title: 'Lectora de presagios', weaponId: 'staff_3', aimErrorDeg: 4.5, powerError: 7, reward: 135 },
  vampire: { id: 'vampire', name: 'Vampiro', title: 'Señor de la fortaleza carmesí', weaponId: 'sword_3', aimErrorDeg: 3.5, powerError: 6, reward: 165 },
  treant: { id: 'treant', name: 'Ent corrompido', title: 'Raíz del bosque muerto', weaponId: 'mace_3', aimErrorDeg: 3, powerError: 5, reward: 195 },
  wraith: { id: 'wraith', name: 'Sombra errante', title: 'Hambre sin rostro', weaponId: 'dagger_4', aimErrorDeg: 2.2, powerError: 4, reward: 230 },
  dark_knight: { id: 'dark_knight', name: 'Caballero oscuro', title: 'El último estandarte', weaponId: 'sword_4', aimErrorDeg: 1.6, powerError: 3, reward: 270 },
  golem: { id: 'golem', name: 'Golem de escoria', title: 'Guardián de piedra y metal', weaponId: 'mace_4', aimErrorDeg: 1, powerError: 2, reward: 350 },
};

export function isMonsterId(value: string): value is MonsterId {
  return (MONSTER_IDS as readonly string[]).includes(value);
}

/** Nivel del modo historia (empieza en 1) de un monstruo. */
export function storyLevelOf(id: MonsterId): number {
  return MONSTER_IDS.indexOf(id) + 1;
}

/** Monstruo de un nivel del modo historia, o undefined si no existe. */
export function monsterForLevel(level: number): MonsterProfile | undefined {
  const id = MONSTER_IDS[level - 1];
  return id === undefined ? undefined : MONSTERS[id];
}

/** Arma con la que sale un luchador si nadie fijó otra: la del monstruo o la común de su personaje. */
export function defaultWeapon(fighter: FighterId): WeaponId {
  return isMonsterId(fighter) ? MONSTERS[fighter].weaponId : starterWeapon(fighter);
}

export const STORY_LEVELS = MONSTER_IDS.length;
/** Recompensa de una partida rápida contra un bot, fija para que no sea una forma de repetir sin esfuerzo. */
export const QUICK_BOT_REWARD = 25;
