/**
 * Web Push sin dependencias: cifrado del mensaje (RFC 8291, aes128gcm) y firma VAPID (RFC 8292).
 * Funciona con los servicios push de Chrome/Android, Firefox, Edge y Safari (iOS 16.4+ con la PWA instalada).
 */
import { createCipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';

export interface PushSubscriptionKeys {
  endpoint: string;
  /** Clave pública P-256 del navegador (65 bytes, base64url). */
  p256dh: string;
  /** Secreto de autenticación del navegador (16 bytes, base64url). */
  auth: string;
}

const b64u = (buf: Uint8Array) => Buffer.from(buf).toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');
const hmac = (key: Uint8Array, data: Uint8Array) => createHmac('sha256', key).update(data).digest();
const RECORD_SIZE = 4096;

/**
 * Cifra el mensaje para una suscripción (RFC 8291 §3.4). `ephemeral` y `salt` solo se fijan en
 * las pruebas (vector del RFC); en uso normal son aleatorios por mensaje.
 */
export function encryptPayload(payload: Uint8Array, sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>, opts: { ephemeralPrivateKey?: Uint8Array; salt?: Uint8Array } = {}): Buffer {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const ecdh = createECDH('prime256v1');
  if (opts.ephemeralPrivateKey) ecdh.setPrivateKey(opts.ephemeralPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  // CEK y NONCE derivados con la sal del mensaje
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  // Un único registro: contenido + delimitador 0x02 (último registro)
  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  if (plaintext.length + 16 > RECORD_SIZE) throw new Error('Mensaje push demasiado largo');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/** Par de claves VAPID nuevo (para configurar el servidor una sola vez). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** Encabezado Authorization VAPID (RFC 8292): JWT ES256 con la audiencia del servicio push. */
export async function vapidAuthorization(endpoint: string, keys: { publicKey: string; privateKey: string }, subject: string, now = Date.now()): Promise<string> {
  const pub = fromB64u(keys.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: keys.privateKey };
  const key = await importJWK(jwk, 'ES256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setAudience(new URL(endpoint).origin)
    .setSubject(subject)
    .setExpirationTime(Math.floor(now / 1000) + 12 * 3600)
    .sign(key);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}
