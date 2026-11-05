export const WEAPON_IDS = ['bow', 'spear', 'axe', 'dagger'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export interface WeaponProfile {
  readonly id: WeaponId;
  /** Velocidad inicial al 100 % de potencia, en unidades de mundo por segundo. */
  readonly maxSpeed: number;
  readonly gravityScale: number;
  readonly windScale: number;
  /** Radio de colisión del proyectil, en unidades de mundo. */
  readonly radius: number;
  readonly baseDamage: number;
}

/** Valores iniciales de balance. Todas las armas están disponibles para todos: la tienda solo vende apariencia. */
export const WEAPONS: Readonly<Record<WeaponId, WeaponProfile>> = {
  bow: { id: 'bow', maxSpeed: 1350, gravityScale: 1, windScale: 1, radius: 8, baseDamage: 22 },
  spear: { id: 'spear', maxSpeed: 1550, gravityScale: 0.85, windScale: 0.5, radius: 5, baseDamage: 26 },
  axe: { id: 'axe', maxSpeed: 1400, gravityScale: 1.25, windScale: 0.8, radius: 12, baseDamage: 34 },
  dagger: { id: 'dagger', maxSpeed: 1700, gravityScale: 0.8, windScale: 0.6, radius: 4, baseDamage: 16 },
};

export const MAX_DAMAGE_PER_SHOT = 40;

export function isWeaponId(value: string): value is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(value);
}

/** Daño entero y acotado: un tiro a mínima potencia hace el 75 % del daño a máxima potencia, aprox. */
export function computeDamage(weapon: WeaponProfile, power: number): number {
  const powerFactor = 0.75 + 0.25 * (power / 100);
  return Math.min(MAX_DAMAGE_PER_SHOT, Math.round(weapon.baseDamage * powerFactor));
}
