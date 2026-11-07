/** Fondos de arena recortados de las referencias; suelo y obstáculos, en píxeles con la paleta de cada bioma. */
import { ARENAS, type ArenaId, type Obstacle } from '@ashenfall/domain';

export const WORLD_LEFT = -300;
export const WORLD_WIDTH = 2600;
export const GROUND_HEADROOM = 300;
export const GROUND_DEPTH = 140;

export const BIOME_NAMES: Readonly<Record<ArenaId, string>> = {
  hamlet_ruins: 'Aldea en Ruinas',
  graveyard: 'Cementerio de la Luna',
  ember_desert: 'Desierto de Ceniza',
  misty_pines: 'Pinar de la Niebla',
  frozen_bridge: 'Puente Helado',
  blood_keep: 'Fortaleza Carmesí',
  fog_ruins: 'Ruinas Brumosas',
};

interface BiomeArt {
  /** Ampliación entera de la imagen de referencia, para que cada píxel siga siendo un píxel. */
  scale: number;
  /** Color del cielo sobre la imagen y de fondo de la cámara. */
  sky: string;
  /** Color de las partículas ambientales. */
  particle: number;
  ground: readonly [string, string, string, string];
  stone: readonly [string, string, string];
  /** Remate de los obstáculos: hierba, nieve, arena. */
  cap: string;
}

export const BIOME_ART: Readonly<Record<ArenaId, BiomeArt>> = {
  hamlet_ruins: { scale: 2, sky: '#555878', particle: 0xd8d8c0, ground: ['#6d7a3a', '#4a4a2a', '#2e2a22', '#15131a'], stone: ['#8a8478', '#5e5a52', '#38342f'], cap: '#6d7a3a' },
  graveyard: { scale: 2, sky: '#272945', particle: 0xb8c8ff, ground: ['#4a5a3a', '#2c3a2c', '#1e2220', '#101014'], stone: ['#8a8aa2', '#5a5a74', '#34344a'], cap: '#4a5a3a' },
  ember_desert: { scale: 2, sky: '#7c424d', particle: 0xf0a860, ground: ['#d89a50', '#a06a3a', '#603a28', '#2b1a18'], stone: ['#a4795a', '#74503a', '#463024'], cap: '#d89a50' },
  misty_pines: { scale: 2, sky: '#5a5f79', particle: 0xe0e8e0, ground: ['#4a6a3a', '#33492b', '#262a22', '#14161a'], stone: ['#7a8088', '#545a62', '#32363e'], cap: '#4a6a3a' },
  frozen_bridge: { scale: 2, sky: '#616992', particle: 0xffffff, ground: ['#f0f4fb', '#b9c6e2', '#6e7cac', '#2e3560'], stone: ['#8896b8', '#5a6890', '#364066'], cap: '#f0f4fb' },
  blood_keep: { scale: 2, sky: '#31253c', particle: 0xff8070, ground: ['#6a4a52', '#3e2a34', '#2a1c26', '#140e14'], stone: ['#7a5668', '#523a4a', '#2e202c'], cap: '#6a4a52' },
  fog_ruins: { scale: 2, sky: '#72728f', particle: 0xd0d4e0, ground: ['#5a6a4a', '#3c4636', '#282c28', '#14161a'], stone: ['#8a8ea0', '#5c6074', '#363a4c'], cap: '#5a6a4a' },
};

const PX = 2;

type Painter = (box: (color: string, x: number, y: number, w?: number, h?: number) => void, rect: Obstacle, art: BiomeArt, geometry: { x: number; y: number; w: number; h: number; line: number }, random: () => number) => void;

/** Cada forma ocupa exactamente su rectángulo de colisión; cambia el dibujo, no el tamaño lógico. */
const PAINTERS: Readonly<Record<Obstacle['kind'], Painter>> = {
  boulder: (box, _rect, art, { x, w, h, line }) => {
    const [light, mid, dark] = art.stone;
    for (let c = 0; c < w; c += 1) {
      const t = (c / Math.max(1, w - 1)) * 2 - 1;
      const rise = Math.round((1 - t * t) * h * 0.4 + h * 0.6);
      box(mid, x + c, line - rise, 1, rise);
      box(light, x + c, line - rise, 1, 2);
      if (t > 0.35) box(dark, x + c, line - rise + 2, 1, rise - 2);
      if (c % 7 === 3) box(dark, x + c, line - rise + 5, 1, Math.max(1, Math.floor(rise / 3)));
    }
    box(art.cap, x + 2, line - h - 1, Math.max(2, w - 4), 2);
  },
  stump: (box, _rect, _art, { x, w, h, line }) => {
    for (let c = 0; c < w; c += 1) {
      const rise = Math.round(h * 0.82 + (c % 5 === 0 ? 2 : 0) + Math.sin(c / 3) * 1.5);
      box('#4a3324', x + c, line - rise, 1, rise);
      box('#7a5a3c', x + c, line - rise, 1, 2);
      if (c > w * 0.65) box('#2c1d14', x + c, line - rise + 2, 1, rise - 2);
    }
    for (let r = 0; r < h; r += 5) box('#2c1d14', x + 2, line - h + r + 3, w - 4, 1);
    box('#a08060', x + 3, line - h + 1, w - 6, 2);
  },
  deadtree: (box, _rect, art, { x, y, w, h }) => {
    box('#3a281c', x, y, w, h);
    for (let c = 0; c < w; c += 3) box(c % 6 === 0 ? '#22160f' : '#54392a', x + c, y, 1, h);
    box('#22160f', x + w / 2 - 4, y + h * 0.45, 8, 12);
    box('#54392a', x - 8, y + 8, 10, 5);
    box('#54392a', x - 14, y + 4, 6, 3);
    box('#54392a', x + w - 2, y + 18, 10, 5);
    box('#54392a', x + w + 6, y + 14, 6, 3);
    box(art.cap, x - 2, y - 2, w + 4, 4);
  },
  column: (box, _rect, art, { x, y, w, h, line }) => {
    const [light, mid, dark] = art.stone;
    box(mid, x, y, w, h);
    for (let c = 2; c < w; c += 5) box(dark, x + c, y, 1, h);
    box(light, x - 2, line - 6, w + 4, 6);
    box(light, x - 1, y, w + 2, 4);
    for (let c = 0; c < w; c += 4) box(dark, x + c, y, 2, 1 + (c % 3));
    box(dark, x + w - 3, y + 6, 3, h - 12);
  },
  ice: (box, _rect, _art, { x, y, w, h }) => {
    box('#7fb4d8', x, y, w, h);
    for (let c = 0; c < w; c += 1) box('#c8e8fa', x + c, y + ((c * 13) % 9), 1, 2 + ((c * 7) % 22));
    box('#4d84ad', x + w - 5, y, 5, h);
    box('#eef3fb', x - 1, y - 1, w + 2, 3);
    box('#e2f4ff', x + 4, y + 8, 2, h - 18);
  },
  tombstone: (box, _rect, art, { x, y, w, h }) => {
    const [light, mid, dark] = art.stone;
    // Lápida de cabecera redondeada, con una cruz grabada y musgo en la base.
    box(mid, x, y + 6, w, h - 6);
    box(mid, x + 3, y + 2, w - 6, 4);
    box(mid, x + 6, y, w - 12, 2);
    box(light, x + 6, y, w - 12, 1);
    box(light, x, y + 6, 2, h - 6);
    box(dark, x + w - 3, y + 6, 3, h - 6);
    const mx = x + w / 2;
    box(dark, mx - 1, y + 10, 3, Math.min(20, h * 0.4));
    box(dark, mx - 5, y + 14, 11, 3);
    box('#3f5a30', x, y + h - 5, w, 5);
    for (let c = 1; c < w; c += 4) box('#4f7033', x + c, y + h - 7, 2, 3);
    box(light, x - 3, y + h - 2, w + 6, 2);
  },
  cactus: (box, _rect, _art, { x, y, w, h }) => {
    const trunk = Math.max(8, Math.round(w * 0.45));
    const tx = x + (w - trunk) / 2;
    box('#3f6a3a', tx, y, trunk, h);
    box('#5a8a4a', tx, y, 2, h);
    box('#274a28', tx + trunk - 3, y, 3, h);
    // Brazos con codo.
    box('#3f6a3a', x, y + h * 0.35, tx - x + 2, 7);
    box('#3f6a3a', x, y + h * 0.35 - 14, 7, 21);
    box('#3f6a3a', tx + trunk - 2, y + h * 0.5, x + w - tx - trunk + 2, 7);
    box('#3f6a3a', x + w - 7, y + h * 0.5 - 12, 7, 19);
    for (let r = 4; r < h; r += 8) box('#e8e0b8', tx + 2, y + r, 1, 2);
    box('#e8e0b8', tx + trunk - 5, y + 10, 1, 2);
  },
  ruinwall: (box, rect, art, { x, y, w, h }, random) => {
    const [light, mid, dark] = art.stone;
    // Muro de sillares con la corona desigual: parece derrumbado.
    box(mid, x, y, w, h);
    for (let row = 0; row * 7 < h; row += 1) {
      box(dark, x, y + row * 7, w, 1);
      for (let c = row % 2 === 0 ? 0 : 6; c < w; c += 12) {
        box(dark, x + c, y + row * 7, 1, 7);
        if (random() < 0.4 && c + 8 < w) box(light, x + c + 2, y + row * 7 + 1, 7, 1);
      }
    }
    for (let c = 0; c < w; c += 6) box('#000000', x + c, y - 1, 6, 4 + Math.floor(random() * 6));
    box(light, x, y, 2, h);
    box(dark, x + w - 3, y, 3, h);
    box(art.cap, x - 1, y - 1, w + 2, 3);
    if (rect.height > 150) box(dark, x + w / 2 - 4, y + h * 0.3, 8, 12);
  },
  crate: (box, _rect, _art, { x, y, w, h }) => {
    box('#6b4a2c', x, y, w, h);
    box('#8a6238', x, y, w, 3);
    box('#3c2616', x, y + h - 3, w, 3);
    box('#3c2616', x, y, 3, h);
    box('#3c2616', x + w - 3, y, 3, h);
    for (let d = 0; d < Math.min(w, h) - 6; d += 1) box('#4c3320', x + 3 + d, y + 3 + Math.floor((d * (h - 6)) / Math.max(1, w - 6)), 2, 2);
    box('#c9a05a', x + 4, y + 4, 2, 2);
    box('#c9a05a', x + w - 6, y + h - 6, 2, 2);
  },
};

export function drawGround(id: ArenaId): HTMLCanvasElement {
  const art = BIOME_ART[id];
  let seed = id.length * 7919 + id.charCodeAt(0);
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
  // Decorado sin colisión: bajo y detrás de los personajes, propio de cada bioma.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * width;
    const kind = random();
    const [stoneLight, stoneMid] = art.stone;
    switch (id) {
      case 'graveyard':
        if (kind < 0.3) { box('#3a4a30', x, line - 5, 1, 5); box('#3a4a30', x + 2, line - 4, 1, 4); box('#9ab8ff', x + 1, line - 7, 1, 1); } // luciérnaga entre hierbas
        else if (kind < 0.6) { box(stoneMid, x, line - 5, 3, 5); box(stoneLight, x, line - 6, 3, 1); } // lápida lejana
        else { box('#2c3a2c', x, line - 3, 8, 3); }
        break;
      case 'ember_desert':
        if (kind < 0.35) { box('#e0d4bc', x, line - 2, 8, 1); box('#e0d4bc', x + 1, line - 4, 1, 3); box('#e0d4bc', x + 5, line - 4, 1, 3); } // huesos
        else if (kind < 0.7) { for (let f = -2; f <= 2; f += 1) box('#5a3826', x + f * 2, line - 7 + Math.abs(f), 1, 7 - Math.abs(f)); } // matorral seco
        else { box(stoneMid, x, line - 3, 6, 3); box(stoneLight, x + 1, line - 3, 3, 1); }
        break;
      case 'frozen_bridge':
        if (kind < 0.5) { box('#9fd0ee', x, line - 8, 2, 8); box('#e2f4ff', x + 2, line - 5, 2, 5); box('#6fa8cf', x - 2, line - 4, 2, 4); } // esquirla de hielo
        else { box('#b7c5e0', x, line - 4, 10, 4); box('#ffffff', x + 2, line - 5, 6, 1); } // montículo de nieve
        break;
      case 'blood_keep':
        if (kind < 0.4) { box('#2a1c22', x, line - 7, 1, 7); box('#2a1c22', x + 2, line - 5, 1, 5); box('#a33e36', x + 1, line - 8, 1, 1); } // espino con brasa
        else if (kind < 0.7) { box(stoneMid, x, line - 4, 7, 4); box('#a33e36', x + 1, line - 5, 2, 1); }
        else { box('#3e2a34', x, line - 3, 9, 3); }
        break;
      case 'misty_pines':
      case 'hamlet_ruins':
      case 'fog_ruins':
      default:
        if (kind < 0.35) { box('#3a2a20', x, line - 4, 2, 4); box('#a33e36', x - 2, line - 6, 6, 2); box('#e8d8b0', x, line - 6, 1, 1); } // seta
        else if (kind < 0.75) { for (let f = -3; f <= 3; f += 1) box(top, x + f * 2, line - 6 + Math.abs(f), 1, 6 - Math.abs(f)); } // helecho
        else { box(stoneMid, x, line - 5, 8, 5); box(stoneLight, x + 1, line - 5, 3, 1); } // piedra
    }
  }
  ARENAS[id].obstacles.forEach((rect) => {
    const x = (rect.x - WORLD_LEFT) / PX;
    const w = rect.width / PX;
    const h = rect.height / PX;
    const y = line - (rect.y + rect.height) / PX;
    PAINTERS[rect.kind](box, rect, art, { x, y, w, h, line }, random);
  });
  return element;
}
