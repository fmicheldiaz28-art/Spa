// Genera el par de claves VAPID para las notificaciones push (una sola vez por entorno).
// Uso: pnpm --filter @naturalspa/api push:keys  → copiar las dos líneas al .env del API.
// Cambiar las claves invalida las suscripciones existentes (cada dispositivo debe volver a activarlas).
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${ecdh.getPrivateKey().toString('base64url')}`);
