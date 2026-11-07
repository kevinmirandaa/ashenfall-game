/** Fondos de arena recortados de las referencias y suelo en píxeles con la paleta de cada bioma; los obstáculos son sprites de la hoja. */
import type { ArenaId } from '@ashenfall/domain';

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

/** Cómo se arma un bloque de terreno de cualquier tamaño con el sprite de la hoja, sin deformar los píxeles. */
interface TerrainSlices {
  /** Anchos de los bordes izquierdo y derecho que se conservan. */
  capL: number;
  capR: number;
  /** Alto de la franja superior (borde con hierba, arena o nieve). */
  top: number;
  /** Filas del cuerpo de roca que se repiten hacia abajo, y columnas del centro que se repiten a lo ancho. */
  body: readonly [number, number];
  mid: readonly [number, number];
  /** Relleno oscuro bajo las rebanadas, para que el cuerpo sea macizo. */
  fill: string;
}

export const TERRAIN_SLICES: Readonly<Record<'grass' | 'desert' | 'snow' | 'dark', TerrainSlices>> = {
  grass: { capL: 36, capR: 36, top: 34, body: [44, 88], mid: [70, 155], fill: '#2a2030' },
  desert: { capL: 14, capR: 14, top: 24, body: [30, 76], mid: [30, 100], fill: '#5a3626' },
  snow: { capL: 14, capR: 14, top: 48, body: [52, 80], mid: [30, 110], fill: '#2a2438' },
  dark: { capL: 14, capR: 14, top: 24, body: [26, 48], mid: [24, 92], fill: '#241c2c' },
};

/** Unidades de mundo por píxel del sprite de terreno. */
export const TERRAIN_SCALE = 1.2;

/** Un bloque de `cols × rows` píxeles de sprite: franja superior arriba y cuerpo de roca repetido hacia abajo. */
export function drawTerrainBlock(source: CanvasImageSource, name: keyof typeof TERRAIN_SLICES, cols: number, rows: number): HTMLCanvasElement {
  const slices = TERRAIN_SLICES[name];
  const element = document.createElement('canvas');
  element.width = cols;
  element.height = rows;
  const ctx = element.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D no disponible');
  ctx.imageSmoothingEnabled = false;
  const sourceWidth = Number((source as { width: number }).width);
  const capL = Math.min(slices.capL, Math.floor(cols / 2));
  const capR = Math.min(slices.capR, Math.floor(cols / 2));
  ctx.fillStyle = slices.fill;
  ctx.fillRect(0, Math.min(rows, slices.top - 6), cols, rows);
  /** Una banda horizontal del sprite [from, to) repetida a lo ancho entre los bordes. */
  const band = (fromRow: number, toRow: number, y: number, height: number): void => {
    const rowsToDraw = Math.min(toRow - fromRow, height);
    if (rowsToDraw <= 0) return;
    ctx.drawImage(source, 0, fromRow, capL, rowsToDraw, 0, y, capL, rowsToDraw);
    ctx.drawImage(source, sourceWidth - capR, fromRow, capR, rowsToDraw, cols - capR, y, capR, rowsToDraw);
    const [midFrom, midTo] = slices.mid;
    for (let x = capL; x < cols - capR; x += midTo - midFrom) {
      const w = Math.min(midTo - midFrom, cols - capR - x);
      ctx.drawImage(source, midFrom, fromRow, w, rowsToDraw, x, y, w, rowsToDraw);
    }
  };
  band(0, slices.top, 0, rows);
  const [bodyFrom, bodyTo] = slices.body;
  for (let y = slices.top; y < rows; y += bodyTo - bodyFrom) band(bodyFrom, bodyTo, y, rows - y);
  return element;
}

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
  return element;
}
