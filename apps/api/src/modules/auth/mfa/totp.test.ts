import { describe, expect, it } from 'vitest';
import { deriveKey, open, seal } from './secret-box.js';
import { base32Decode, base32Encode, generateRecoveryCodes, hotp, normalizeRecoveryCode, otpauthUri, stepAt, verifyTotp } from './totp.js';

// Vectores del RFC 6238 (SHA-1): secreto ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('t=%i → %s', (t, code) => {
    expect(hotp(RFC_SECRET, stepAt(t * 1000), 8)).toBe(code);
  });

  it('acepta ±1 paso de desfase y rechaza más', () => {
    const t = 1_700_000_000_000;
    const code = hotp(RFC_SECRET, stepAt(t));
    expect(verifyTotp(RFC_SECRET, code, t + 30_000)).toBe(stepAt(t));
    expect(verifyTotp(RFC_SECRET, code, t + 90_000)).toBeNull();
  });

  it('no acepta un código ya usado (repetición)', () => {
    const t = 1_700_000_000_000;
    const code = hotp(RFC_SECRET, stepAt(t));
    const step = verifyTotp(RFC_SECRET, code, t)!;
    expect(verifyTotp(RFC_SECRET, code, t, step)).toBeNull();
  });

  it('rechaza formatos inválidos', () => {
    expect(verifyTotp(RFC_SECRET, '12345', Date.now())).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', Date.now())).toBeNull();
  });
});

describe('base32 y otpauth', () => {
  it('ida y vuelta', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
  });

  it('URI para la app de autenticación', () => {
    const uri = otpauthUri(RFC_SECRET, 'natalia@naturalspa.bo', 'NaturalSpa');
    expect(uri).toMatch(/^otpauth:\/\/totp\/NaturalSpa%3Anatalia%40naturalspa\.bo\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=NaturalSpa/);
  });
});

describe('códigos de recuperación', () => {
  it('8 códigos distintos y normalización tolerante', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalizeRecoveryCode(' K7M2 P9XQ ')).toBe('k7m2-p9xq');
  });
});

describe('secret-box (AES-256-GCM)', () => {
  const key = deriveKey(undefined, 'x'.repeat(40));

  it('cifra y descifra', () => {
    const box = seal(key, RFC_SECRET);
    expect(open(key, box).equals(RFC_SECRET)).toBe(true);
  });

  it('detecta manipulación', () => {
    const box = seal(key, RFC_SECRET);
    box[box.length - 1]! ^= 1;
    expect(() => open(key, box)).toThrow();
  });

  it('valida la clave explícita', () => {
    expect(() => deriveKey(Buffer.alloc(16).toString('base64'), 'x')).toThrow();
  });
});
