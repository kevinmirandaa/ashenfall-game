import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  it('usa Argon2id con la configuración de OWASP y verifica', async () => {
    const hasher = new PasswordHasher();
    const hash = await hasher.hash('una-clave-larga-de-prueba');
    expect(hash).toContain('$argon2id$');
    expect(hash).toContain('m=19456,t=2,p=1');
    expect(await hasher.verify(hash, 'una-clave-larga-de-prueba')).toBe(true);
    expect(await hasher.verify(hash, 'otra-clave-distinta')).toBe(false);
  });

  it('un pico rechaza lo que no cabe en la fila, sin perder lo admitido y sin bloquearse', async () => {
    const hasher = new PasswordHasher({ maxConcurrent: 2, maxQueued: 3 });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => hasher.hash('una-clave-larga-de-prueba')));
    const accepted = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(accepted).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    for (const result of rejected) expect(result.reason).toMatchObject({ status: 503, code: 'AUTH_BUSY' });
    expect(await hasher.hash('sigue-funcionando-despues')).toContain('$argon2id$');
  });

  it('un fallo no deja cupos ocupados', async () => {
    const hasher = new PasswordHasher({ maxConcurrent: 1, maxQueued: 1 });
    await expect(hasher.verify('esto-no-es-un-hash', 'x')).rejects.toThrow();
    expect(await hasher.hash('una-clave-larga-de-prueba')).toContain('$argon2id$');
  });
});
