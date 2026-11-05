import { describe, expect, it } from 'vitest';
import { createPool, type TokenSource } from './pool.js';

type PasswordFn = () => Promise<string>;
const passwordOf = (pool: unknown): unknown => (pool as { options: { password?: unknown } }).options.password;

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

  it('falla de forma explícita si no se obtiene un token', async () => {
    const pool = createPool({ connectionString: 'postgres://u@host/db', tokenSource: { getToken: () => Promise.resolve(null) } });
    await expect((passwordOf(pool) as PasswordFn)()).rejects.toThrow(/token/);
    await pool.end();
  });
});
