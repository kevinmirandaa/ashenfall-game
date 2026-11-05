import pg from 'pg';
import { migrate } from './migrate.js';

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined) throw new Error('Falta DATABASE_URL');

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const applied = await migrate(client);
  console.log(applied.length === 0 ? 'Sin migraciones pendientes' : `Aplicadas: ${applied.join(', ')}`);
} finally {
  await client.end();
}
