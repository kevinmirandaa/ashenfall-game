import type { Rect, Vec2 } from './types.js';

export const ARENA_IDS = ['hamlet_ruins', 'graveyard', 'ember_desert', 'misty_pines', 'frozen_bridge', 'blood_keep', 'fog_ruins'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

/** Forma visual del obstáculo; la colisión es siempre su rectángulo. */
export type ObstacleKind = 'boulder' | 'stump' | 'deadtree' | 'column' | 'ice' | 'tombstone' | 'cactus' | 'ruinwall' | 'crate';

export interface Obstacle extends Rect {
  readonly kind: ObstacleKind;
}

/** Dos puntos de aparición simétricos respecto al centro de la arena, para que ningún lado tenga ventaja. */
export interface SpawnPair {
  readonly left: Vec2;
  readonly right: Vec2;
}

export interface ArenaDefinition {
  readonly id: ArenaId;
  readonly width: number;
  readonly obstacles: readonly Obstacle[];
  readonly spawnPairs: readonly SpawnPair[];
  /** Viento máximo en unidades por segundo². Todas las arenas lo dejan en 0: la versión estable no tiene viento. */
  readonly maxWind: number;
}

const ARENA_WIDTH = 2000;

function mirroredPair(x: number, y = 0): SpawnPair {
  return { left: { x, y }, right: { x: ARENA_WIDTH - x, y } };
}

/** Obstáculos simétricos: uno a cada lado del centro de la arena. */
function mirrored(kind: ObstacleKind, x: number, width: number, height: number): readonly Obstacle[] {
  return [
    { kind, x, y: 0, width, height },
    { kind, x: ARENA_WIDTH - x - width, y: 0, width, height },
  ];
}

const central = (kind: ObstacleKind, width: number, height: number): Obstacle => ({ kind, x: (ARENA_WIDTH - width) / 2, y: 0, width, height });

/**
 * Los obstáculos viven solo entre x = 560 y x = 1440: detrás de cada jugador no hay nada que frene el retroceso
 * de un impacto, así que ningún lado se queda atascado contra un muro.
 */
export const ARENAS: Readonly<Record<ArenaId, ArenaDefinition>> = {
  hamlet_ruins: {
    id: 'hamlet_ruins',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('ruinwall', 90, 170), ...mirrored('crate', 700, 64, 56), ...mirrored('boulder', 860, 70, 74)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
  graveyard: {
    id: 'graveyard',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('tombstone', 84, 190), ...mirrored('tombstone', 700, 60, 100), ...mirrored('tombstone', 880, 52, 62)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
  ember_desert: {
    id: 'ember_desert',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('column', 120, 190), ...mirrored('cactus', 700, 56, 130), ...mirrored('boulder', 880, 66, 68)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
  misty_pines: {
    id: 'misty_pines',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('deadtree', 90, 200), ...mirrored('boulder', 680, 90, 84), ...mirrored('stump', 860, 58, 50)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
  frozen_bridge: {
    id: 'frozen_bridge',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('ice', 100, 180), ...mirrored('boulder', 690, 76, 72), ...mirrored('ice', 860, 56, 60)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
  blood_keep: {
    id: 'blood_keep',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('ruinwall', 110, 200), ...mirrored('column', 690, 64, 130), ...mirrored('boulder', 870, 64, 62)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
  fog_ruins: {
    id: 'fog_ruins',
    width: ARENA_WIDTH,
    maxWind: 0,
    obstacles: [central('column', 90, 180), ...mirrored('ruinwall', 680, 110, 96), ...mirrored('crate', 880, 60, 54)],
    spawnPairs: [mirroredPair(300), mirroredPair(380), mirroredPair(460)],
  },
};
