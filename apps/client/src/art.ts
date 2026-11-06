/** Sprites, iconos y marcos dibujados por código: sin descargas y con paleta común a todo el juego. */
import type { WeaponId } from '@ashenfall/domain';

export type CharacterId = 'edrik' | 'sylwen' | 'borgrim';
export const CHARACTERS: readonly { id: CharacterId; name: string; race: string; weapon: string; lore: string }[] = [
  { id: 'edrik', name: 'Edrik', race: 'Humano', weapon: 'Arco', lore: 'Veterano de la Caída de las Cenizas. Nunca falla dos veces.' },
  { id: 'sylwen', name: 'Sylwen', race: 'Elfa', weapon: 'Lanza', lore: 'La última elfa del Bosque de los Susurros.' },
  { id: 'borgrim', name: 'Borgrim', race: 'Enano', weapon: 'Hacha', lore: 'El forjador de Ashenfall. Sus hachas hablan por él.' },
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

type Ctx = CanvasRenderingContext2D;

function canvas(width: number, height: number): [HTMLCanvasElement, Ctx] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const ctx = element.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('Canvas 2D no disponible');
  ctx.imageSmoothingEnabled = false;
  return [element, ctx];
}

function r(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function line(ctx: Ctx, color: string, x0: number, y0: number, x1: number, y1: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i += 1) r(ctx, color, Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps));
}

/** Contorno oscuro de un píxel: es lo que da a todos los sprites el mismo acabado. */
function outline(element: HTMLCanvasElement, ctx: Ctx, color: readonly [number, number, number] = [13, 10, 14]): void {
  const { width, height } = element;
  const image = ctx.getImageData(0, 0, width, height);
  const source = image.data.slice();
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && (source[(y * width + x) * 4 + 3] ?? 0) > 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (solid(x, y) || !(solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) continue;
      const at = (y * width + x) * 4;
      image.data[at] = color[0];
      image.data[at + 1] = color[1];
      image.data[at + 2] = color[2];
      image.data[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// ---------- Personajes ----------
export const FRAME_W = 40;
export const FRAME_H = 52;
/** 0-1 reposo, 2 disparo, 3 golpe, 4 caído. */
export const FRAMES = 5;

interface Palette {
  hood: readonly [string, string, string] | null;
  hair: readonly [string, string];
  skin: readonly [string, string];
  armor: readonly [string, string, string];
  leather: readonly [string, string];
  legs: string;
  boots: string;
  trim: string;
}

function paletteOf(look: Look): Palette {
  if (look.character === 'sylwen') {
    return { hood: null, hair: ['#eceaf2', '#a9acc4'], skin: ['#e0c0aa', '#b08d7c'], armor: ['#2f7067', '#1f4a47', '#123230'], leather: ['#8d93a3', '#5a6072'], legs: '#b3b8c6', boots: '#7b8294', trim: '#c49a4e' };
  }
  if (look.character === 'borgrim') {
    return { hood: null, hair: ['#b8552e', '#7a3120'], skin: ['#ba8461', '#8a5a40'], armor: ['#46566c', '#2e3a4a', '#1c2531'], leather: ['#8a5a2e', '#5e3a22'], legs: '#3a2d2a', boots: '#6b4226', trim: '#c49a4e' };
  }
  const veteran = look.veteran;
  return {
    hood: veteran ? ['#7d3a34', '#5a2826', '#3a1a1c'] : ['#d4d3da', '#94939f', '#5d5c6b'],
    hair: veteran ? ['#8f8f96', '#5f5f66'] : ['#3a2a22', '#241a16'],
    skin: ['#a8775a', '#7a5240'],
    armor: ['#4d4d5c', '#35353f', '#23232c'],
    leather: ['#94602f', '#5e3a22'],
    legs: '#2c2b34',
    boots: '#6a4226',
    trim: veteran ? '#d9a441' : '#8a6a3c',
  };
}

function drawCloak(ctx: Ctx, x: number, y: number, wide: number): void {
  r(ctx, '#a9c8e6', x - wide - 2, y + 2, wide * 2 + 4, 15);
  r(ctx, '#6f93bd', x - wide - 2, y + 11, wide * 2 + 4, 7);
  r(ctx, '#dbeaf6', x - wide - 2, y + 2, 2, 12);
  r(ctx, '#4b6b94', x + wide, y + 6, 2, 12);
  for (let i = 0; i < wide * 2 + 4; i += 3) r(ctx, '#4b6b94', x - wide - 2 + i, y + 18, 2, 1);
}

function drawFigure(ctx: Ctx, look: Look, ox: number, frame: number): void {
  const p = paletteOf(look);
  const dwarf = look.character === 'borgrim';
  const elf = look.character === 'sylwen';
  const cx = ox + 20;
  const bob = frame === 1 ? 1 : 0;
  const lean = frame === 2 ? 1 : frame === 3 ? -2 : 0;
  const wide = dwarf ? 9 : elf ? 6 : 7;
  const torsoTop = (dwarf ? 25 : 23) + bob;
  const torsoH = dwarf ? 14 : 15;
  const feet = 50;
  const legTop = torsoTop + torsoH;

  // Piernas y botas no se mueven: el personaje nunca se desplaza.
  const legW = dwarf ? 6 : 5;
  for (const side of [-1, 1]) {
    const lx = side < 0 ? cx - legW - 1 : cx + 1;
    r(ctx, p.legs, lx, legTop, legW, feet - legTop - 4);
    r(ctx, p.boots, lx - (side < 0 ? 1 : 0), feet - 5, legW + 1, 5);
    r(ctx, p.leather[1], lx - (side < 0 ? 1 : 0), feet - 5, legW + 1, 1);
  }
  const tx = cx + lean;
  if (look.cloak) drawCloak(ctx, tx, torsoTop, wide);
  // Torso
  r(ctx, p.armor[1], tx - wide, torsoTop, wide * 2, torsoH);
  r(ctx, p.armor[0], tx - wide, torsoTop, 3, torsoH - 2);
  r(ctx, p.armor[2], tx + wide - 3, torsoTop + 1, 3, torsoH - 1);
  r(ctx, p.armor[0], tx - 2, torsoTop + 2, 5, 5);
  r(ctx, p.trim, tx - 1, torsoTop + 3, 2, 2);
  // Cinto y correa
  r(ctx, p.leather[1], tx - wide, torsoTop + torsoH - 4, wide * 2, 3);
  r(ctx, p.trim, tx - 1, torsoTop + torsoH - 4, 3, 3);
  line(ctx, p.leather[0], tx - wide + 1, torsoTop + 1, tx + wide - 2, torsoTop + torsoH - 5);
  if (elf) {
    // Falda larga de la elfa.
    r(ctx, p.armor[1], tx - wide - 1, legTop - 2, wide * 2 + 2, 9);
    r(ctx, p.armor[0], tx - wide - 1, legTop - 2, 3, 9);
    r(ctx, p.trim, tx - wide - 1, legTop + 6, wide * 2 + 2, 1);
  }
  // Hombreras y brazos
  for (const side of [-1, 1]) {
    const sx = side < 0 ? tx - wide - 3 : tx + wide - 1;
    r(ctx, p.leather[1], sx, torsoTop + 3, 4, 10);
    r(ctx, p.skin[1], sx, torsoTop + 12, 4, 2);
    r(ctx, p.leather[0], sx, torsoTop, 4, 5);
    r(ctx, '#aeb4c2', sx, torsoTop, 2, 2);
  }
  // Cabeza
  const hw = dwarf ? 7 : 6;
  const hh = dwarf ? 10 : 10;
  const hy = torsoTop - hh - 1;
  r(ctx, p.skin[0], tx - hw + 1, hy + 1, hw * 2 - 2, hh);
  r(ctx, p.skin[1], tx + hw - 3, hy + 1, 2, hh);
  // Ojos mirando hacia delante
  const eye = frame === 4 ? p.skin[1] : '#120d10';
  r(ctx, eye, tx + 0, hy + 5, 2, 2);
  r(ctx, eye, tx + 4, hy + 5, 1, 2);
  if (dwarf) {
    r(ctx, p.hair[0], tx - hw, hy - 1, hw * 2, 5);
    r(ctx, p.hair[1], tx - hw, hy + 2, 2, 6);
    r(ctx, p.hair[1], tx - 1, hy + 4, 7, 1);
    r(ctx, p.hair[0], tx - hw + 1, hy + 7, hw * 2 - 1, 7);
    r(ctx, p.hair[1], tx - hw + 3, hy + 13, hw * 2 - 5, 4);
    r(ctx, p.hair[0], tx - 2, hy + 16, 5, 3);
    r(ctx, p.skin[1], tx + 1, hy + 7, 2, 1);
  } else if (elf) {
    r(ctx, p.hair[0], tx - hw, hy - 1, hw * 2, 4);
    r(ctx, p.hair[0], tx - hw - 1, hy, 4, 18);
    r(ctx, p.hair[1], tx - hw, hy + 4, 2, 14);
    r(ctx, p.hair[0], tx + hw - 2, hy + 1, 2, 7);
    r(ctx, p.skin[0], tx - hw - 3, hy + 4, 3, 2);
    r(ctx, p.skin[1], tx - hw - 4, hy + 3, 2, 1);
  } else if (p.hood !== null) {
    r(ctx, p.hood[1], tx - hw - 1, hy - 2, hw * 2 + 1, 5);
    r(ctx, p.hood[0], tx - hw, hy - 3, hw * 2 - 2, 3);
    r(ctx, p.hood[0], tx - hw - 2, hy, 4, 12);
    r(ctx, p.hood[2], tx - hw - 1, hy + 8, 4, 6);
    r(ctx, p.hood[1], tx + hw - 1, hy + 1, 2, 9);
    r(ctx, p.hood[1], tx - hw - 2, hy + 12, hw * 2 + 4, 3);
    r(ctx, p.hood[2], tx - 3, hy + 12, 8, 2);
    r(ctx, p.hair[0], tx - 2, hy + 8, 7, 3);
    r(ctx, p.hair[1], tx - 1, hy + 10, 5, 1);
  }
  if (look.helm) {
    r(ctx, '#8d93a3', tx - hw - 1, hy - 3, hw * 2 + 2, 7);
    r(ctx, '#c6cad6', tx - hw, hy - 3, 4, 3);
    r(ctx, '#565b6c', tx + hw - 3, hy - 2, 4, 6);
    r(ctx, '#c49a4e', tx - hw - 1, hy + 3, hw * 2 + 2, 1);
    r(ctx, '#8a3a33', tx - 1, hy - 7, 3, 4);
  }
  if (look.emblem) r(ctx, '#d9a441', tx + 2, torsoTop + 7, 2, 2);
}

/** Tira de fotogramas lista para Phaser o para una vista previa en la tienda. */
export function characterSheet(look: Look): HTMLCanvasElement {
  const [sheet, ctx] = canvas(FRAME_W * FRAMES, FRAME_H);
  for (let frame = 0; frame < 4; frame += 1) drawFigure(ctx, look, frame * FRAME_W, frame);
  const [down, downCtx] = canvas(FRAME_W, FRAME_H);
  drawFigure(downCtx, look, 0, 4);
  ctx.save();
  ctx.translate(4 * FRAME_W + 22, 36);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(down, -36, -24);
  ctx.restore();
  outline(sheet, ctx);
  return sheet;
}

// ---------- Armas y proyectiles ----------
export const WEAPON_SIZE = 40;
/** Punto de agarre dentro de la textura del arma. */
export const WEAPON_GRIP = { x: 14, y: 20 } as const;

function drawWeapon(ctx: Ctx, id: WeaponId, look: Look): void {
  const { x: gx, y: gy } = WEAPON_GRIP;
  r(ctx, '#a8775a', gx - 3, gy - 1, 5, 3);
  if (id === 'bow') {
    const [wood, dark] = look.boneBow ? ['#e3dcc8', '#a39a84'] : ['#94602f', '#5e3a22'];
    for (let dy = -14; dy <= 14; dy += 1) {
      const dx = Math.round(9 * (1 - (dy * dy) / 196));
      r(ctx, wood, gx + 1 + dx, gy + dy, 2, 1);
      r(ctx, dark, gx + 1 + dx, gy + dy, 1, 1);
    }
    r(ctx, '#d9d4c6', gx, gy - 14, 1, 28);
    r(ctx, '#c49a4e', gx + 9, gy - 1, 3, 3);
    r(ctx, '#d3c4a2', gx, gy, 18, 1);
    r(ctx, '#c6cad6', gx + 18, gy - 1, 3, 3);
  } else if (id === 'spear') {
    r(ctx, '#6e4526', gx - 11, gy, 32, 2);
    r(ctx, '#94602f', gx - 11, gy, 32, 1);
    r(ctx, '#c6cad6', gx + 20, gy - 2, 3, 6);
    r(ctx, '#e3e6ee', gx + 22, gy - 1, 3, 4);
    r(ctx, '#e3e6ee', gx + 25, gy, 1, 2);
    r(ctx, '#c49a4e', gx + 18, gy - 1, 2, 4);
  } else if (id === 'axe') {
    const [head, edge] = look.bronzeAxe ? ['#a8743a', '#e0b070'] : ['#7f8596', '#d3d7e2'];
    r(ctx, '#5e3a22', gx - 6, gy, 24, 2);
    r(ctx, '#94602f', gx - 6, gy, 24, 1);
    r(ctx, head, gx + 13, gy - 8, 5, 18);
    r(ctx, head, gx + 16, gy - 10, 3, 22);
    r(ctx, edge, gx + 19, gy - 10, 2, 22);
    r(ctx, '#3f4350', gx + 12, gy - 1, 2, 4);
  } else {
    r(ctx, '#5e3a22', gx - 4, gy, 5, 2);
    r(ctx, '#c49a4e', gx + 1, gy - 2, 2, 6);
    r(ctx, '#aeb4c2', gx + 3, gy - 1, 11, 4);
    r(ctx, '#e3e6ee', gx + 3, gy - 1, 11, 2);
    r(ctx, '#e3e6ee', gx + 14, gy, 2, 2);
  }
}

export function weaponTexture(id: WeaponId, look: Look): HTMLCanvasElement {
  const [element, ctx] = canvas(WEAPON_SIZE, WEAPON_SIZE);
  drawWeapon(ctx, id, look);
  outline(element, ctx);
  return element;
}

export function projectileTexture(id: WeaponId, look: Look): HTMLCanvasElement {
  const [element, ctx] = canvas(24, 24);
  const y = 11;
  if (id === 'bow') {
    r(ctx, look.boneBow ? '#e3dcc8' : '#b58a55', 3, y, 16, 1);
    r(ctx, '#e3e6ee', 19, y - 1, 3, 3);
    r(ctx, '#b3392f', 2, y - 1, 3, 3);
  } else if (id === 'spear') {
    r(ctx, '#94602f', 0, y, 19, 2);
    r(ctx, '#e3e6ee', 19, y - 1, 4, 4);
  } else if (id === 'axe') {
    const [head, edge] = look.bronzeAxe ? ['#a8743a', '#e0b070'] : ['#7f8596', '#d3d7e2'];
    r(ctx, '#94602f', 11, 3, 2, 18);
    r(ctx, head, 13, 3, 5, 9);
    r(ctx, edge, 18, 3, 2, 9);
  } else {
    r(ctx, '#5e3a22', 4, y, 4, 2);
    r(ctx, '#c49a4e', 8, y - 1, 1, 4);
    r(ctx, '#e3e6ee', 9, y - 1, 9, 3);
    r(ctx, '#e3e6ee', 18, y, 2, 1);
  }
  outline(element, ctx);
  return element;
}

// ---------- Iconos ----------
export type IconName = WeaponId | 'coin' | 'gear' | 'wind' | 'heart' | 'cloak' | 'helm' | 'embers' | 'frame' | 'emblem' | 'skin' | 'potion' | 'trophy' | 'skull' | 'swords' | 'lock' | 'check';

const ICONS: Readonly<Record<IconName, (ctx: Ctx) => void>> = {
  bow: (c) => {
    for (let t = 0; t <= 14; t += 1) {
      const bend = Math.round(4 * Math.sin((t / 14) * Math.PI));
      r(c, '#a8703a', 1 + t + bend, 14 - t + bend - 2 + 0, 2, 1);
    }
    line(c, '#d9d4c6', 1, 12, 15, 0);
    line(c, '#d3c4a2', 3, 13, 13, 3);
    r(c, '#e3e6ee', 13, 2, 2, 2);
  },
  spear: (c) => {
    line(c, '#94602f', 1, 15, 11, 5);
    r(c, '#c49a4e', 10, 4, 3, 3);
    line(c, '#e3e6ee', 12, 4, 15, 0);
    line(c, '#aeb4c2', 11, 3, 14, 0);
    line(c, '#aeb4c2', 13, 5, 15, 2);
  },
  axe: (c) => {
    line(c, '#94602f', 3, 15, 10, 4);
    r(c, '#8d93a3', 7, 1, 7, 7);
    r(c, '#d3d7e2', 12, 0, 3, 9);
    r(c, '#5a6072', 7, 5, 3, 3);
  },
  dagger: (c) => {
    r(c, '#5e3a22', 2, 12, 3, 2);
    r(c, '#c49a4e', 4, 9, 2, 5);
    r(c, '#c49a4e', 3, 10, 4, 2);
    line(c, '#e3e6ee', 6, 9, 14, 1);
    line(c, '#aeb4c2', 7, 10, 15, 2);
  },
  coin: (c) => {
    r(c, '#8a5f22', 4, 2, 8, 12);
    r(c, '#8a5f22', 2, 4, 12, 8);
    r(c, '#e0b24c', 4, 3, 7, 10);
    r(c, '#e0b24c', 3, 4, 9, 8);
    r(c, '#f6dc8a', 4, 4, 3, 2);
    r(c, '#a87a2e', 7, 6, 2, 5);
    r(c, '#a87a2e', 6, 6, 4, 1);
  },
  gear: (c) => {
    r(c, '#b9b3a4', 4, 3, 8, 10);
    r(c, '#b9b3a4', 3, 4, 10, 8);
    for (const [x, y] of [[7, 1], [7, 13], [1, 7], [13, 7], [3, 2], [11, 2], [3, 12], [11, 12]] as const) r(c, '#8c8678', x, y, 2, 2);
    r(c, '#17141c', 6, 6, 4, 4);
  },
  wind: (c) => {
    r(c, '#b9d3e6', 1, 5, 10, 1);
    r(c, '#b9d3e6', 11, 3, 1, 2);
    r(c, '#b9d3e6', 9, 2, 2, 1);
    r(c, '#8fb0c8', 2, 8, 12, 1);
    r(c, '#8fb0c8', 14, 9, 1, 2);
    r(c, '#b9d3e6', 1, 11, 7, 1);
    r(c, '#b9d3e6', 8, 12, 1, 2);
  },
  heart: (c) => {
    r(c, '#c0392b', 2, 3, 5, 6);
    r(c, '#c0392b', 9, 3, 5, 6);
    r(c, '#c0392b', 4, 8, 8, 3);
    r(c, '#c0392b', 6, 11, 4, 2);
    r(c, '#ef8a7d', 3, 4, 2, 2);
  },
  cloak: (c) => {
    r(c, '#6f93bd', 4, 2, 8, 13);
    r(c, '#a9c8e6', 4, 2, 3, 12);
    r(c, '#dbeaf6', 6, 1, 4, 3);
    r(c, '#4b6b94', 10, 4, 2, 11);
    r(c, '#c49a4e', 7, 3, 2, 2);
  },
  helm: (c) => {
    r(c, '#8d93a3', 3, 3, 10, 10);
    r(c, '#c6cad6', 4, 3, 3, 6);
    r(c, '#17141c', 5, 8, 7, 2);
    r(c, '#565b6c', 11, 4, 2, 9);
    r(c, '#8a3a33', 7, 0, 3, 3);
  },
  embers: (c) => {
    r(c, '#e0672a', 5, 5, 6, 9);
    r(c, '#e0672a', 7, 2, 3, 3);
    r(c, '#f2b63c', 6, 8, 4, 6);
    r(c, '#fbe58a', 7, 11, 2, 3);
    r(c, '#e0672a', 12, 3, 1, 1);
    r(c, '#f2b63c', 2, 6, 1, 1);
  },
  frame: (c) => {
    r(c, '#9b7445', 2, 2, 12, 12);
    r(c, '#17141c', 4, 4, 8, 8);
    r(c, '#e0b24c', 1, 1, 3, 3);
    r(c, '#e0b24c', 12, 1, 3, 3);
    r(c, '#e0b24c', 1, 12, 3, 3);
    r(c, '#e0b24c', 12, 12, 3, 3);
  },
  emblem: (c) => {
    r(c, '#6b2a2a', 3, 1, 10, 10);
    r(c, '#6b2a2a', 5, 11, 6, 2);
    r(c, '#6b2a2a', 7, 13, 2, 2);
    r(c, '#a33e36', 3, 1, 4, 9);
    r(c, '#e0b24c', 7, 3, 2, 7);
    r(c, '#e0b24c', 5, 5, 6, 2);
  },
  skin: (c) => {
    r(c, '#7d3a34', 4, 1, 8, 8);
    r(c, '#a8775a', 6, 4, 5, 4);
    r(c, '#35353f', 3, 9, 10, 6);
    r(c, '#d9a441', 7, 10, 2, 2);
  },
  potion: (c) => {
    r(c, '#8a5a2e', 6, 0, 4, 2);
    r(c, '#b9c0cc', 6, 2, 4, 3);
    r(c, '#8d3fb5', 3, 6, 10, 9);
    r(c, '#b9c0cc', 3, 5, 10, 2);
    r(c, '#c88be0', 4, 8, 2, 4);
  },
  trophy: (c) => {
    r(c, '#e0b24c', 4, 1, 8, 7);
    r(c, '#a87a2e', 1, 2, 3, 1);
    r(c, '#a87a2e', 12, 2, 3, 1);
    r(c, '#a87a2e', 7, 8, 2, 4);
    r(c, '#e0b24c', 4, 12, 8, 3);
    r(c, '#f6dc8a', 5, 2, 2, 4);
  },
  skull: (c) => {
    r(c, '#d9d4c6', 3, 2, 10, 9);
    r(c, '#d9d4c6', 5, 11, 6, 3);
    r(c, '#17141c', 5, 6, 2, 3);
    r(c, '#17141c', 9, 6, 2, 3);
    r(c, '#17141c', 7, 12, 1, 2);
  },
  swords: (c) => {
    line(c, '#d3d7e2', 2, 2, 12, 12);
    line(c, '#d3d7e2', 13, 2, 3, 12);
    r(c, '#c49a4e', 2, 11, 3, 3);
    r(c, '#c49a4e', 11, 11, 3, 3);
  },
  lock: (c) => {
    r(c, '#8c8678', 5, 2, 6, 6);
    r(c, '#17141c', 7, 4, 2, 4);
    r(c, '#a87a2e', 3, 7, 10, 7);
    r(c, '#17141c', 7, 9, 2, 3);
  },
  check: (c) => {
    line(c, '#7ec850', 2, 8, 6, 12);
    line(c, '#7ec850', 6, 12, 14, 3);
    line(c, '#5a9a38', 2, 9, 6, 13);
    line(c, '#5a9a38', 6, 13, 14, 4);
  },
};

const iconCache = new Map<string, string>();

export function iconUrl(name: IconName): string {
  const cached = iconCache.get(name);
  if (cached !== undefined) return cached;
  const [element, ctx] = canvas(16, 16);
  ICONS[name](ctx);
  outline(element, ctx);
  const url = element.toDataURL();
  iconCache.set(name, url);
  return url;
}

export const icon = (name: IconName, size = 24): string => `<img class="px" src="${iconUrl(name)}" width="${String(size)}" height="${String(size)}" alt="" />`;

/** Marco ornamentado para `border-image`: 8 px de borde con esquinas de bronce. */
export function frameUrl(): string {
  const [element, ctx] = canvas(24, 24);
  r(ctx, '#0e0b12', 0, 0, 24, 24);
  r(ctx, '#3a2c1c', 1, 1, 22, 22);
  r(ctx, '#8a6a3c', 2, 2, 20, 20);
  r(ctx, '#2a2019', 3, 3, 18, 18);
  r(ctx, '#120e16', 4, 4, 16, 16);
  for (const [x, y] of [[0, 0], [18, 0], [0, 18], [18, 18]] as const) {
    r(ctx, '#3a2c1c', x, y, 6, 6);
    r(ctx, '#c49a4e', x + 1, y + 1, 4, 4);
    r(ctx, '#f0d48a', x + 2, y + 2, 2, 2);
  }
  return element.toDataURL();
}

/** Vista previa de tienda: el personaje empuñando el arma, para que un aspecto de arma se vea de verdad. */
export function previewUrl(look: Look, weapon: WeaponId = DEFAULT_WEAPON[look.character]): string {
  const [element, ctx] = canvas(FRAME_W + 24, FRAME_H);
  ctx.drawImage(characterSheet(look), 0, 0, FRAME_W, FRAME_H, 2, 0, FRAME_W, FRAME_H);
  ctx.drawImage(weaponTexture(weapon, look), 2 + 25 - WEAPON_GRIP.x, 30 - WEAPON_GRIP.y);
  return element.toDataURL();
}
