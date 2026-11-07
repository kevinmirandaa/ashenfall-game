import type { ArenaDefinition } from './arenas.js';
import type { Rect, Vec2 } from './types.js';
import type { HitZone, WeaponProfile } from './weapons.js';

/** Sube si cambia cualquier constante: el cliente la compara para saber si su guía sigue siendo válida. */
export const PHYSICS_VERSION = 5;

export const GRAVITY = 900;
export const STEP_SECONDS = 1 / 60;
export const MAX_FLIGHT_STEPS = 600;
export const PATH_SAMPLE_EVERY_STEPS = 6;
export const OUT_OF_BOUNDS_MARGIN = 200;

/** Hitbox lógica idéntica para todos los personajes: la apariencia nunca cambia las colisiones. */
export const PLAYER_HITBOX = { width: 48, height: 140 } as const;
export const MUZZLE_OFFSET = { forward: 28, up: 92 } as const;

export type Facing = 1 | -1;
export type ImpactKind = 'player' | 'obstacle' | 'ground' | 'out_of_bounds';

export interface ShotInput {
  readonly origin: Vec2;
  readonly facing: Facing;
  readonly angleDeg: number;
  readonly power: number;
  readonly weapon: WeaponProfile;
  readonly windAccel: number;
  readonly arena: ArenaDefinition;
  readonly target: Rect;
}

export interface ShotOutcome {
  readonly impactKind: ImpactKind;
  readonly impact: Vec2;
  readonly flightMs: number;
  /** Puntos enteros de la trayectoria para que el cliente anime y la cámara siga el disparo. */
  readonly path: readonly Vec2[];
}

export function playerHitbox(position: Vec2): Rect {
  return {
    x: position.x - PLAYER_HITBOX.width / 2,
    y: position.y,
    width: PLAYER_HITBOX.width,
    height: PLAYER_HITBOX.height,
  };
}

/** Fracción de la altura del dibujo, medida desde los pies, a partir de la cual el impacto es en la cabeza. */
export const HEAD_FROM = 0.87;
/** Por debajo de esta fracción el impacto es en las piernas. */
export const LEGS_BELOW = 0.4;

/** Zona según la altura del impacto: una franja mínima arriba es la cabeza, luego el torso y las piernas. */
export function hitZone(impact: Vec2, target: Rect): HitZone {
  const height = (impact.y - target.y) / target.height;
  if (height >= HEAD_FROM) return 'head';
  return height < LEGS_BELOW ? 'legs' : 'body';
}

/** Unidades que retrocede un personaje por cada punto de daño recibido. */
export const KNOCKBACK_PER_DAMAGE = 3;
export const MAX_KNOCKBACK = 240;
const KNOCKBACK_STEP = 2;
/** Desnivel que se puede subir andando hacia atrás; un obstáculo más alto bloquea el retroceso. */
const KNOCKBACK_STEP_UP = 24;
const ARENA_EDGE_MARGIN = 40;

/** Altura de la superficie bajo el personaje en `x`: el techo del obstáculo más alto que pisa, o el suelo. */
function supportHeight(x: number, arena: ArenaDefinition): number {
  const half = PLAYER_HITBOX.width / 2;
  let top = 0;
  for (const obstacle of arena.obstacles) {
    if (obstacle.x < x + half && obstacle.x + obstacle.width > x - half) top = Math.max(top, obstacle.y + obstacle.height);
  }
  return top;
}

/**
 * Posición final tras recibir un impacto: retrocede alejándose del tirador y no vuelve nunca.
 * Se detiene en el borde de la arena o ante un obstáculo; si pierde el apoyo, cae al suelo.
 * Es aritmética entera por pasos fijos, así que repetir la partida da siempre el mismo resultado.
 */
export function applyKnockback(position: Vec2, facing: Facing, damage: number, arena: ArenaDefinition): Vec2 {
  const distance = Math.min(MAX_KNOCKBACK, Math.max(0, damage) * KNOCKBACK_PER_DAMAGE);
  const minX = ARENA_EDGE_MARGIN + PLAYER_HITBOX.width / 2;
  const maxX = arena.width - minX;
  let current = position;
  for (let moved = KNOCKBACK_STEP; moved <= distance; moved += KNOCKBACK_STEP) {
    const x = current.x - facing * KNOCKBACK_STEP;
    if (x < minX || x > maxX) break;
    const support = supportHeight(x, arena);
    if (support > current.y + KNOCKBACK_STEP_UP) break;
    current = { x, y: support };
  }
  return roundPoint(current);
}

export function muzzlePosition(position: Vec2, facing: Facing): Vec2 {
  return { x: position.x + facing * MUZZLE_OFFSET.forward, y: position.y + MUZZLE_OFFSET.up };
}

function roundPoint(point: Vec2): Vec2 {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

/**
 * Fracción [0, 1] del segmento a-b en la que entra al rectángulo ampliado por `padding`, o null si no lo toca.
 * Probar el segmento completo evita que un proyectil rápido atraviese un objetivo entre dos pasos.
 */
export function segmentEntryFraction(a: Vec2, b: Vec2, rect: Rect, padding: number): number | null {
  let entry = 0;
  let exit = 1;
  const axes = [
    { start: a.x, delta: b.x - a.x, min: rect.x - padding, max: rect.x + rect.width + padding },
    { start: a.y, delta: b.y - a.y, min: rect.y - padding, max: rect.y + rect.height + padding },
  ];
  for (const { start, delta, min, max } of axes) {
    if (delta === 0) {
      if (start < min || start > max) return null;
      continue;
    }
    const t1 = (min - start) / delta;
    const t2 = (max - start) / delta;
    entry = Math.max(entry, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (entry > exit) return null;
  }
  return entry;
}

interface StepHit {
  readonly kind: ImpactKind;
  readonly fraction: number;
}

function firstHitInStep(from: Vec2, to: Vec2, input: ShotInput): StepHit | null {
  const radius = input.weapon.radius;
  let best: StepHit | null = null;

  const targetFraction = segmentEntryFraction(from, to, input.target, radius);
  if (targetFraction !== null) best = { kind: 'player', fraction: targetFraction };

  for (const obstacle of input.arena.obstacles) {
    const fraction = segmentEntryFraction(from, to, obstacle, radius);
    if (fraction !== null && (best === null || fraction < best.fraction)) {
      best = { kind: 'obstacle', fraction };
    }
  }

  if (to.y <= radius) {
    const fraction = from.y <= radius ? 0 : (from.y - radius) / (from.y - to.y);
    if (best === null || fraction < best.fraction) best = { kind: 'ground', fraction };
  }
  return best;
}

/**
 * Simulación determinista por pasos fijos con Euler semiimplícito.
 * El resultado se guarda en el evento de la jugada, así que reproducir una partida nunca vuelve a simular.
 */
export function simulateShot(input: ShotInput): ShotOutcome {
  const { weapon, facing, arena } = input;
  const speed = weapon.maxSpeed * (input.power / 100);
  const radians = (input.angleDeg * Math.PI) / 180;
  const accelX = input.windAccel * weapon.windScale;
  const accelY = -GRAVITY * weapon.gravityScale;

  let velocityX = facing * speed * Math.cos(radians);
  let velocityY = speed * Math.sin(radians);
  let position = input.origin;
  const path: Vec2[] = [roundPoint(position)];

  const finish = (kind: ImpactKind, impact: Vec2, step: number): ShotOutcome => {
    const roundedImpact = roundPoint(impact);
    return {
      impactKind: kind,
      impact: roundedImpact,
      flightMs: Math.round(step * STEP_SECONDS * 1000),
      path: [...path, roundedImpact],
    };
  };

  for (let step = 1; step <= MAX_FLIGHT_STEPS; step += 1) {
    velocityX += accelX * STEP_SECONDS;
    velocityY += accelY * STEP_SECONDS;
    const next: Vec2 = { x: position.x + velocityX * STEP_SECONDS, y: position.y + velocityY * STEP_SECONDS };

    const hit = firstHitInStep(position, next, input);
    if (hit !== null) {
      const impact: Vec2 = {
        x: position.x + (next.x - position.x) * hit.fraction,
        y: position.y + (next.y - position.y) * hit.fraction,
      };
      return finish(hit.kind, impact, step);
    }

    if (next.x < -OUT_OF_BOUNDS_MARGIN || next.x > arena.width + OUT_OF_BOUNDS_MARGIN) {
      return finish('out_of_bounds', next, step);
    }

    if (step % PATH_SAMPLE_EVERY_STEPS === 0) path.push(roundPoint(next));
    position = next;
  }
  return finish('out_of_bounds', position, MAX_FLIGHT_STEPS);
}
