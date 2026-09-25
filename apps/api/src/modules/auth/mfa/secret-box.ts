/**
 * Cifrado de secretos en la base de datos (secretos MFA): AES-256-GCM a nivel de aplicación
 * (docs/11-seguridad-auditoria.md §45). Formato: versión (1) ‖ IV (12) ‖ tag (16) ‖ texto cifrado.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 1;

/** Clave de 32 bytes: MFA_ENCRYPTION_KEY (base64) o, si falta, derivada del JWT_SECRET con HKDF. */
export function deriveKey(explicitBase64: string | undefined, fallbackSecret: string): Buffer {
  if (explicitBase64) {
    const key = Buffer.from(explicitBase64, 'base64');
    if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY debe ser de 32 bytes en base64');
    return key;
  }
  return Buffer.from(hkdfSync('sha256', fallbackSecret, 'naturalspa', 'mfa-secret-box', 32));
}

export function seal(key: Buffer, plaintext: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function open(key: Buffer, box: Uint8Array): Buffer {
  const buf = Buffer.from(box);
  if (buf[0] !== VERSION) throw new Error('Formato de secreto desconocido');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]);
}
