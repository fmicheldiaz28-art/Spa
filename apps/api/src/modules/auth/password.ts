import { randomBytes, randomInt } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Argon2id (docs/11-seguridad-auditoria.md §19.2): m = 64 MiB, t = 3, p = 1.
 * Implementación en WebAssembly: sin binarios nativos, idéntica en Windows, Linux y CI.
 */
const ARGON2_PARAMS = { memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32 };

export function hashPassword(password: string): Promise<string> {
  return argon2id({ ...ARGON2_PARAMS, password, salt: randomBytes(16), outputType: 'encoded' });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: passwordHash });
  } catch {
    return false;
  }
}

/** Hash ficticio para igualar el tiempo de respuesta cuando el email no existe. */
let dummyHash: Promise<string> | undefined;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash.then((h) => verifyPassword(h, password));
}

/**
 * Contraseña temporal de 12 caracteres que cumple la política; se muestra una sola vez al
 * administrador y obliga a cambiarla en el primer ingreso. Sin caracteres ambiguos (0/O, 1/l/I).
 */
export function generateTemporaryPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '*#$%&!?'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]!);
  while (chars.length < 12) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/**
 * Política de contraseñas (RNF-SEG-02): ≥ 8 caracteres con mayúscula, minúscula, número y símbolo.
 * Devuelve la lista de reglas incumplidas (vacía = válida).
 */
export function passwordPolicyViolations(password: string): string[] {
  const violations: string[] = [];
  if (password.length < 8) violations.push('Debe tener al menos 8 caracteres');
  if (password.length > 128) violations.push('Debe tener como máximo 128 caracteres');
  if (!/[A-Z]/.test(password)) violations.push('Debe incluir una letra mayúscula');
  if (!/[a-z]/.test(password)) violations.push('Debe incluir una letra minúscula');
  if (!/\d/.test(password)) violations.push('Debe incluir un número');
  if (!/[^A-Za-z0-9]/.test(password)) violations.push('Debe incluir un símbolo');
  return violations;
}
