/**
 * Familias de arma: cada personaje pertenece a una y usa siempre su arma común (SCRUM-66: no hay cambio de armas).
 * Los niveles superiores de cada familia, los dos últimos con veneno o fuego, solo los llevan los monstruos.
 */
export const WEAPON_FAMILIES = ['dagger', 'bow', 'crossbow', 'axe', 'sword', 'staff', 'flask', 'mace'] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number];

export const CHARACTER_IDS = ['edrik', 'sylwen', 'borgrim', 'aldric', 'vaela', 'corvus', 'anselmo', 'mirelle', 'morveth', 'rurik'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** El personaje inicial es gratis; el resto se compra con Marcas de Ceniza. */
export const STARTER_CHARACTER: CharacterId = 'edrik';

export const CHARACTER_FAMILY: Readonly<Record<CharacterId, WeaponFamily>> = {
  edrik: 'dagger',
  sylwen: 'bow',
  borgrim: 'axe',
  aldric: 'sword',
  vaela: 'staff',
  corvus: 'flask',
  anselmo: 'mace',
  mirelle: 'sword',
  morveth: 'staff',
  rurik: 'crossbow',
};

export const CHARACTER_PRICE: Readonly<Record<CharacterId, number>> = {
  edrik: 0,
  sylwen: 500,
  borgrim: 600,
  aldric: 700,
  mirelle: 700,
  rurik: 800,
  vaela: 900,
  anselmo: 900,
  corvus: 1000,
  morveth: 1200,
};

export function isCharacterId(value: string): value is CharacterId {
  return (CHARACTER_IDS as readonly string[]).includes(value);
}

export type HitZone = 'head' | 'body' | 'legs';
export type PowerTier = 'weak' | 'medium' | 'strong';

/** Las zonas siguen afectando al daño, pero la interfaz ya no las nombra: solo muestra el número. */
const ZONE_FACTOR: Readonly<Record<HitZone, number>> = { head: 1.4, body: 1, legs: 0.75 };
const TIER_FACTOR: Readonly<Record<PowerTier, number>> = { weak: 0.7, medium: 1, strong: 1.25 };

export function powerTier(power: number): PowerTier {
  if (power < 40) return 'weak';
  return power < 75 ? 'medium' : 'strong';
}

/** Daño por segundo que deja un arma especial, durante unos segundos tras el impacto. */
export interface WeaponEffect {
  readonly kind: 'poison' | 'burn';
  readonly perSecond: number;
  readonly seconds: number;
}

export interface WeaponProfile {
  readonly id: WeaponId;
  readonly family: WeaponFamily;
  readonly name: string;
  /** 1 ligera, 2 media, 3 pesada: más peso pide más potencia y más ángulo para llegar lejos; menos peso, lo contrario. */
  readonly weight: 1 | 2 | 3;
  readonly tier: 0 | 1 | 2 | 3;
  /** Velocidad inicial al 100 % de potencia, en unidades de mundo por segundo. */
  readonly maxSpeed: number;
  readonly gravityScale: number;
  readonly windScale: number;
  /** Radio de colisión del proyectil, en unidades de mundo. */
  readonly radius: number;
  readonly baseDamage: number;
  /** Precio de cuando se vendían armas; hoy no se vende ninguna y solo lo comprueban las pruebas de equilibrio. */
  readonly price: number;
  readonly effect?: WeaponEffect;
}

type Tier = 0 | 1 | 2 | 3;
interface WeaponSpec {
  readonly name: string;
  readonly damage: number;
  readonly price: number;
  readonly effect?: WeaponEffect;
}
const poison = (perSecond: number): WeaponEffect => ({ kind: 'poison', perSecond, seconds: 3 });
const burn = (perSecond: number): WeaponEffect => ({ kind: 'burn', perSecond, seconds: 3 });

interface FamilyBase {
  readonly weight: 1 | 2 | 3;
  readonly maxSpeed: number;
  readonly gravityScale: number;
  readonly windScale: number;
  readonly radius: number;
  readonly tiers: readonly [WeaponSpec, WeaponSpec, WeaponSpec, WeaponSpec];
}

/**
 * Ligeras: rápidas y tensas. Pesadas: lentas y de arco pronunciado. Los niveles 3 y 4 dejan veneno o fuego.
 */
const FAMILY_BASE: Readonly<Record<WeaponFamily, FamilyBase>> = {
  dagger: { weight: 1, maxSpeed: 1550, gravityScale: 0.75, windScale: 0.6, radius: 5, tiers: [
    { name: 'Daga de hierro', damage: 12, price: 0 }, { name: 'Daga dentada', damage: 15, price: 600 },
    { name: 'Daga curva ponzoñosa', damage: 18, price: 1600, effect: poison(2) }, { name: 'Daga del nigromante', damage: 21, price: 2800, effect: poison(4) } ] },
  bow: { weight: 2, maxSpeed: 1350, gravityScale: 1, windScale: 1, radius: 8, tiers: [
    { name: 'Arco de caza', damage: 12, price: 0 }, { name: 'Arco recurvo', damage: 15, price: 600 },
    { name: 'Arco de hueso ardiente', damage: 18, price: 1700, effect: burn(3) }, { name: 'Arco carmesí', damage: 21, price: 2900, effect: burn(5) } ] },
  crossbow: { weight: 2, maxSpeed: 1600, gravityScale: 0.8, windScale: 0.5, radius: 6, tiers: [
    { name: 'Ballesta de campo', damage: 12, price: 0 }, { name: 'Ballesta de guerra', damage: 15, price: 650 },
    { name: 'Ballesta de espinas', damage: 18, price: 1800, effect: poison(3) }, { name: 'Ballesta del cazador', damage: 21, price: 3000, effect: poison(5) } ] },
  axe: { weight: 3, maxSpeed: 1330, gravityScale: 1.25, windScale: 0.8, radius: 12, tiers: [
    { name: 'Hacha de leñador', damage: 12, price: 0 }, { name: 'Hacha de guerra', damage: 15, price: 700 },
    { name: 'Hacha de verdugo', damage: 18, price: 2000, effect: burn(4) }, { name: 'Hacha del destino', damage: 21, price: 3200, effect: burn(5) } ] },
  sword: { weight: 2, maxSpeed: 1450, gravityScale: 0.95, windScale: 0.7, radius: 8, tiers: [
    { name: 'Espada de guardia', damage: 12, price: 0 }, { name: 'Espada de acero', damage: 15, price: 650 },
    { name: 'Espada rúnica', damage: 18, price: 1900, effect: burn(3) }, { name: 'Espada real', damage: 21, price: 3000, effect: burn(5) } ] },
  staff: { weight: 1, maxSpeed: 1300, gravityScale: 0.6, windScale: 1.2, radius: 10, tiers: [
    { name: 'Orbe de ceniza', damage: 12, price: 0 }, { name: 'Cometa de escarcha', damage: 15, price: 700 },
    { name: 'Llama venenosa', damage: 18, price: 1700, effect: poison(3) }, { name: 'Bola infernal', damage: 21, price: 2800, effect: burn(5) } ] },
  flask: { weight: 1, maxSpeed: 1320, gravityScale: 1.1, windScale: 1, radius: 10, tiers: [
    { name: 'Frasco de lámpara', damage: 12, price: 0 }, { name: 'Frasco de hielo', damage: 15, price: 600 },
    { name: 'Frasco de peste', damage: 18, price: 1600, effect: poison(4) }, { name: 'Fuego líquido', damage: 21, price: 2700, effect: burn(5) } ] },
  mace: { weight: 3, maxSpeed: 1370, gravityScale: 1.3, windScale: 0.8, radius: 12, tiers: [
    { name: 'Maza de piedra', damage: 12, price: 0 }, { name: 'Maza de hierro', damage: 15, price: 650 },
    { name: 'Maza de gema', damage: 18, price: 1900, effect: burn(3) }, { name: 'Maza maldita', damage: 21, price: 3000, effect: poison(5) } ] },
};

export type WeaponId = `${WeaponFamily}` | `${WeaponFamily}_2` | `${WeaponFamily}_3` | `${WeaponFamily}_4`;

const suffix = (tier: Tier): '' | '_2' | '_3' | '_4' => (['', '_2', '_3', '_4'] as const)[tier];
const TIERS: readonly Tier[] = [0, 1, 2, 3];

function buildWeapon(family: WeaponFamily, tier: Tier): WeaponProfile {
  const base = FAMILY_BASE[family];
  const spec = base.tiers[tier];
  const profile: WeaponProfile = {
    id: `${family}${suffix(tier)}` as WeaponId,
    family,
    name: spec.name,
    weight: base.weight,
    tier,
    maxSpeed: base.maxSpeed,
    gravityScale: base.gravityScale,
    windScale: base.windScale,
    radius: base.radius,
    baseDamage: spec.damage,
    price: spec.price,
  };
  return spec.effect === undefined ? profile : { ...profile, effect: spec.effect };
}

export const WEAPON_IDS: readonly WeaponId[] = WEAPON_FAMILIES.flatMap((family) => TIERS.map((tier) => `${family}${suffix(tier)}` as WeaponId));

export const WEAPONS: Readonly<Record<WeaponId, WeaponProfile>> = Object.fromEntries(
  WEAPON_FAMILIES.flatMap((family) => TIERS.map((tier) => [`${family}${suffix(tier)}`, buildWeapon(family, tier)] as const)),
) as Record<WeaponId, WeaponProfile>;

/** Arma común de cada personaje: la única que usa. */
export function starterWeapon(characterId: CharacterId): WeaponId {
  return CHARACTER_FAMILY[characterId];
}

export const MAX_DAMAGE_PER_SHOT = 36;

export function isWeaponId(value: string): value is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(value);
}

/** Daño directo, entero y acotado, según el nivel de potencia y la zona alcanzada. */
export function computeDamage(weapon: WeaponProfile, power: number, zone: HitZone = 'body'): number {
  return Math.min(MAX_DAMAGE_PER_SHOT, Math.max(1, Math.round(weapon.baseDamage * TIER_FACTOR[powerTier(power)] * ZONE_FACTOR[zone])));
}

/** Total que el efecto quita durante sus segundos: el servidor lo suma al daño del impacto. */
export function effectTotal(effect: WeaponEffect | undefined): number {
  return effect === undefined ? 0 : effect.perSecond * effect.seconds;
}
