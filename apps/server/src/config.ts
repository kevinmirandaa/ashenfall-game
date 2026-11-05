import { randomBytes } from 'node:crypto';

export interface ServerConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly jwtSecret: string;
  readonly allowedOrigins: readonly string[];
  readonly trustProxy: boolean;
  readonly logLevel: string;
  /** Client ID de la identidad administrada; si existe, PostgreSQL se autentica con Entra. */
  readonly managedIdentityClientId: string | undefined;
  readonly rateLimit: { readonly globalPerMinute: number; readonly authPerMinute: number; readonly loginPerAccountPerMinute: number };
}

const MIN_SECRET_LENGTH = 32;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

/**
 * Sin valores por defecto para secretos. Solo con ASHENFALL_DEV_SECRETS=1 (docker compose local) se genera
 * una clave aleatoria al arrancar; así no hay ninguna clave escrita en el repositorio.
 */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const devSecrets = env['ASHENFALL_DEV_SECRETS'] === '1';
  const jwtSecret = devSecrets && env['JWT_SECRET'] === undefined ? randomBytes(32).toString('hex') : required(env, 'JWT_SECRET');
  if (jwtSecret.length < MIN_SECRET_LENGTH) throw new Error(`JWT_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres`);
  return {
    port: Number(env['PORT'] ?? 8080),
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    jwtSecret,
    allowedOrigins: (env['ALLOWED_ORIGINS'] ?? '').split(',').map((origin) => origin.trim()).filter((origin) => origin !== ''),
    trustProxy: env['TRUST_PROXY'] === '1',
    logLevel: env['LOG_LEVEL'] ?? 'info',
    managedIdentityClientId: env['AZURE_CLIENT_ID'],
    rateLimit: {
      globalPerMinute: Number(env['RATE_LIMIT_GLOBAL_PER_MINUTE'] ?? 600),
      authPerMinute: Number(env['RATE_LIMIT_AUTH_PER_MINUTE'] ?? 20),
      loginPerAccountPerMinute: Number(env['RATE_LIMIT_LOGIN_PER_MINUTE'] ?? 10),
    },
  };
}
