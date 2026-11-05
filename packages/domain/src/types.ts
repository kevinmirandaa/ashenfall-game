export type PlayerId = string;
export type MatchId = string;
export type ActionId = string;

/** Coordenadas de mundo: x crece hacia la derecha, y crece hacia arriba y el suelo está en y = 0. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Rectángulo alineado a los ejes; (x, y) es la esquina inferior izquierda. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Puerto de azar. El servidor lo implementa con un generador criptográficamente seguro. */
export interface RandomSource {
  /** Devuelve un entero uniforme en [0, exclusiveMax). */
  intBelow(exclusiveMax: number): number;
}
