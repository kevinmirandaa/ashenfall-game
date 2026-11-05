import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://cache' };

describe('loadConfig', () => {
  it('no arranca sin clave JWT ni con una clave corta', () => {
    expect(() => loadConfig(base)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'corta' })).toThrow(/JWT_SECRET/);
  });

  it('solo genera una clave en modo de desarrollo explícito, y distinta cada vez', () => {
    const first = loadConfig({ ...base, ASHENFALL_DEV_SECRETS: '1' });
    const second = loadConfig({ ...base, ASHENFALL_DEV_SECRETS: '1' });
    expect(first.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(first.jwtSecret).not.toBe(second.jwtSecret);
  });

  it('interpreta orígenes y proxy', () => {
    const config = loadConfig({ ...base, JWT_SECRET: 'x'.repeat(32), ALLOWED_ORIGINS: 'https://a.test, https://b.test', TRUST_PROXY: '1' });
    expect(config.allowedOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(config.trustProxy).toBe(true);
  });
});
