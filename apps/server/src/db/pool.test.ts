import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createPool, tokenClaims, type TokenSource } from './pool.js';

type PasswordFn = () => Promise<string>;
const passwordOf = (pool: unknown): unknown => (pool as { options: { password?: unknown } }).options.password;

describe('tokenClaims', () => {
  it('extrae solo los datos de identificación, y tolera un token ilegible', () => {
    const payload = Buffer.from(JSON.stringify({ aud: 'a', tid: 't', oid: 'o', appid: 'c', secreto: 'x' })).toString('base64url');
    expect(tokenClaims(`h.${payload}.firma`)).toEqual({ aud: 'a', tid: 't', oid: 'o', appid: 'c' });
    expect(tokenClaims('basura')).toEqual({});
  });
});

describe('createPool', () => {
  it('sin identidad administrada no define contraseña ni exige TLS, para el entorno local', async () => {
    const pool = createPool({ connectionString: 'postgres://u@localhost/db' });
    expect(passwordOf(pool)).toBeUndefined();
    await pool.end();
  });

  it('con identidad administrada usa un token nuevo y el ámbito de PostgreSQL', async () => {
    const scopes: string[] = [];
    let issued = 0;
    const tokenSource: TokenSource = {
      getToken: (scope) => {
        scopes.push(scope);
        issued += 1;
        return Promise.resolve({ token: `token-${String(issued)}` });
      },
    };
    const pool = createPool({ connectionString: 'postgres://u@host/db', tokenSource });
    const password = passwordOf(pool) as PasswordFn;
    expect(await password()).toBe('token-1');
    expect(await password()).toBe('token-2');
    expect(scopes[0]).toBe('https://ossrdbms-aad.database.windows.net/.default');
    await pool.end();
  });

  it('el cliente real de pg conserva la función de contraseña, el usuario, el host y TLS', async () => {
    const pool = createPool({
      connectionString: 'postgres://id-ashenfall-dev@psql.example:5432/ashenfall?sslmode=require',
      tokenSource: { getToken: () => Promise.resolve({ token: 't' }) },
    });
    const { options } = pool as unknown as { options: pg.ClientConfig };
    const client = new pg.Client(options) as unknown as { password: unknown; user: string; host: string; database: string; ssl: unknown };
    expect(typeof client.password).toBe('function');
    expect(client.user).toBe('id-ashenfall-dev');
    expect(client.host).toBe('psql.example');
    expect(client.database).toBe('ashenfall');
    expect(client.ssl).toEqual({ rejectUnauthorized: true });
    await pool.end();
  });

  it('falla de forma explícita si no se obtiene un token', async () => {
    const pool = createPool({ connectionString: 'postgres://u@host/db', tokenSource: { getToken: () => Promise.resolve(null) } });
    await expect((passwordOf(pool) as PasswordFn)()).rejects.toThrow(/token/);
    await pool.end();
  });
});
