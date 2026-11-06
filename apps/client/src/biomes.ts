/** Fondos de arena dibujados por código a media resolución: un píxel de arte son dos unidades de mundo. */
import { ARENAS, type ArenaId } from '@ashenfall/domain';

export const ART_SCALE = 2;
/** Márgenes del mundo visibles más allá de la arena. */
export const WORLD_LEFT = -300;
export const WORLD_WIDTH = 2600;
export const GROUND_HEADROOM = 300;
export const GROUND_DEPTH = 140;

interface Theme {
  sky: readonly string[];
  moon: string | null;
  cloud: string;
  far: readonly [string, string, string];
  snow: string;
  mid: readonly [string, string];
  lit: string;
  ground: readonly [string, string, string, string];
  stone: readonly [string, string, string];
  cap: string;
}

export const BIOME_NAMES: Readonly<Record<ArenaId, string>> = {
  whispering_forest: 'Bosque de los Susurros',
  frostlands: 'Tierras del Invierno',
  ashen_desert: 'Desierto de Ceniza',
};

const THEMES: Readonly<Record<ArenaId, Theme>> = {
  whispering_forest: {
    sky: ['#14162c', '#1d2040', '#2a2c55', '#3a3a68', '#4b4878', '#5c5a84'],
    moon: '#e9e3c8',
    cloud: '#2b2a4d',
    far: ['#3a3f68', '#2c3056', '#4d5480'],
    snow: '#8088ad',
    mid: ['#141b28', '#1d2a33'],
    lit: '#e8a94c',
    ground: ['#6f8f3c', '#3f5a2a', '#2a2a22', '#17151a'],
    stone: ['#57596b', '#3b3c4c', '#25252f'],
    cap: '#4f7033',
  },
  frostlands: {
    sky: ['#303c68', '#42508a', '#5a6aa3', '#7787b8', '#94a4cc', '#b3c0dc'],
    moon: null,
    cloud: '#55649a',
    far: ['#6b7bab', '#4d5b8c', '#c9d4ea'],
    snow: '#eef3fb',
    mid: ['#27305a', '#39467a'],
    lit: '#f0a860',
    ground: ['#eef3fb', '#b7c5e0', '#6c7aa6', '#2c3358'],
    stone: ['#7a86ad', '#515c86', '#333b63'],
    cap: '#eef3fb',
  },
  ashen_desert: {
    sky: ['#3f2024', '#6a3226', '#96492c', '#bd6a38', '#d98d4c', '#e6ab6c'],
    moon: '#f3d9a4',
    cloud: '#7c3e2a',
    far: ['#94553a', '#70402f', '#c4814f'],
    snow: '#c98f5e',
    mid: ['#2f1b1e', '#4a2a26'],
    lit: '#f6b04a',
    ground: ['#c48a54', '#8f5c36', '#5a3826', '#2b1a18'],
    stone: ['#8d6a50', '#61452f', '#3b2820'],
    cap: '#c48a54',
  },
};

function randomFrom(text: string): () => number {
  let state = 0;
  for (const char of text) state = (Math.imul(state, 31) + char.charCodeAt(0)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layer(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const ctx = element.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D no disponible');
  return [element, ctx];
}

type Ctx = CanvasRenderingContext2D;
const box = (ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

function drawSky(id: ArenaId, theme: Theme): HTMLCanvasElement {
  const random = randomFrom(`${id}-sky`);
  const [element, ctx] = layer(320, 180);
  const bands = theme.sky.length;
  const bandH = 150 / bands;
  theme.sky.forEach((color, index) => {
    box(ctx, color, 0, index * bandH, 320, bandH + 30);
    const next = theme.sky[index + 1];
    if (next === undefined) return;
    // Trama entre bandas, como en las referencias.
    for (let x = 0; x < 320; x += 1) {
      for (let row = 0; row < 3; row += 1) {
        if ((x + row) % 2 === 0) box(ctx, next, x, (index + 1) * bandH - 3 + row * (row === 2 ? 1 : 1), 1, 1);
      }
    }
  });
  if (theme.moon !== null) {
    const [mx, my, radius] = [236, 34, 13];
    for (let y = -radius; y <= radius; y += 1) {
      const half = Math.round(Math.sqrt(radius * radius - y * y));
      box(ctx, theme.moon, mx - half, my + y, half * 2, 1);
    }
    // Mares lunares en un tono del propio disco, nunca del cielo: si no, la luna parece rota.
    ctx.globalAlpha = 0.22;
    box(ctx, '#6d6650', mx - 7, my - 6, 6, 4);
    box(ctx, '#6d6650', mx + 2, my + 2, 7, 4);
    box(ctx, '#6d6650', mx - 4, my + 5, 4, 3);
    box(ctx, '#6d6650', mx + 4, my - 8, 3, 3);
    ctx.globalAlpha = 1;
  }
  if (id !== 'ashen_desert' && id !== 'frostlands') {
    for (let i = 0; i < 60; i += 1) box(ctx, '#c9c6dc', random() * 320, random() * 80);
  }
  for (let i = 0; i < 16; i += 1) {
    const cx = random() * 340 - 10;
    const cy = 6 + random() * 76;
    const width = 26 + random() * 60;
    box(ctx, theme.cloud, cx, cy, width, 3);
    box(ctx, theme.cloud, cx + width * 0.2, cy - 2, width * 0.5, 2);
    box(ctx, theme.cloud, cx - 6, cy + 3, width * 0.7, 2);
  }
  return element;
}

function drawMountains(id: ArenaId, theme: Theme): HTMLCanvasElement {
  const random = randomFrom(`${id}-far`);
  const [width, height] = [820, 210];
  const [element, ctx] = layer(width, height);
  const phase = random();
  // Ondas triangulares: picos angulosos como los de las referencias, no lomas redondas.
  const tri = (x: number, period: number, offset: number): number => Math.abs((((x / period + offset) % 1) + 1) % 1 - 0.5) * 2;
  const ridge = (x: number): number =>
    height - 40 - (tri(x, 210, phase) * 104 + tri(x, 83, phase * 3) * 42 + tri(x, 29, phase * 7) * 12);
  const snowLine = height - 112;
  let last = ridge(0);
  for (let x = 0; x < width; x += 1) {
    const top = Math.round(ridge(x));
    const shaded = top > last;
    box(ctx, shaded ? theme.far[1] : theme.far[0], x, top, 1, height - top);
    // Cumbres nevadas con un borde dentado estable.
    if (top < snowLine) {
      const cap = snowLine - top + Math.round(Math.sin(x / 3) * 3 + Math.sin(x / 7) * 2);
      box(ctx, shaded ? theme.far[2] : theme.snow, x, top, 1, Math.max(1, cap));
    }
    last = top;
  }
  // Niebla baja.
  for (let y = height - 34; y < height; y += 1) {
    for (let x = (y % 2) * 1; x < width; x += 2) box(ctx, theme.sky[theme.sky.length - 2] ?? '#555', x, y);
  }
  return element;
}

function pine(ctx: Ctx, color: string, light: string, x: number, base: number, size: number, snow: string | null): void {
  box(ctx, color, x - 1, base - 6, 3, 6);
  const tiers = Math.max(3, Math.floor(size / 7));
  for (let tier = 0; tier < tiers; tier += 1) {
    const tierTop = base - 4 - ((tier + 1) * size) / tiers;
    const tierH = (size / tiers) * 1.5;
    const halfBase = (size * 0.34 * (tiers - tier)) / tiers + 2;
    for (let row = 0; row < tierH; row += 1) {
      const half = Math.round((halfBase * (row + 1)) / tierH);
      box(ctx, color, x - half, tierTop + row, half * 2 + 1, 1);
      box(ctx, light, x - half, tierTop + row, 1, 1);
      if (snow !== null && row < tierH * 0.45) box(ctx, snow, x - half, tierTop + row, half + 1, 1);
    }
  }
}

function castle(ctx: Ctx, theme: Theme, random: () => number, x: number, base: number, scale: number): void {
  const [dark, light] = theme.mid;
  const tower = (tx: number, w: number, h: number, roof: boolean): void => {
    box(ctx, dark, tx, base - h, w, h);
    box(ctx, light, tx, base - h, 1, h);
    if (roof) {
      for (let row = 0; row < w * 1.3; row += 1) {
        const half = Math.round((w / 2 + 1) * (row / (w * 1.3)));
        box(ctx, dark, tx + w / 2 - half, base - h - w * 1.3 + row, half * 2, 1);
      }
    } else {
      for (let c = 0; c < w; c += 3) box(ctx, dark, tx + c, base - h - 2, 2, 2);
    }
    for (let y = base - h + 5; y < base - 8; y += 9) {
      if (random() < 0.55) box(ctx, theme.lit, tx + w / 2 - 1, y, 2, 3);
    }
  };
  box(ctx, dark, x, base - 36 * scale, 92 * scale, 36 * scale);
  tower(x - 8 * scale, 16 * scale, 62 * scale, true);
  tower(x + 18 * scale, 14 * scale, 86 * scale, false);
  tower(x + 42 * scale, 20 * scale, 112 * scale, true);
  tower(x + 74 * scale, 14 * scale, 74 * scale, true);
  box(ctx, theme.lit, x + 36 * scale, base - 12 * scale, 8 * scale, 12 * scale);
}

function drawMid(id: ArenaId, theme: Theme): HTMLCanvasElement {
  const random = randomFrom(`${id}-mid`);
  const [width, height] = [1000, 230];
  const [element, ctx] = layer(width, height);
  const base = height - 8;
  const [dark, light] = theme.mid;
  if (id !== 'whispering_forest') castle(ctx, theme, random, id === 'frostlands' ? 620 : 300, base - 6, 1);
  else castle(ctx, theme, random, 700, base - 16, 0.8);
  if (id === 'ashen_desert') {
    castle(ctx, theme, random, 760, base - 4, 0.65);
    // Arcos rotos y árboles muertos.
    for (let i = 0; i < 26; i += 1) {
      const x = random() * width;
      const tall = 18 + random() * 36;
      box(ctx, dark, x, base - tall, 2, tall);
      box(ctx, dark, x - 5, base - tall * 0.7, 6, 1);
      box(ctx, dark, x + 1, base - tall * 0.5, 7, 1);
      box(ctx, dark, x - 3, base - tall, 1, 5);
    }
    for (let x = 0; x < width; x += 5) box(ctx, dark, x, base - 6 - ((x * 13) % 7), 5, 16);
  } else {
    const count = id === 'frostlands' ? 70 : 150;
    const snow = id === 'frostlands' ? theme.snow : null;
    for (let i = 0; i < count; i += 1) {
      pine(ctx, i % 3 === 0 ? light : dark, light, random() * width, base + 4 - random() * 6, 34 + random() * (id === 'frostlands' ? 34 : 70), snow);
    }
    if (id === 'whispering_forest') {
      // Árboles viejos con copa, como en la referencia del bosque.
      for (let i = 0; i < 7; i += 1) {
        const x = 60 + i * 140 + random() * 70;
        const crown = 44 + random() * 26;
        for (let y = crown; y < base; y += 1) {
          const w = 7 + Math.round(((y - crown) / (base - crown)) * 6);
          box(ctx, dark, x - w / 2, y, w, 1);
          box(ctx, light, x - w / 2, y, 2, 1);
        }
        for (let b = 0; b < 3; b += 1) {
          const side = b % 2 === 0 ? 1 : -1;
          for (let t = 0; t < 26; t += 1) box(ctx, dark, x + side * t, crown + 26 + b * 16 - t * 0.7, 3, 3);
        }
        for (let blob = 0; blob < 12; blob += 1) {
          box(ctx, blob % 3 === 0 ? light : dark, x - 38 + random() * 64, crown - 22 + random() * 26, 14 + random() * 22, 8 + random() * 10);
        }
      }
    }
    box(ctx, dark, 0, base - 2, width, 12);
  }
  return element;
}

function drawObstacle(ctx: Ctx, theme: Theme, random: () => number, x: number, y: number, w: number, h: number): void {
  box(ctx, theme.stone[1], x, y, w, h);
  const rowH = 6;
  for (let row = 0; row * rowH < h; row += 1) {
    const offset = row % 2 === 0 ? 0 : 5;
    box(ctx, theme.stone[2], x, y + row * rowH, w, 1);
    for (let c = offset; c < w; c += 10) box(ctx, theme.stone[2], x + c, y + row * rowH, 1, rowH);
    for (let c = offset + 2; c < w - 2; c += 10) {
      if (random() < 0.35) box(ctx, theme.stone[0], x + c, y + row * rowH + 1, 6, 1);
    }
  }
  box(ctx, theme.stone[0], x, y, 2, h);
  box(ctx, theme.stone[2], x + w - 3, y, 3, h);
  box(ctx, theme.cap, x - 1, y - 1, w + 2, 3);
  for (let c = 0; c < w; c += 3) if (random() < 0.5) box(ctx, theme.cap, x + c, y + 2, 2, 1 + random() * 3);
  box(ctx, '#0d0a0e', x - 1, y - 2, w + 2, 1);
  box(ctx, '#0d0a0e', x - 2, y - 1, 1, h + 1);
  box(ctx, '#0d0a0e', x + w + 1, y - 1, 1, h + 1);
}

function drawGround(id: ArenaId, theme: Theme): HTMLCanvasElement {
  const random = randomFrom(`${id}-ground`);
  const width = WORLD_WIDTH / ART_SCALE;
  const line = GROUND_HEADROOM / ART_SCALE;
  const height = line + GROUND_DEPTH / ART_SCALE;
  const [element, ctx] = layer(width, height);
  const [top, soil, deep, base] = theme.ground;
  box(ctx, soil, 0, line, width, 8);
  box(ctx, deep, 0, line + 8, width, 26);
  box(ctx, base, 0, line + 34, width, height - line - 34);
  for (let x = 0; x < width; x += 1) {
    box(ctx, top, x, line - 1, 1, 3 + ((x * 11) % 3));
    if (x % 2 === 0) box(ctx, soil, x, line + 7, 1, 2);
    if (x % 2 === 1) box(ctx, deep, x, line + 33, 1, 2);
    const speck = random();
    if (speck < 0.1) box(ctx, id === 'frostlands' ? '#ffffff' : soil, x, line + 10 + random() * 20, 2, 1);
    if (id === 'whispering_forest' && speck > 0.8) box(ctx, speck > 0.95 ? '#a8c95a' : top, x, line - 2 - random() * 3, 1, 3);
    if (id === 'ashen_desert' && speck > 0.97) box(ctx, deep, x, line + 1, 3, 2);
    if (id === 'frostlands' && speck > 0.9) box(ctx, '#ffffff', x, line - 2, 2, 1);
  }
  // Los obstáculos coinciden exactamente con los rectángulos de colisión del dominio.
  for (const rect of ARENAS[id].obstacles) {
    const w = rect.width / ART_SCALE;
    const h = rect.height / ART_SCALE;
    drawObstacle(ctx, theme, random, (rect.x - WORLD_LEFT) / ART_SCALE, line - (rect.y + rect.height) / ART_SCALE, w, h);
  }
  return element;
}

export interface BiomeLayers {
  sky: HTMLCanvasElement;
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  ground: HTMLCanvasElement;
  fallbackSky: string;
  particle: string;
}

export function buildBiome(id: ArenaId): BiomeLayers {
  const theme = THEMES[id];
  return {
    sky: drawSky(id, theme),
    far: drawMountains(id, theme),
    mid: drawMid(id, theme),
    ground: drawGround(id, theme),
    fallbackSky: theme.sky[0] ?? '#111',
    particle: id === 'frostlands' ? '#f4f7ff' : id === 'ashen_desert' ? '#e8a76a' : '#a7b4d0',
  };
}
