import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, staticCacheControl } from './app.js';
import { createTestDatabase, type TestDatabase } from './test-support/database.js';

const SCRIPT = 'console.log("ashenfall");'.repeat(200);
let db: TestDatabase;
let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDatabase();
  dir = mkdtempSync(join(tmpdir(), 'ashenfall-static-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'art'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ASHENFALL</title>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), SCRIPT);
  writeFileSync(join(dir, 'assets', 'index-abc123.js.br'), brotliCompressSync(SCRIPT));
  writeFileSync(join(dir, 'assets', 'index-abc123.js.gz'), gzipSync(SCRIPT));
  writeFileSync(join(dir, 'art', 'logo.webp'), Buffer.from('RIFF0000WEBP'));
  app = buildApp({
    pool: db.pool,
    clientDir: dir,
    auth: { jwtSecret: 'x'.repeat(40), accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 },
    rateLimit: { globalPerMinute: 100_000, authPerMinute: 100_000, loginPerAccountPerMinute: 100_000 },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
});

describe('cliente estático', () => {
  it('sirve el JS precomprimido con brotli o gzip y lo cachea para siempre', async () => {
    const br = await app.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(br.statusCode).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toContain('javascript');
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(String(br.headers.vary)).toContain('accept-encoding');
    expect(br.rawPayload.length).toBeLessThan(SCRIPT.length);
    // Los encabezados de seguridad siguen presentes en los estáticos.
    expect(br.headers['content-security-policy']).toBeDefined();
    expect(br.headers['x-content-type-options']).toBe('nosniff');

    const gzip = await app.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gzip.headers['content-encoding']).toBe('gzip');

    const plain = await app.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'identity' } });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.payload).toBe(SCRIPT);
  });

  it('el arte se cachea una hora y el HTML siempre se revalida', async () => {
    const art = await app.inject({ method: 'GET', url: '/art/logo.webp', headers: { 'accept-encoding': 'br' } });
    expect(art.statusCode).toBe(200);
    expect(art.headers['cache-control']).toBe('public, max-age=3600');
    expect(art.headers['content-encoding']).toBeUndefined();

    const html = await app.inject({ method: 'GET', url: '/' });
    expect(html.statusCode).toBe(200);
    expect(html.headers['cache-control']).toBe('no-cache');
    const etag = html.headers.etag;
    expect(etag).toBeDefined();
    const again = await app.inject({ method: 'GET', url: '/', headers: { 'if-none-match': String(etag) } });
    expect(again.statusCode).toBe(304);
  });

  it('clasifica las rutas por su carpeta relativa', () => {
    expect(staticCacheControl('assets/phaser-x.js.br')).toContain('immutable');
    expect(staticCacheControl('art/obs-atlas.json')).toBe('public, max-age=3600');
    expect(staticCacheControl('index.html')).toBe('no-cache');
  });
});
