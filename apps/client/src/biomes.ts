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
  const speck = (color: string, x: number, y: number): void => { box(color, x, y, 1, 1); };
  // Decorado sin colisión: bajo y detrás de los personajes.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * width;
    const kind = random();
    if (id === 'whispering_forest') {
      if (kind < 0.35) { box('#3a2a20', x, line - 4, 2, 4); box('#a33e36', x - 2, line - 6, 6, 2); speck('#e8d8b0', x, line - 6); } // seta
      else if (kind < 0.75) { for (let f = -3; f <= 3; f += 1) box(top, x + f * 2, line - 6 + Math.abs(f), 1, 6 - Math.abs(f)); } // helecho
      else { box(art.stone[1], x, line - 5, 8, 5); box(art.stone[0], x + 1, line - 5, 3, 1); } // piedra
    } else if (id === 'frostlands') {
      if (kind < 0.5) { box('#9fd0ee', x, line - 8, 2, 8); box('#e2f4ff', x + 2, line - 5, 2, 5); box('#6fa8cf', x - 2, line - 4, 2, 4); } // esquirla de hielo
      else { box('#b7c5e0', x, line - 4, 10, 4); box('#ffffff', x + 2, line - 5, 6, 1); } // montículo
    } else if (kind < 0.35) { box('#e0d4bc', x, line - 2, 8, 1); box('#e0d4bc', x + 1, line - 4, 1, 3); box('#e0d4bc', x + 5, line - 4, 1, 3); } // huesos
    else if (kind < 0.7) { for (let f = -2; f <= 2; f += 1) box('#5a3826', x + f * 2, line - 7 + Math.abs(f), 1, 7 - Math.abs(f)); } // matorral seco
    else { box(art.stone[1], x, line - 3, 6, 3); speck(art.stone[0], x + 1, line - 3); }
  }
  // Los obstáculos ocupan exactamente sus rectángulos de colisión; cambia su forma, no su tamaño lógico.
  ARENAS[id].obstacles.forEach((rect) => {
    const x = (rect.x - WORLD_LEFT) / PX;
    const w = rect.width / PX;
    const h = rect.height / PX;
    const y = line - (rect.y + rect.height) / PX;
    const [light, mid, dark] = art.stone;
    const small = rect.height <= 62;
    if (small) {
      // Roca o tocón: contorno irregular por columnas.
      const stump = id === 'whispering_forest';
      for (let c = 0; c < w; c += 1) {
        const t = c / (w - 1) * 2 - 1;
        const rise = Math.round((1 - t * t) * h * (stump ? 0.15 : 0.45) + h * (stump ? 0.85 : 0.55));
        box(stump ? '#4a3324' : mid, x + c, line - rise, 1, rise);
        box(stump ? '#7a5a3c' : light, x + c, line - rise, 1, 2);
        if (t > 0.4) box(stump ? '#2c1d14' : dark, x + c, line - rise + 2, 1, rise - 2);
      }
      if (stump) for (let r = 0; r < h; r += 5) box('#2c1d14', x + 2, y + r + 3, w - 4, 1);
      if (id === 'frostlands') box('#eef3fb', x + 1, line - h, w - 2, 3);
      return;
    }
    if (id === 'whispering_forest' && rect.width >= 80) {
      // Árbol muerto gigante.
      box('#3a281c', x, y, w, h);
      for (let c = 0; c < w; c += 3) box(c % 6 === 0 ? '#22160f' : '#54392a', x + c, y, 1, h);
      box('#22160f', x + w / 2 - 4, y + h * 0.45, 8, 12);
      box('#54392a', x - 8, y + 8, 10, 5);
      box('#54392a', x + w - 2, y + 18, 10, 5);
      box(art.cap, x - 2, y - 2, w + 4, 4);
      return;
    }
    if (id === 'ashen_desert' && rect.height <= 130 && rect.width <= 70) {
      // Columna rota con fuste estriado.
      box(mid, x, y, w, h);
      for (let c = 2; c < w; c += 5) box(dark, x + c, y, 1, h);
      box(light, x - 2, line - 6, w + 4, 6);
      box(light, x - 1, y, w + 2, 4);
      for (let c = 0; c < w; c += 4) box(dark, x + c, y, 2, 1 + (c % 3));
      return;
    }
    if (id === 'frostlands' && rect.height === 150) {
      // Bloque de hielo facetado.
      box('#7fb4d8', x, y, w, h);
      for (let c = 0; c < w; c += 1) box('#c8e8fa', x + c, y + (c * 13) % 9, 1, 2 + (c * 7) % 22);
      box('#4d84ad', x + w - 5, y, 5, h);
      box('#eef3fb', x - 1, y - 1, w + 2, 3);
      return;
    }
    box(mid, x, y, w, h);
    for (let row = 0; row * 6 < h; row += 1) {
      box(dark, x, y + row * 6, w, 1);
      for (let c = row % 2 === 0 ? 0 : 5; c < w; c += 10) {
        box(dark, x + c, y + row * 6, 1, 6);
        if (random() < 0.4 && c + 7 < w) box(light, x + c + 2, y + row * 6 + 1, 6, 1);
      }
    }
    box(light, x, y, 2, h);
    box(dark, x + w - 3, y, 3, h);
    box(art.cap, x - 1, y - 1, w + 2, 3);
  });
  return element;
}
