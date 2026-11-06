import { ManagedIdentityCredential } from '@azure/identity';
import pg from 'pg';

const POSTGRES_TOKEN_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

export interface TokenSource {
  getToken(scope: string): Promise<{ readonly token: string } | null>;
}

/** Solo datos de identificación del token, nunca el token: sirven para diagnosticar un rechazo de PostgreSQL. */
export interface TokenClaims {
  readonly aud?: unknown;
  readonly tid?: unknown;
  readonly oid?: unknown;
  readonly appid?: unknown;
}

export function tokenClaims(token: string): TokenClaims {
  try {
    const { aud, tid, oid, appid } = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as TokenClaims;
    return { aud, tid, oid, appid };
  } catch {
    return {};
  }
}

export interface PoolOptions {
  readonly connectionString: string;
  /** Con identidad administrada no hay contraseña: cada conexión nueva pide un token de Entra. */
  readonly managedIdentityClientId?: string | undefined;
  readonly tokenSource?: TokenSource;
  readonly max?: number;
  readonly onToken?: (claims: TokenClaims) => void;
}

export function createPool(options: PoolOptions): pg.Pool {
  const { connectionString, managedIdentityClientId, tokenSource } = options;
  const base = { connectionString, max: options.max ?? 20 };
  if (managedIdentityClientId === undefined && tokenSource === undefined) return new pg.Pool(base);

  const credential = tokenSource ?? new ManagedIdentityCredential({ clientId: managedIdentityClientId ?? '' });
  // Sin connectionString: pg la procesaría después y sobrescribiría con vacío la función de contraseña.
  const url = new URL(connectionString);
  return new pg.Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    max: base.max,
    ssl: { rejectUnauthorized: true },
    password: async () => {
      const token = await credential.getToken(POSTGRES_TOKEN_SCOPE);
      if (token === null) throw new Error('No se obtuvo un token para PostgreSQL');
      options.onToken?.(tokenClaims(token.token));
      return token.token;
    },
  });
}
