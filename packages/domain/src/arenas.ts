import type { PropId } from './obstacle-catalog.js';
import type { Rect } from './types.js';

export const ARENA_IDS = ['hamlet_ruins', 'graveyard', 'ember_desert', 'misty_pines', 'frozen_bridge', 'blood_keep', 'fog_ruins'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];

/** Un obstáculo es un objeto de la hoja de arte (`PropId`) o un bloque de `terrain`: plataformas, gradas y desniveles. */
export type ObstacleKind = PropId | 'terrain';

/** La colisión es siempre el rectángulo; el dibujo lo decide el cliente según `kind`. */
export interface Obstacle extends Rect {
  readonly kind: ObstacleKind;
  /** Copia especular del lado derecho: solo cambia el dibujo, nunca la colisión. */
  readonly flip?: boolean;
}

export interface ArenaDefinition {
  readonly id: ArenaId;
  readonly width: number;
  /** Los de esta partida: el servidor los sortea al empezar y quedan en el log de eventos. */
  readonly obstacles: readonly Obstacle[];
  /** Viento máximo en unidades por segundo². Todas las arenas lo dejan en 0: la versión estable no tiene viento. */
  readonly maxWind: number;
}

export const ARENA_WIDTH = 2000;

/** Lo que es fijo de cada arena. Obstáculos y puntos de aparición se generan por partida (ver layout.ts). */
export const ARENAS: Readonly<Record<ArenaId, { readonly id: ArenaId; readonly width: number; readonly maxWind: number }>> = {
  hamlet_ruins: { id: 'hamlet_ruins', width: ARENA_WIDTH, maxWind: 0 },
  graveyard: { id: 'graveyard', width: ARENA_WIDTH, maxWind: 0 },
  ember_desert: { id: 'ember_desert', width: ARENA_WIDTH, maxWind: 0 },
  misty_pines: { id: 'misty_pines', width: ARENA_WIDTH, maxWind: 0 },
  frozen_bridge: { id: 'frozen_bridge', width: ARENA_WIDTH, maxWind: 0 },
  blood_keep: { id: 'blood_keep', width: ARENA_WIDTH, maxWind: 0 },
  fog_ruins: { id: 'fog_ruins', width: ARENA_WIDTH, maxWind: 0 },
};

/** La arena de una partida concreta. Una partida anterior a los obstáculos aleatorios se reproduce sin ninguno. */
export function arenaFor(setup: { readonly arenaId: ArenaId; readonly obstacles?: readonly Obstacle[] }): ArenaDefinition {
  return { ...ARENAS[setup.arenaId], obstacles: setup.obstacles ?? [] };
}
