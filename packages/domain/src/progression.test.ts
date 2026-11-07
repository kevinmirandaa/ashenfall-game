import { describe, expect, it } from 'vitest';
import { CHARACTER_LEVEL, MAX_LEVEL, progressFor, XP_PER_LEVEL, XP_PER_MATCH, XP_PER_WIN } from './progression.js';
import { CHARACTER_IDS, CHARACTER_PRICE, STARTER_CHARACTER } from './weapons.js';

describe('nivel', () => {
  it('empieza en 1 y sube con las partidas jugadas y, más aún, con las ganadas', () => {
    expect(progressFor(0, 0)).toMatchObject({ level: 1, xp: 0 });
    expect(progressFor(1, 0).xp).toBe(XP_PER_MATCH);
    expect(progressFor(1, 1).xp).toBe(XP_PER_MATCH + XP_PER_WIN);
    expect(progressFor(10, 10).level).toBeGreaterThan(progressFor(10, 0).level);
    expect(progressFor(2, 2)).toMatchObject({ level: 1 + Math.floor((2 * XP_PER_MATCH + 2 * XP_PER_WIN) / XP_PER_LEVEL) });
  });

  it('tiene tope y nunca baja con datos raros', () => {
    expect(progressFor(10_000, 10_000).level).toBe(MAX_LEVEL);
    expect(progressFor(-5, -5).level).toBe(1);
    const mid = progressFor(3, 1);
    expect(mid.xpInLevel).toBeLessThan(mid.xpForNext);
  });
});

describe('personajes: nivel y precio', () => {
  it('el inicial es de nivel 1 y gratis; el resto exige nivel creciente y dinero', () => {
    expect(CHARACTER_LEVEL[STARTER_CHARACTER]).toBe(1);
    expect(CHARACTER_PRICE[STARTER_CHARACTER]).toBe(0);
    const others = CHARACTER_IDS.filter((id) => id !== STARTER_CHARACTER);
    for (const id of others) {
      expect(CHARACTER_LEVEL[id]).toBeGreaterThan(1);
      expect(CHARACTER_PRICE[id]).toBeGreaterThan(0);
    }
    const levels = others.map((id) => CHARACTER_LEVEL[id]);
    expect(new Set(levels).size).toBe(levels.length);
    expect(Math.max(...levels)).toBeLessThanOrEqual(MAX_LEVEL);
  });
});
