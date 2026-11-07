import type { CharacterId } from './weapons.js';

/** XP de una partida: jugarla da un poco, ganarla da bastante más. */
export const XP_PER_MATCH = 10;
export const XP_PER_WIN = 30;
/** XP que separa un nivel del siguiente. */
export const XP_PER_LEVEL = 80;
export const MAX_LEVEL = 20;

export interface Progress {
  readonly level: number;
  readonly xp: number;
  /** XP acumulada dentro del nivel actual y la necesaria para el siguiente. */
  readonly xpInLevel: number;
  readonly xpForNext: number;
}

/** El nivel se calcula siempre en el servidor, a partir de las partidas jugadas y ganadas. */
export function progressFor(played: number, wins: number): Progress {
  const xp = Math.max(0, played) * XP_PER_MATCH + Math.max(0, wins) * XP_PER_WIN;
  const level = Math.min(MAX_LEVEL, 1 + Math.floor(xp / XP_PER_LEVEL));
  return { level, xp, xpInLevel: level >= MAX_LEVEL ? XP_PER_LEVEL : xp % XP_PER_LEVEL, xpForNext: XP_PER_LEVEL };
}

/** Nivel mínimo para comprar cada personaje: el inicial desde el principio y el resto poco a poco. */
export const CHARACTER_LEVEL: Readonly<Record<CharacterId, number>> = {
  edrik: 1,
  sylwen: 2,
  borgrim: 3,
  aldric: 4,
  mirelle: 5,
  rurik: 6,
  vaela: 7,
  anselmo: 8,
  corvus: 9,
  morveth: 10,
};
