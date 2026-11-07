/** Fondos de arena pintados por código con degradados y capas; se generan una vez por bioma. */
import { ARENAS, type ArenaId } from '@ashenfall/domain';

export const WORLD_LEFT = -300;
export const WORLD_WIDTH = 2600;
export const GROUND_HEADROOM = 300;
export const GROUND_DEPTH = 140;

export const BIOME_NAMES: Readonly<Record<ArenaId, string>> = {
  whispering_forest: 'Bosque de los Susurros',
  frostlands: 'Tierras del Invierno',
  ashen_desert: 'Desierto de Ceniza',
};

/** Fondo tomado de las referencias; suelo y obstáculos, en píxeles con su misma paleta. */
export const BIOME_ART: Readonly<Record<ArenaId, { scale: number; sky: string; particle: number; ground: readonly [string, string, string, string]; stone: readonly [string, string, string]; cap: string }>> = {
  whispering_forest: { scale: 4, sky: '#2a2850', particle: 0xd8f08a, ground: ['#6f8f3c', '#3f5a2a', '#2a2a22', '#17151a'], stone: ['#57596b', '#3b3c4c', '#25252f'], cap: '#4f7033' },
  frostlands: { scale: 6, sky: '#47567f', particle: 0xf4f7ff, ground: ['#eef3fb', '#b7c5e0', '#6c7aa6', '#2c3358'], stone: ['#7a86ad', '#515c86', '#333b63'], cap: '#eef3fb' },
  ashen_desert: { scale: 6, sky: '#7a4230', particle: 0xe8a76a, ground: ['#c48a54', '#8f5c36', '#5a3826', '#2b1a18'], stone: ['#8d6a50', '#61452f', '#3b2820'], cap: '#c48a54' },
};

const PX = 2;

export function drawGround(id: ArenaId): HTMLCanvasElement {
  const art = BIOME_ART[id];
  let seed = id.length * 7919;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const line = GROUND_HEADROOM / PX;
  const width = WORLD_WIDTH / PX;
  const height = line + GROUND_DEPTH / PX;
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const ctx = element.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D no disponible');
  const box = (color: string, x: number, y: number, w = 1, h = 1): void => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const [top, soil, deep, base] = art.ground;
  box(soil, 0, line, width, 8);
  box(deep, 0, line + 8, width, 26);
  box(base, 0, line + 34, width, height - line - 34);
  for (let x = 0; x < width; x += 1) {
    box(top, x, line - 1, 1, 3 + ((x * 11) % 3));
    if (x % 2 === 0) box(soil, x, line + 7, 1, 2);
    if (x % 2 === 1) box(deep, x, line + 33, 1, 2);
    if (random() < 0.12) box(soil, x, line + 10 + random() * 20, 2, 1);
    if (random() < 0.14) box(top, x, line - 2 - random() * 3, 1, 3);
  }
  // Los obstáculos coinciden exactamente con los rectángulos de colisión del dominio.
  for (const rect of ARENAS[id].obstacles) {
    const x = (rect.x - WORLD_LEFT) / PX;
    const w = rect.width / PX;
    const h = rect.height / PX;
    const y = line - (rect.y + rect.height) / PX;
    box(art.stone[1], x, y, w, h);
    for (let row = 0; row * 6 < h; row += 1) {
      box(art.stone[2], x, y + row * 6, w, 1);
      for (let c = row % 2 === 0 ? 0 : 5; c < w; c += 10) {
        box(art.stone[2], x + c, y + row * 6, 1, 6);
        if (random() < 0.4 && c + 7 < w) box(art.stone[0], x + c + 2, y + row * 6 + 1, 6, 1);
      }
    }
    box(art.stone[0], x, y, 2, h);
    box(art.stone[2], x + w - 3, y, 3, h);
    box(art.cap, x - 1, y - 1, w + 2, 3);
    box('#0d0a0e', x - 1, y - 2, w + 2, 1);
    box('#0d0a0e', x - 2, y - 1, 1, h + 1);
    box('#0d0a0e', x + w + 1, y - 1, 1, h + 1);
  }
  return element;
}
