import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createTestDatabase, type TestDatabase } from '../test-support/database.js';

const jwtSecret = randomBytes(32).toString('hex');
const PASSWORD = 'una-clave-larga-de-prueba';
let db: TestDatabase;
let app: FastifyInstance;

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = buildApp({ pool: db.pool, auth: { jwtSecret, accessTokenTtlSeconds: 300, refreshTokenTtlSeconds: 3600 } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const refresh = (refreshToken: string) => post('/v1/auth/refresh', { refreshToken });
const me = (token: string) => app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });

async function register(): Promise<Tokens & { email: string }> {
  const email = `${randomUUID()}@test.invalid`;
  const response = await post('/v1/auth/register', { email, password: PASSWORD, displayName: 'Edrik' });
  expect(response.statusCode).toBe(201);
  return { ...response.json<Tokens>(), email };
}

describe('registro y login', () => {
  it('registra, entra y consulta el perfil sin exponer el hash', async () => {
    const { email } = await register();
    const login = await post('/v1/auth/login', { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const profile = await me(login.json<Tokens>().accessToken);
    expect(profile.json()).toMatchObject({ email, displayName: 'Edrik', role: 'player', balance: 0 });
    expect(profile.body).not.toContain('argon2');
  });

  it('guarda la contraseña con Argon2id', async () => {
    const { email } = await register();
    const { rows } = await db.pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0]?.password_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('rechaza un correo repetido, sin distinguir mayúsculas', async () => {
    const { email } = await register();
    const response = await post('/v1/auth/register', { email: email.toUpperCase(), password: PASSWORD, displayName: 'Otro' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('da el mismo error con correo inexistente y con contraseña incorrecta', async () => {
    const { email } = await register();
    const wrong = await post('/v1/auth/login', { email, password: 'otra-clave-incorrecta' });
    const unknown = await post('/v1/auth/login', { email: 'nadie@test.invalid', password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  it.each([
    ['correo inválido', { email: 'x', password: PASSWORD, displayName: 'Edrik' }],
    ['contraseña corta', { email: 'a@test.invalid', password: 'corta', displayName: 'Edrik' }],
    ['contraseña enorme', { email: 'a@test.invalid', password: 'x'.repeat(129), displayName: 'Edrik' }],
    ['nombre con marcado', { email: 'a@test.invalid', password: PASSWORD, displayName: '<script>' }],
  ])('rechaza %s con Problem Details', async (_name, body) => {
    const response = await post('/v1/auth/register', body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('no permite elegir el rol al registrarse', async () => {
    const response = await post('/v1/auth/register', {
      email: `${randomUUID()}@test.invalid`,
      password: PASSWORD,
      displayName: 'Mallory',
      role: 'admin',
    });
    if (response.statusCode === 201) {
      expect((await me(response.json<Tokens>().accessToken)).json()).toMatchObject({ role: 'player' });
    } else {
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('token de acceso', () => {
  it('rechaza ausente, malformado, firmado con otra clave y vencido', async () => {
    const { rows } = await db.pool.query<{ id: string }>('SELECT id FROM users LIMIT 1');
    const sign = (secret: string, expires: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(rows[0]?.id ?? '')
        .setIssuer('ashenfall')
        .setAudience('ashenfall-api')
        .setExpirationTime(expires)
        .sign(new TextEncoder().encode(secret));
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await me('basura')).statusCode).toBe(401);
    expect((await me(await sign('otra-clave-distinta-de-la-buena-000', '5m'))).statusCode).toBe(401);
    expect((await me(await sign(jwtSecret, '-1s'))).statusCode).toBe(401);
    expect((await me(await sign(jwtSecret, '5m'))).statusCode).toBe(200);
  });

  it('rechaza un token sin firma (alg none)', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const forged = `${encode({ alg: 'none' })}.${encode({ sub: randomUUID(), iss: 'ashenfall', aud: 'ashenfall-api' })}.`;
    expect((await me(forged)).statusCode).toBe(401);
  });

  it('una suspensión surte efecto de inmediato', async () => {
    const { accessToken, refreshToken, email } = await register();
    await db.pool.query('UPDATE users SET suspended_at = now() WHERE email = $1', [email]);
    expect((await me(accessToken)).json()).toMatchObject({ code: 'USER_SUSPENDED' });
    expect((await refresh(refreshToken)).statusCode).toBe(403);
    expect((await post('/v1/auth/login', { email, password: PASSWORD })).statusCode).toBe(403);
  });
});

describe('refresh rotativo', () => {
  it('rota el token y el nuevo funciona', async () => {
    const first = await register();
    const response = await refresh(first.refreshToken);
    expect(response.statusCode).toBe(200);
    const next = response.json<Tokens>();
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect((await me(next.accessToken)).statusCode).toBe(200);
  });

  it('solo guarda el hash del token', async () => {
    const { refreshToken } = await register();
    const { rows } = await db.pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [refreshToken]);
    expect(rows).toEqual([]);
  });

  it('reutilizar un token rotado revoca toda la familia', async () => {
    const first = await register();
    const next = (await refresh(first.refreshToken)).json<Tokens>();
    expect((await refresh(first.refreshToken)).statusCode).toBe(401);
    expect((await refresh(next.refreshToken)).statusCode).toBe(401);
  });

  it('con refresh simultáneos del mismo token, solo uno tiene éxito', async () => {
    const { refreshToken } = await register();
    const responses = await Promise.all(Array.from({ length: 6 }, () => refresh(refreshToken)));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
  });

  it('rechaza un token vencido o desconocido', async () => {
    const { refreshToken } = await register();
    await db.pool.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 second'`);
    expect((await refresh(refreshToken)).statusCode).toBe(401);
    expect((await refresh('desconocido')).statusCode).toBe(401);
  });

  it('logout invalida la sesión y es idempotente', async () => {
    const { refreshToken } = await register();
    expect((await post('/v1/auth/logout', { refreshToken })).statusCode).toBe(204);
    expect((await post('/v1/auth/logout', { refreshToken })).statusCode).toBe(204);
    expect((await refresh(refreshToken)).statusCode).toBe(401);
  });
});

describe('errores', () => {
  it('una ruta inexistente responde con Problem Details', async () => {
    const response = await app.inject({ method: 'GET', url: '/no-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('un cuerpo demasiado grande se rechaza', async () => {
    const response = await post('/v1/auth/login', { email: 'a@test.invalid', password: 'x'.repeat(20_000) });
    expect(response.statusCode).toBe(413);
  });
});
