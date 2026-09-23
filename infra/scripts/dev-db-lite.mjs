// PostgreSQL en WebAssembly (PGlite) para desarrollo, sin Docker ni binarios nativos.
// Uso: pnpm db:start:lite  (Ctrl+C para detener). Datos en .data/pglite.
// Limitación: todas las conexiones comparten una única sesión de PGlite (las consultas se
// encolan). Por eso el API usa DATABASE_POOL_MAX=1: sus transacciones no se mezclan con otras.
// Las conexiones extra son para herramientas de consulta. Para una experiencia idéntica a
// producción, prefiere `pnpm db:start` o Docker.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dataDir = fileURLToPath(new URL('../../.data/pglite', import.meta.url));
mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.PGPORT ?? 5432);

const db = await PGlite.create({ dataDir, extensions: { btree_gist, citext, pg_trgm, pgcrypto } });
// PGlite ignora `ALTER DATABASE … SET timezone` y el parámetro `options` de las conexiones;
// como todas comparten esta sesión, se fija UTC aquí (ver apps/api/src/infrastructure/prisma/create-adapter.ts).
await db.exec("SET TIME ZONE 'UTC'");
const server = new PGLiteSocketServer({
  db,
  port,
  host: '127.0.0.1',
  maxConnections: 4,
  idleTimeout: 60_000, // libera conexiones de procesos que terminaron sin cerrar
});
await server.start();

console.log(`PGlite listo en postgresql://postgres:postgres@localhost:${port}/postgres`);
console.log('Ctrl+C para detener.');

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
