// PostgreSQL local sin Docker (desarrollo). Uso: pnpm db:start  (Ctrl+C para detener)
// Datos persistentes en .data/postgres. Con Docker, usa infra/docker/docker-compose.yml.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = fileURLToPath(new URL('../../.data/postgres', import.meta.url));
const port = Number(process.env.PGPORT ?? 5432);
const fresh = !existsSync(databaseDir);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'naturalspa',
  password: 'naturalspa',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('naturalspa');

console.log(`PostgreSQL listo en postgresql://naturalspa:naturalspa@localhost:${port}/naturalspa`);
console.log('Ctrl+C para detener.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
