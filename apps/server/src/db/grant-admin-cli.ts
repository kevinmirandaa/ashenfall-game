import pg from 'pg';

// Ninguna ruta de la API concede el rol: se otorga solo con acceso directo a la base de datos.
const connectionString = process.env['DATABASE_URL'];
const email = process.argv[2];
if (connectionString === undefined || email === undefined) {
  throw new Error('Uso: DATABASE_URL=... node dist/db/grant-admin-cli.js <correo>');
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const { rowCount } = await client.query(`UPDATE users SET role = 'admin' WHERE lower(email) = lower($1)`, [email]);
  console.log(rowCount === 1 ? 'Rol de administrador concedido' : 'No existe ese usuario');
  if (rowCount !== 1) process.exitCode = 1;
} finally {
  await client.end();
}
