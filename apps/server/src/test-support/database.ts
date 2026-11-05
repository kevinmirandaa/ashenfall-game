import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../db/migrate.js';

const ADMIN_URL = process.env['DATABASE_URL'] ?? 'postgres://ashenfall@127.0.0.1:5432/ashenfall';

export interface TestDatabase {
  readonly pool: pg.Pool;
  destroy(): Promise<void>;
}

/** Crea un esquema propio y migrado, para que los archivos de prueba corran en paralelo sin interferir. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: ADMIN_URL, options: `-c search_path=${schema}`, max: 20 });
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
  return {
    pool,
    destroy: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}

export async function insertUser(pool: pg.Pool): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)', [
    id,
    `${id}@test.invalid`,
    `jugador-${id.slice(0, 6)}`,
    'hash-de-prueba',
  ]);
  return id;
}
