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

  it('HTTPS obligatorio solo si se configura', () => {
    expect(loadConfig({ ...base, JWT_SECRET: 'x'.repeat(32) }).enforceHttps).toBe(false);
    expect(loadConfig({ ...base, JWT_SECRET: 'x'.repeat(32), ENFORCE_HTTPS: '1' }).enforceHttps).toBe(true);
  });

  it('interpreta orígenes y proxy', () => {
    const config = loadConfig({ ...base, JWT_SECRET: 'x'.repeat(32), ALLOWED_ORIGINS: 'https://a.test, https://b.test', TRUST_PROXY: '1' });
    expect(config.allowedOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(config.trustProxy).toBe(true);
  });

  it('no arranca con un número mal escrito en el puerto o en los límites de tasa', () => {
    const valid = { ...base, JWT_SECRET: 'x'.repeat(32) };
    expect(loadConfig(valid).port).toBe(8080);
    expect(loadConfig({ ...valid, PORT: '9090', RATE_LIMIT_AUTH_PER_MINUTE: '5' })).toMatchObject({ port: 9090, rateLimit: { authPerMinute: 5 } });
    expect(() => loadConfig({ ...valid, PORT: 'ocho' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...valid, RATE_LIMIT_GLOBAL_PER_MINUTE: '0' })).toThrow(/RATE_LIMIT_GLOBAL_PER_MINUTE/);
  });

  it('la espera máxima de la cola y el periodo de gracia son configurables', () => {
    const valid = { ...base, JWT_SECRET: 'x'.repeat(32) };
    expect(loadConfig(valid)).toMatchObject({ matchmakingMaxWaitMs: 60_000, reconnectGraceMs: 60_000 });
    expect(loadConfig({ ...valid, MATCHMAKING_MAX_WAIT_MS: '15000', RECONNECT_GRACE_MS: '5000' })).toMatchObject({
      matchmakingMaxWaitMs: 15_000,
      reconnectGraceMs: 5_000,
    });
    expect(() => loadConfig({ ...valid, RECONNECT_GRACE_MS: '-1' })).toThrow(/RECONNECT_GRACE_MS/);
  });
});
