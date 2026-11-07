/** Pociones de un solo uso: se compran, se llevan a una partida y se gastan al usarlas (o se pierden al terminar). */
export const POTION_IDS = ['vital', 'ward', 'fury', 'focus'] as const;
export type PotionId = (typeof POTION_IDS)[number];

export interface PotionProfile {
  readonly id: PotionId;
  readonly name: string;
  readonly description: string;
  readonly price: number;
}

/** Vida que devuelve la poción vital. */
export const VITAL_HEAL = 30;
/** Con la piel de piedra, el siguiente daño recibido se multiplica por este factor. */
export const WARD_FACTOR = 0.6;
/** Con la furia, el siguiente disparo hace este múltiplo de daño. */
export const FURY_FACTOR = 1.4;
/** Máximo de pociones que se pueden llevar a una partida. */
export const POTION_LOADOUT_MAX = 3;

export const POTIONS: Readonly<Record<PotionId, PotionProfile>> = {
  vital: { id: 'vital', name: 'Elixir vital', description: `Recupera ${String(VITAL_HEAL)} de vida.`, price: 150 },
  ward: { id: 'ward', name: 'Piel de piedra', description: 'El siguiente daño que recibas se reduce un 40 %.', price: 200 },
  fury: { id: 'fury', name: 'Furia salvaje', description: 'Tu siguiente disparo hace un 40 % más de daño.', price: 250 },
  focus: { id: 'focus', name: 'Ojo de halcón', description: 'Tu siguiente disparo ignora el viento.', price: 200 },
};

export function isPotionId(value: string): value is PotionId {
  return (POTION_IDS as readonly string[]).includes(value);
}
