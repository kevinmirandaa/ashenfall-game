/** Datos de personajes y acceso al arte recortado de las hojas de referencia (public/art). */
import type { CharacterId, FighterId, WeaponFamily } from '@ashenfall/domain';

export type { CharacterId, FighterId } from '@ashenfall/domain';
export const FAMILY_LABEL: Readonly<Record<WeaponFamily, string>> = {
  dagger: 'Dagas',
  bow: 'Arco',
  crossbow: 'Ballesta',
  axe: 'Hacha',
  sword: 'Espada',
  staff: 'Bastón',
  flask: 'Frascos',
  mace: 'Maza',
};
export const CHARACTERS: readonly { id: CharacterId; name: string; race: string; lore: string }[] = [
  { id: 'edrik', name: 'Edrik', race: 'El Errante', lore: 'Un mercenario encapuchado que prefiere una oportunidad a la suerte.' },
  { id: 'sylwen', name: 'Sylwen', race: 'La Última del Robledal', lore: 'Una arquera de raíz: el viento siempre le deja una pista.' },
  { id: 'borgrim', name: 'Borgrim', race: 'El Forjador', lore: 'Un enano de veta que responde con acero.' },
  { id: 'aldric', name: 'Aldric', race: 'Guardia del Alba', lore: 'Un caballero de armadura pesada que ya perdió su estandarte.' },
  { id: 'vaela', name: 'Vaela', race: 'Bruja de Hollín', lore: 'Lee presagios en las cenizas y los lanza contra quien se atreve.' },
  { id: 'corvus', name: 'Corvus', race: 'Médico de la Peste', lore: 'Cura a quien puede pagar y envenena a quien no.' },
  { id: 'anselmo', name: 'Anselmo', race: 'Hermano de Ceniza', lore: 'Un clérigo errante con una maza bendecida y poca paciencia.' },
  { id: 'mirelle', name: 'Mirelle', race: 'Espada de Vardem', lore: 'Una guerrera joven que juró no volver a bajar la guardia.' },
  { id: 'morveth', name: 'Morveth', race: 'El Hechicero Errante', lore: 'Dicen que murió hace siglos; él discute el detalle.' },
  { id: 'rurik', name: 'Rurik', race: 'Cazador de Maldiciones', lore: 'Rastrea monstruos con una ballesta y mucha costumbre.' },
];
/** Cómo se dibuja un luchador: solo su personaje o monstruo, sin apariencias sueltas. */
export interface Look {
  character: FighterId;
}
export const baseLook = (character: FighterId): Look => ({ character });

export type IconName = WeaponFamily | 'coin' | 'gear' | 'trophy' | 'swords' | 'check' | 'cross' | 'scroll';

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
