import { Redis } from 'ioredis';
import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';

const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
const redis = new Redis(config.redisUrl);

const app = buildApp({
  pool,
  logger: true,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
  auth: { jwtSecret: config.jwtSecret, accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 30 * 24 * 3600 },
  rateLimit: { globalPerMinute: 600, authPerMinute: 20, loginPerAccountPerMinute: 10, redis },
  realtime: { redis, gateway: { allowedOrigins: config.allowedOrigins } },
  health: { redis },
});

redis.on('error', (error: unknown) => {
  app.log.error({ err: error }, 'Error de conexión con Redis');
});
pool.on('error', (error: unknown) => {
  app.log.error({ err: error }, 'Error en una conexión inactiva de PostgreSQL');
});

const client = await pool.connect();
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
