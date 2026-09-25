/**
 * TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 dígitos): compatible con Google Authenticator, Microsoft
 * Authenticator, 1Password, etc. Implementado con node:crypto, sin dependencias.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SEC = 30;
const DIGITS = 6;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secreto nuevo de 160 bits (el tamaño recomendado para HMAC-SHA1). */
export function generateSecret(): Buffer {
  return randomBytes(20);
}

export function stepAt(unixMs: number): number {
  return Math.floor(unixMs / 1000 / TOTP_PERIOD_SEC);
}

export function hotp(secret: Uint8Array, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Verifica un código aceptando ±`window` pasos de desfase de reloj. Devuelve el paso usado, o null.
 * `lastStep` evita reutilizar un código ya aceptado (repetición).
 */
export function verifyTotp(secret: Uint8Array, code: string, unixMs: number, lastStep: number | null = null, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(unixMs);
  for (let delta = -window; delta <= window; delta++) {
    const step = now + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(secret: Uint8Array, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_PERIOD_SEC) });
  return `otpauth://totp/${label}?${params}`;
}

/** Códigos de recuperación de un solo uso, legibles: "k7m2-p9xq". */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin 0/o/1/l/i
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
}
