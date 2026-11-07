import { describe, expect, it } from 'vitest';
import { ARENAS, ARENA_IDS, type ArenaDefinition } from './arenas.js';
import {
  applyKnockback,
  HEAD_FROM,
  LEGS_BELOW,
  muzzlePosition,
  playerHitbox,
  segmentEntryFraction,
  simulateShot,
  KNOCKBACK_PER_DAMAGE,
  MAX_FLIGHT_STEPS,
  MAX_KNOCKBACK,
  STEP_SECONDS,
  type ShotInput,
} from './physics.js';
import { CHARACTER_FAMILY, CHARACTER_IDS, CHARACTER_PRICE, computeDamage, powerTier, MAX_DAMAGE_PER_SHOT, STARTER_CHARACTER, WEAPONS, WEAPON_FAMILIES, WEAPON_IDS } from './weapons.js';

const emptyArena: ArenaDefinition = { id: 'ember_desert', width: 2000, obstacles: [], spawnPairs: [], maxWind: 0 };

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

import { hitZone } from './physics.js';
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

  it('la ballesta se ve menos afectada por el viento que el arco', () => {
    const drift = (weapon: ShotInput['weapon']) =>
      Math.abs(
        simulateShot(shot({ weapon, windAccel: 100 })).impact.x - simulateShot(shot({ weapon, windAccel: 0 })).impact.x,
      ) / simulateShot(shot({ weapon })).flightMs;
    expect(drift(WEAPONS.crossbow)).toBeLessThan(drift(WEAPONS.bow));
  });

  it('un proyectil rápido no atraviesa un objetivo entre dos pasos', () => {
    // A máxima velocidad el proyectil avanza más que el grosor del objetivo en cada paso.
    const stepLength = WEAPONS.crossbow.maxSpeed * STEP_SECONDS;
    const thin = { x: 600, y: 0, width: 2, height: 400 };
    expect(stepLength).toBeGreaterThan(thin.width + WEAPONS.crossbow.radius * 2);
    const outcome = simulateShot(shot({ weapon: WEAPONS.crossbow, power: 100, angleDeg: 5, target: thin }));
    expect(outcome.impactKind).toBe('player');
    expect(outcome.impact.x).toBeLessThanOrEqual(thin.x);
  });

  it('un obstáculo antes del objetivo detiene el proyectil', () => {
    const arena = { ...emptyArena, obstacles: [{ kind: 'column' as const, x: 300, y: 0, width: 40, height: 500 }] };
    const outcome = simulateShot(
      shot({ arena, power: 100, angleDeg: 10, target: { x: 800, y: 0, width: 48, height: 400 } }),
    );
    expect(outcome.impactKind).toBe('obstacle');
  });

  it('un disparo fuera de la arena termina como out_of_bounds', () => {
    const outcome = simulateShot(shot({ origin: { x: 1950, y: 72 }, power: 100, weapon: WEAPONS.crossbow }));
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

describe('daño por zona y potencia', () => {
  const box = { x: 0, y: 0, width: 48, height: 96 };
  it('distingue cabeza, torso y piernas por la altura del impacto', () => {
    expect(hitZone({ x: 0, y: 90 }, box)).toBe('head');
    expect(hitZone({ x: 0, y: 50 }, box)).toBe('body');
    expect(hitZone({ x: 0, y: 10 }, box)).toBe('legs');
  });
  it('aplica niveles de potencia y zona sobre el daño base del arma, con tope', () => {
    expect([powerTier(39), powerTier(40), powerTier(75)]).toEqual(['weak', 'medium', 'strong']);
    for (const id of WEAPON_IDS) {
      const weapon = WEAPONS[id];
      expect(computeDamage(weapon, 50, 'body')).toBe(weapon.baseDamage);
      expect(computeDamage(weapon, 100, 'head')).toBeLessThanOrEqual(MAX_DAMAGE_PER_SHOT);
      expect(computeDamage(weapon, 10, 'legs')).toBeLessThan(weapon.baseDamage);
      expect(computeDamage(weapon, 10, 'legs')).toBeGreaterThanOrEqual(1);
    }
  });

  it('las armas mejores pegan más y solo las especiales dejan veneno o fuego', () => {
    for (const family of WEAPON_FAMILIES) {
      const [common, better, special] = [WEAPONS[family], WEAPONS[`${family}_2`], WEAPONS[`${family}_3`]];
      expect(better.baseDamage).toBeGreaterThan(common.baseDamage);
      expect(special.baseDamage).toBeGreaterThan(better.baseDamage);
      expect(common.effect).toBeUndefined();
      expect(better.effect).toBeUndefined();
      expect(special.effect).toBeDefined();
      expect(special.effect?.perSecond).toBeGreaterThanOrEqual(2);
      expect(special.effect?.perSecond).toBeLessThanOrEqual(5);
      expect(special.effect?.seconds).toBe(3);
      expect(special.price).toBeGreaterThanOrEqual(1500);
      expect(special.price).toBeLessThanOrEqual(2000);
      expect(common.price).toBe(0);
    }
  });

  it('cada personaje pertenece a una familia y el inicial es gratis', () => {
    expect(CHARACTER_FAMILY.borgrim).toBe('axe');
    expect(CHARACTER_PRICE[STARTER_CHARACTER]).toBe(0);
    for (const id of CHARACTER_IDS) {
      expect(WEAPON_FAMILIES).toContain(CHARACTER_FAMILY[id]);
      if (id !== STARTER_CHARACTER) expect(CHARACTER_PRICE[id]).toBeGreaterThan(0);
    }
  });

  it('el peso cambia el vuelo: lo pesado cae más y pide más potencia que lo ligero', () => {
    expect(WEAPONS.mace.gravityScale).toBeGreaterThan(WEAPONS.dagger.gravityScale);
    expect(WEAPONS.axe.weight).toBeGreaterThan(WEAPONS.staff.weight);
  });
});

describe('applyKnockback', () => {
  const start = { x: 1000, y: 0 };

  it('retrocede alejándose del tirador, más cuanto más daño', () => {
    const light = applyKnockback(start, 1, 10, emptyArena);
    const heavy = applyKnockback(start, 1, 25, emptyArena);
    expect(light.x).toBe(1000 - 10 * KNOCKBACK_PER_DAMAGE);
    expect(heavy.x).toBeLessThan(light.x);
    expect(applyKnockback(start, -1, 10, emptyArena).x).toBe(1000 + 10 * KNOCKBACK_PER_DAMAGE);
  });

  it('sin daño no se mueve y con mucho daño tiene un tope', () => {
    expect(applyKnockback(start, 1, 0, emptyArena)).toEqual(start);
    expect(applyKnockback(start, 1, 1000, emptyArena).x).toBe(1000 - MAX_KNOCKBACK);
  });

  it('se detiene en el borde de la arena', () => {
    const nearEdge = applyKnockback({ x: 100, y: 0 }, 1, 50, emptyArena);
    expect(nearEdge.x).toBeGreaterThanOrEqual(40 + 24);
    expect(nearEdge.x).toBeLessThan(100);
    expect(applyKnockback({ x: 1900, y: 0 }, -1, 50, emptyArena).x).toBeLessThanOrEqual(2000 - 64);
  });

  it('no atraviesa un obstáculo alto', () => {
    const arena: ArenaDefinition = { ...emptyArena, obstacles: [{ x: 900, y: 0, width: 50, height: 90 }] };
    const result = applyKnockback(start, 1, 40, arena);
    expect(result.x - 24).toBeGreaterThanOrEqual(950);
    expect(result.y).toBe(0);
  });

  it('cae al suelo si retrocede fuera de una repisa', () => {
    const arena: ArenaDefinition = { ...emptyArena, obstacles: [{ x: 960, y: 0, width: 60, height: 110 }] };
    const result = applyKnockback({ x: 990, y: 110 }, 1, 20, arena);
    expect(result.y).toBe(0);
    expect(result.x).toBeLessThan(990);
  });

  it('es determinista', () => {
    expect(applyKnockback(start, 1, 17, ARENAS.frozen_bridge)).toEqual(applyKnockback(start, 1, 17, ARENAS.frozen_bridge));
  });
});

describe('zonas de impacto', () => {
  const box = playerHitbox({ x: 1000, y: 0 });
  const at = (fraction: number) => hitZone({ x: 1000, y: box.y + box.height * fraction }, box);

  it('la cabeza es una franja mínima en lo alto', () => {
    expect(at(0.95)).toBe('head');
    expect(at(0.9)).toBe('head');
    expect(HEAD_FROM).toBeGreaterThanOrEqual(0.85);
  });

  it('el centro del personaje es el torso, no la cabeza', () => {
    expect(at(0.5)).toBe('body');
    expect(at(0.7)).toBe('body');
    expect(at(0.8)).toBe('body');
  });

  it('la parte baja son las piernas', () => {
    expect(at(0.1)).toBe('legs');
    expect(at(0.35)).toBe('legs');
    expect(at(LEGS_BELOW)).toBe('body');
  });
});
