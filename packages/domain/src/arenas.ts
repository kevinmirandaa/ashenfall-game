import type { Rect, Vec2 } from './types.js';

export const ARENA_IDS = ['whispering_forest', 'frostlands', 'ashen_desert'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

/** Dos puntos de aparición simétricos respecto al centro de la arena, para que ningún lado tenga ventaja. */
export interface SpawnPair {
  readonly left: Vec2;
  readonly right: Vec2;
}

export interface ArenaDefinition {
  readonly id: ArenaId;
  readonly width: number;
  readonly obstacles: readonly Rect[];
  readonly spawnPairs: readonly SpawnPair[];
  /** El viento de la partida se sortea en [-maxWind, +maxWind], en unidades por segundo². */
  readonly maxWind: number;
}

const ARENA_WIDTH = 2000;

function mirroredPair(x: number, y = 0): SpawnPair {
  return { left: { x, y }, right: { x: ARENA_WIDTH - x, y } };
}

/** Rectángulos simétricos: uno a cada lado del centro de la arena. */
function mirroredRects(x: number, y: number, width: number, height: number): readonly Rect[] {
  return [
    { x, y, width, height },
    { x: ARENA_WIDTH - x - width, y, width, height },
  ];
}

export const ARENAS: Readonly<Record<ArenaId, ArenaDefinition>> = {
  whispering_forest: {
    id: 'whispering_forest',
    width: ARENA_WIDTH,
    maxWind: 60,
    obstacles: [{ x: 960, y: 0, width: 80, height: 180 }, ...mirroredRects(640, 0, 60, 90)],
    spawnPairs: [mirroredPair(250), mirroredPair(320), mirroredPair(400)],
  },
  frostlands: {
    id: 'frostlands',
    width: ARENA_WIDTH,
    maxWind: 120,
    obstacles: [
      // Repisas de roca sobre las que aparece el jugador en uno de los puntos.
      ...mirroredRects(220, 0, 160, 110),
      ...mirroredRects(760, 0, 90, 150),
    ],
    spawnPairs: [mirroredPair(300, 110), mirroredPair(450), mirroredPair(520)],
  },
  ashen_desert: {
    id: 'ashen_desert',
    width: ARENA_WIDTH,
    maxWind: 100,
    obstacles: [{ x: 930, y: 0, width: 140, height: 120 }, ...mirroredRects(600, 0, 70, 130)],
    spawnPairs: [mirroredPair(260), mirroredPair(360), mirroredPair(470)],
  },
};
