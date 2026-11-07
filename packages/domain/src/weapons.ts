export const WEAPON_IDS = ['bow', 'spear', 'axe'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const CHARACTER_IDS = ['edrik', 'sylwen', 'borgrim'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** Cada personaje solo puede usar su arma. El servidor rechaza cualquier otra. */
export const CHARACTER_WEAPON: Readonly<Record<CharacterId, WeaponId>> = { edrik: 'bow', sylwen: 'spear', borgrim: 'axe' };

export function isCharacterId(value: string): value is CharacterId {
  return (CHARACTER_IDS as readonly string[]).includes(value);
}

export type HitZone = 'head' | 'body' | 'legs';
export type PowerTier = 'weak' | 'medium' | 'strong';

const ZONE_FACTOR: Readonly<Record<HitZone, number>> = { head: 1.5, body: 1, legs: 0.7 };
const TIER_FACTOR: Readonly<Record<PowerTier, number>> = { weak: 0.7, medium: 1, strong: 1.3 };

export function powerTier(power: number): PowerTier {
  if (power < 40) return 'weak';
  return power < 75 ? 'medium' : 'strong';
}

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

/** Mismo daño base en todas: las armas solo se distinguen por cómo vuelan. */
const BASE_DAMAGE = 26;

export const WEAPONS: Readonly<Record<WeaponId, WeaponProfile>> = {
  bow: { id: 'bow', maxSpeed: 1350, gravityScale: 1, windScale: 1, radius: 8, baseDamage: BASE_DAMAGE },
  spear: { id: 'spear', maxSpeed: 1550, gravityScale: 0.85, windScale: 0.5, radius: 5, baseDamage: BASE_DAMAGE },
  axe: { id: 'axe', maxSpeed: 1400, gravityScale: 1.25, windScale: 0.8, radius: 12, baseDamage: BASE_DAMAGE },
};

export const MAX_DAMAGE_PER_SHOT = 50;

export function isWeaponId(value: string): value is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(value);
}

/** Daño entero y acotado según el nivel de potencia y la zona alcanzada. */
export function computeDamage(weapon: WeaponProfile, power: number, zone: HitZone = 'body'): number {
  return Math.min(MAX_DAMAGE_PER_SHOT, Math.round(weapon.baseDamage * TIER_FACTOR[powerTier(power)] * ZONE_FACTOR[zone]));
}
