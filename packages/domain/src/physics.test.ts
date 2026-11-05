import { describe, expect, it } from 'vitest';
import { ARENAS, ARENA_IDS, type ArenaDefinition } from './arenas.js';
import {
  muzzlePosition,
  playerHitbox,
  segmentEntryFraction,
  simulateShot,
  MAX_FLIGHT_STEPS,
  STEP_SECONDS,
  type ShotInput,
} from './physics.js';
import { computeDamage, MAX_DAMAGE_PER_SHOT, WEAPONS, WEAPON_IDS } from './weapons.js';

const emptyArena: ArenaDefinition = { id: 'ashen_desert', width: 2000, obstacles: [], spawnPairs: [], maxWind: 0 };

function shot(overrides: Partial<ShotInput> = {}): ShotInput {
  return {
    origin: { x: 100, y: 72 },
    facing: 1,
    angleDeg: 45,
    power: 50,
    weapon: WEAPONS.bow,
    windAccel: 0,
    arena: emptyArena,
    target: { x: 5000, y: 0, width: 48, height: 96 },
    ...overrides,
  };
}

describe('segmentEntryFraction', () => {
  const rect = { x: 10, y: 10, width: 10, height: 10 };

  it('devuelve la fracción en la que el segmento entra al rectángulo', () => {
    expect(segmentEntryFraction({ x: 0, y: 15 }, { x: 20, y: 15 }, rect, 0)).toBeCloseTo(0.5);
  });

  it('devuelve null si el segmento no toca el rectángulo', () => {
    expect(segmentEntryFraction({ x: 0, y: 0 }, { x: 5, y: 5 }, rect, 0)).toBeNull();
    expect(segmentEntryFraction({ x: 0, y: 30 }, { x: 40, y: 30 }, rect, 0)).toBeNull();
  });

  it('considera el radio del proyectil como relleno', () => {
    expect(segmentEntryFraction({ x: 0, y: 22 }, { x: 40, y: 22 }, rect, 0)).toBeNull();
    expect(segmentEntryFraction({ x: 0, y: 22 }, { x: 40, y: 22 }, rect, 3)).not.toBeNull();
  });

  it('devuelve 0 si el segmento empieza dentro', () => {
    expect(segmentEntryFraction({ x: 15, y: 15 }, { x: 40, y: 15 }, rect, 0)).toBe(0);
  });
});

describe('simulateShot', () => {
  it('es determinista: la misma entrada produce exactamente el mismo resultado', () => {
    expect(simulateShot(shot())).toEqual(simulateShot(shot()));
  });

  it('termina en el suelo cuando no hay nada más que golpear', () => {
    const outcome = simulateShot(shot());
    expect(outcome.impactKind).toBe('ground');
    expect(outcome.impact.y).toBe(WEAPONS.bow.radius);
    expect(outcome.flightMs).toBeGreaterThan(0);
  });

  it('a más potencia llega más lejos', () => {
    const near = simulateShot(shot({ power: 30 }));
    const far = simulateShot(shot({ power: 60 }));
    expect(far.impact.x).toBeGreaterThan(near.impact.x);
  });

  it('el mismo tiro en espejo cae a la misma distancia', () => {
    const right = simulateShot(shot({ origin: { x: 1000, y: 72 }, facing: 1 }));
    const left = simulateShot(shot({ origin: { x: 1000, y: 72 }, facing: -1 }));
    expect(right.impact.x - 1000).toBe(1000 - left.impact.x);
  });

  it('el viento a favor alarga el tiro y en contra lo acorta', () => {
    const still = simulateShot(shot());
    const tailwind = simulateShot(shot({ windAccel: 100 }));
    const headwind = simulateShot(shot({ windAccel: -100 }));
    expect(tailwind.impact.x).toBeGreaterThan(still.impact.x);
    expect(headwind.impact.x).toBeLessThan(still.impact.x);
  });

  it('la lanza se ve menos afectada por el viento que el arco', () => {
    const drift = (weapon: ShotInput['weapon']) =>
      Math.abs(
        simulateShot(shot({ weapon, windAccel: 100 })).impact.x - simulateShot(shot({ weapon, windAccel: 0 })).impact.x,
      ) / simulateShot(shot({ weapon })).flightMs;
    expect(drift(WEAPONS.spear)).toBeLessThan(drift(WEAPONS.bow));
  });

  it('un proyectil rápido no atraviesa un objetivo entre dos pasos', () => {
    // A máxima velocidad el proyectil avanza más que el grosor del objetivo en cada paso.
    const stepLength = WEAPONS.dagger.maxSpeed * STEP_SECONDS;
    const thin = { x: 600, y: 0, width: 2, height: 400 };
    expect(stepLength).toBeGreaterThan(thin.width + WEAPONS.dagger.radius * 2);
    const outcome = simulateShot(shot({ weapon: WEAPONS.dagger, power: 100, angleDeg: 5, target: thin }));
    expect(outcome.impactKind).toBe('player');
    expect(outcome.impact.x).toBeLessThanOrEqual(thin.x);
  });

  it('un obstáculo antes del objetivo detiene el proyectil', () => {
    const arena = { ...emptyArena, obstacles: [{ x: 300, y: 0, width: 40, height: 500 }] };
    const outcome = simulateShot(
      shot({ arena, power: 100, angleDeg: 10, target: { x: 800, y: 0, width: 48, height: 400 } }),
    );
    expect(outcome.impactKind).toBe('obstacle');
  });

  it('un disparo fuera de la arena termina como out_of_bounds', () => {
    const outcome = simulateShot(shot({ origin: { x: 1950, y: 72 }, power: 100, weapon: WEAPONS.dagger }));
    expect(outcome.impactKind).toBe('out_of_bounds');
  });

  it('la trayectoria empieza en el origen, termina en el impacto y solo usa enteros', () => {
    const outcome = simulateShot(shot());
    expect(outcome.path[0]).toEqual({ x: 100, y: 72 });
    expect(outcome.path.at(-1)).toEqual(outcome.impact);
    for (const point of outcome.path) {
      expect(Number.isInteger(point.x) && Number.isInteger(point.y)).toBe(true);
    }
  });

  it('ningún tiro válido agota el límite de pasos de vuelo', () => {
    for (const id of WEAPON_IDS) {
      const outcome = simulateShot(shot({ weapon: WEAPONS[id], angleDeg: 90, power: 100 }));
      expect(outcome.flightMs).toBeLessThan(MAX_FLIGHT_STEPS * STEP_SECONDS * 1000);
    }
  });
});

describe('computeDamage', () => {
  it('es entero, positivo, acotado y crece con la potencia', () => {
    for (const id of WEAPON_IDS) {
      const low = computeDamage(WEAPONS[id], 10);
      const high = computeDamage(WEAPONS[id], 100);
      expect(Number.isInteger(low)).toBe(true);
      expect(low).toBeGreaterThan(0);
      expect(high).toBeGreaterThan(low);
      expect(high).toBeLessThanOrEqual(MAX_DAMAGE_PER_SHOT);
    }
  });
});

describe('arenas', () => {
  const combos = ARENA_IDS.flatMap((arenaId) =>
    ARENAS[arenaId].spawnPairs.map((pair, index) => ({ arenaId, pair, index })),
  );

  it('tienen obstáculos y puntos de aparición simétricos', () => {
    for (const id of ARENA_IDS) {
      const arena = ARENAS[id];
      const mirrored = arena.obstacles
        .map((rect) => ({ ...rect, x: arena.width - rect.x - rect.width }))
        .sort((a, b) => a.x - b.x);
      expect(mirrored).toEqual([...arena.obstacles].sort((a, b) => a.x - b.x));
      for (const { left, right } of arena.spawnPairs) {
        expect(left.y).toBe(right.y);
        expect(left.x).toBe(arena.width - right.x);
      }
    }
  });

  it('ningún punto de disparo queda dentro de un obstáculo', () => {
    for (const { arenaId, pair } of combos) {
      const muzzle = muzzlePosition(pair.left, 1);
      for (const obstacle of ARENAS[arenaId].obstacles) {
        const radius = Math.max(...WEAPON_IDS.map((id) => WEAPONS[id].radius));
        expect(segmentEntryFraction(muzzle, muzzle, obstacle, radius)).toBeNull();
      }
    }
  });

  it('desde cualquier aparición, con cualquier arma y viento extremo, se puede impactar al rival', () => {
    for (const { arenaId, pair, index } of combos) {
      const arena = ARENAS[arenaId];
      for (const weaponId of WEAPON_IDS) {
        for (const windAccel of [-arena.maxWind, 0, arena.maxWind]) {
          let reachable = false;
          search: for (let angleDeg = 5; angleDeg <= 85; angleDeg += 2) {
            for (let power = 30; power <= 100; power += 2) {
              const outcome = simulateShot({
                origin: muzzlePosition(pair.left, 1),
                facing: 1,
                angleDeg,
                power,
                weapon: WEAPONS[weaponId],
                windAccel,
                arena,
                target: playerHitbox(pair.right),
              });
              if (outcome.impactKind === 'player') {
                reachable = true;
                break search;
              }
            }
          }
          expect(reachable, `${arenaId}#${index} ${weaponId} viento ${windAccel}`).toBe(true);
        }
      }
    }
  });
});
