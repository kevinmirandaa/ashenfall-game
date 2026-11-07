import { ARENA_WIDTH, type ArenaId, type Obstacle } from './arenas.js';
import { PROPS, type PropSpec } from './obstacle-catalog.js';
import type { RandomSource, Vec2 } from './types.js';

/** Dos puntos de aparición simétricos respecto al centro de la arena, para que ningún lado tenga ventaja. */
export interface SpawnPair {
  readonly left: Vec2;
  readonly right: Vec2;
}

export interface ArenaLayout {
  readonly obstacles: readonly Obstacle[];
  readonly spawn: SpawnPair;
  readonly relief: Relief;
}

/** Forma del terreno: llano, plataformas elevadas bajo cada jugador con gradas hacia el centro, o una colina central. */
export type Relief = 'flat' | 'plateau' | 'hill';

const SPAWN_XS = [300, 380, 460] as const;
/** Borde de la plataforma elevada y ancho de cada escalón. Todo queda en x ≥ 560, como los obstáculos de antes. */
const PLATEAU_EDGE = 540;
const STEP_WIDTH = 70;
const STEP_HEIGHT = 30;
const PLATEAU_RISES = [60, 90, 120] as const;
const MIN_PROP_X = 580;
const CENTER = ARENA_WIDTH / 2;

const RELIEFS: readonly Relief[] = ['flat', 'plateau', 'plateau', 'hill', 'hill'];

function pick<T>(items: readonly T[], random: RandomSource): T {
  const item = items[random.intBelow(items.length)];
  if (item === undefined) throw new Error('RandomSource devolvió un índice fuera de rango');
  return item;
}

function pool(arenaId: ArenaId, tiers: readonly PropSpec['tier'][]): readonly PropSpec[] {
  return Object.values(PROPS).filter((spec) => spec.biomes.includes(arenaId) && tiers.includes(spec.tier));
}

const terrain = (x: number, width: number, height: number, y = 0): Obstacle => ({ kind: 'terrain', x, y, width, height });

/** Copia el obstáculo al otro lado de la arena, espejado. */
function mirror(obstacle: Obstacle): Obstacle {
  return { ...obstacle, x: ARENA_WIDTH - obstacle.x - obstacle.width, flip: true };
}

function prop(spec: PropSpec, x: number, y: number): Obstacle {
  return { kind: spec.id, x: Math.round(x), y, width: spec.width, height: spec.height };
}

/**
 * Sortea el terreno y los obstáculos de una partida. Todo es simétrico respecto al centro: a un lado y al otro les
 * toca lo mismo, así que el azar cambia la partida pero nunca da ventaja. Solo salen objetos de ese bioma.
 */
export function generateLayout(arenaId: ArenaId, random: RandomSource): ArenaLayout {
  const relief = pick(RELIEFS, random);
  const left: Obstacle[] = [];
  const rise = relief === 'plateau' ? pick(PLATEAU_RISES, random) : 0;
  let propsFrom = MIN_PROP_X;
  let centerBase = 0;
  let centerBlock = 0;

  if (relief === 'plateau') {
    // Bajo el jugador, una plataforma que llega hasta el borde de la arena; hacia el centro baja en gradas.
    left.push(terrain(0, PLATEAU_EDGE, rise));
    const steps = rise / STEP_HEIGHT - 1;
    for (let i = 0; i < steps; i += 1) left.push(terrain(PLATEAU_EDGE + i * STEP_WIDTH, STEP_WIDTH, rise - STEP_HEIGHT * (i + 1)));
    propsFrom = Math.max(MIN_PROP_X, PLATEAU_EDGE + steps * STEP_WIDTH + 24);
  } else if (relief === 'hill') {
    // Colina en el centro: bloque central y dos escalones por lado.
    const top = pick([90, 120], random);
    centerBase = top;
    centerBlock = 90 + 2 * 2 * STEP_WIDTH;
    left.push(terrain(CENTER - 45 - STEP_WIDTH * 2, STEP_WIDTH, top - STEP_HEIGHT * 2));
    left.push(terrain(CENTER - 45 - STEP_WIDTH, STEP_WIDTH, top - STEP_HEIGHT));
  }

  // Obstáculo del centro (no es simétrico por sí solo: es una sola pieza centrada).
  const center: Obstacle[] = [];
  if (relief === 'hill') center.push(terrain(CENTER - 45, 90, centerBase));
  const centerPool = relief === 'hill' ? pool(arenaId, ['low']) : pool(arenaId, ['tall']);
  const centerSpec = pick(centerPool, random);
  center.push(prop(centerSpec, CENTER - centerSpec.width / 2, centerBase));

  const limit = relief === 'hill' ? CENTER - centerBlock / 2 : CENTER - centerSpec.width / 2;
  // Dos obstáculos por lado, pegados hacia el centro con holguras aleatorias: uno mediano o bajo y otro bajo.
  const nearSpec = pick(pool(arenaId, ['low', 'mid']), random);
  const midSpec = pick(pool(arenaId, ['low']), random);
  const midX = limit - midSpec.width - 14 - random.intBelow(40);
  const nearX = midX - nearSpec.width - 24 - random.intBelow(70);
  if (midX >= propsFrom) left.push(prop(midSpec, midX, 0));
  if (nearX >= propsFrom && midX >= propsFrom) left.push(prop(nearSpec, nearX, 0));

  const spawnX = pick(SPAWN_XS, random);
  const obstacles = [...left, ...left.map(mirror), ...center];
  return {
    obstacles,
    spawn: { left: { x: spawnX, y: rise }, right: { x: ARENA_WIDTH - spawnX, y: rise } },
    relief,
  };
}
