// En desarrollo, espera a que tsc genere dist/main.js antes de arrancar el API.
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

while (!existsSync(new URL('../dist/main.js', import.meta.url))) {
  await sleep(300);
}
await import('../dist/main.js');
