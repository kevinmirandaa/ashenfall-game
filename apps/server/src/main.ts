import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';

const config = loadConfig(process.env);
const pool = createPool({
  connectionString: config.databaseUrl, managedIdentityClientId: config.managedIdentityClientId,
  onToken: (claims) => {
    console.log(JSON.stringify({ msg: 'Token de PostgreSQL obtenido', ...claims }));
  },
});
const redis = new Redis(config.redisUrl);

const app = buildApp({
  pool,
  logger: { level: config.logLevel },
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
  auth: { jwtSecret: config.jwtSecret, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 30 * 24 * 3600 },
  rateLimit: { ...config.rateLimit, redis },
  realtime: { redis, gateway: { allowedOrigins: config.allowedOrigins } },
  health: { redis },
});

redis.on('error', (error: unknown) => {
  app.log.error({ err: error }, 'Error de conexión con Redis');
});
pool.on('error', (error: unknown) => {
  app.log.error({ err: error }, 'Error en una conexión inactiva de PostgreSQL');
});

const client = await pool.connect().catch((error: unknown) => {
  // Mensaje en una sola línea: el visor de registros de Azure corta los errores largos.
  const detail = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ msg: 'No se pudo conectar a PostgreSQL', detail }));
  throw error;
});
try {
  const applied = await migrate(client);
  app.log.info({ applied }, 'Migraciones comprobadas');
} finally {
  client.release();
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Apagando con cierre ordenado');
  await app.close();
  await pool.end();
  redis.disconnect();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: '0.0.0.0' });
