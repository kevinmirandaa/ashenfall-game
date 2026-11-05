import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
/** Número arbitrario y fijo: varias réplicas que arrancan a la vez aplican las migraciones de una en una. */
const MIGRATION_LOCK_ID = 727_001;

/** Aplica en orden las migraciones pendientes y devuelve sus nombres. */
export async function migrate(client: pg.ClientBase): Promise<readonly string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const appliedNames = new Set(done.rows.map((row) => row.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    const applied: string[] = [];
    for (const file of files) {
      if (appliedNames.has(file)) continue;
      const sql = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  }
}
