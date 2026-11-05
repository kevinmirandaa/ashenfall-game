import { ManagedIdentityCredential } from '@azure/identity';
import pg from 'pg';

const POSTGRES_TOKEN_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

export interface TokenSource {
  getToken(scope: string): Promise<{ readonly token: string } | null>;
}

export interface PoolOptions {
  readonly connectionString: string;
  /** Con identidad administrada no hay contraseña: cada conexión nueva pide un token de Entra. */
  readonly managedIdentityClientId?: string | undefined;
  readonly tokenSource?: TokenSource;
  readonly max?: number;
}

export function createPool(options: PoolOptions): pg.Pool {
  const { connectionString, managedIdentityClientId, tokenSource } = options;
  const base = { connectionString, max: options.max ?? 20 };
  if (managedIdentityClientId === undefined && tokenSource === undefined) return new pg.Pool(base);

  const credential = tokenSource ?? new ManagedIdentityCredential({ clientId: managedIdentityClientId ?? '' });
  return new pg.Pool({
    ...base,
    ssl: { rejectUnauthorized: true },
    password: async () => {
      const token = await credential.getToken(POSTGRES_TOKEN_SCOPE);
      if (token === null) throw new Error('No se obtuvo un token para PostgreSQL');
      return token.token;
    },
  });
}
