/** Datos de personajes y acceso al arte recortado de las hojas de referencia (public/art). */
import type { WeaponId } from '@ashenfall/domain';

export type CharacterId = 'edrik' | 'sylwen' | 'borgrim';
export const CHARACTERS: readonly { id: CharacterId; name: string; race: string; weapon: string; lore: string }[] = [
  { id: 'edrik', name: 'Edrik', race: 'El Errante', weapon: 'Arco', lore: 'Un mercenario veterano que busca un nuevo propósito.' },
  { id: 'sylwen', name: 'Sylwen', race: 'La Última Elfa', weapon: 'Lanza', lore: 'Una arquera experta, silenciosa y precisa.' },
  { id: 'borgrim', name: 'Borgrim', race: 'El Forjador', weapon: 'Hacha', lore: 'Un enano orgulloso con un gran corazón.' },
];
export const DEFAULT_WEAPON: Readonly<Record<CharacterId, WeaponId>> = { edrik: 'bow', sylwen: 'spear', borgrim: 'axe' };

/** Apariencia equipada. Es solo visual: nada de esto llega a la física ni al daño. */
export interface Look {
  character: CharacterId;
  cloak: boolean;
  helm: boolean;
  veteran: boolean;
  boneBow: boolean;
  bronzeAxe: boolean;
  embers: boolean;
  frame: boolean;
  emblem: boolean;
}
export const baseLook = (character: CharacterId): Look => ({ character, cloak: false, helm: false, veteran: false, boneBow: false, bronzeAxe: false, embers: false, frame: false, emblem: false });

/** Tinte del personaje según lo equipado; 0xffffff es sin tinte. */
export const bodyTint = (look: Look): number => (look.cloak ? 0xc4dcff : look.veteran ? 0xffd4b8 : 0xffffff);
export const bodyFilter = (look: Look): string => (look.cloak ? 'saturate(.7) hue-rotate(190deg) brightness(1.1)' : look.veteran ? 'sepia(.35) saturate(1.4)' : 'none');

export type IconName = WeaponId | 'coin' | 'gear' | 'heart' | 'cloak' | 'helm' | 'hood' | 'emblem' | 'star' | 'potion' | 'trophy' | 'swords' | 'check' | 'cross' | 'shield' | 'crown' | 'pouch' | 'scroll';

export const iconUrl = (name: IconName): string => `/art/icon-${name}.webp`;
export const icon = (name: IconName, size = 24): string => `<img class="ico" src="${iconUrl(name)}" style="height:${String(size)}px" alt="" />`;

/** Marco para `border-image`: pintado una vez, suave y con esquinas de bronce. */
export function frameUrl(): string {
  const element = document.createElement('canvas');
  element.width = 48;
  element.height = 48;
  const ctx = element.getContext('2d');
  if (ctx === null) return '';
  const metal = ctx.createLinearGradient(0, 0, 48, 48);
  metal.addColorStop(0, '#c9a366');
  metal.addColorStop(0.5, '#6d5230');
  metal.addColorStop(1, '#b08a50');
  ctx.fillStyle = '#100c14';
  ctx.fillRect(0, 0, 48, 48);
  ctx.strokeStyle = metal;
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, 42, 42);
  ctx.strokeStyle = '#3a2c1c';
  ctx.lineWidth = 1;
  ctx.strokeRect(7.5, 7.5, 33, 33);
  for (const [x, y] of [[6, 6], [42, 6], [6, 42], [42, 42]] as const) {
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6);
    ctx.lineTo(x - 6, y);
    ctx.fill();
    ctx.fillStyle = '#f0d48a';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  return element.toDataURL();
}
