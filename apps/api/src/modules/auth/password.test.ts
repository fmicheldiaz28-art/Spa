import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword, hashPassword, passwordPolicyViolations, verifyPassword } from './password.js';

describe('contraseña temporal', () => {
  it('siempre cumple la política y varía entre llamadas', () => {
    const generated = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pwd = generateTemporaryPassword();
      expect(pwd).toHaveLength(12);
      expect(passwordPolicyViolations(pwd)).toEqual([]);
      generated.add(pwd);
    }
    expect(generated.size).toBe(200);
  });
});

describe('política de contraseñas', () => {
  it('acepta la contraseña del usuario de pruebas', () => {
    expect(passwordPolicyViolations('Admin123*')).toEqual([]);
  });

  it.each([
    ['corta', 'Ab1*'],
    ['sin mayúscula', 'admin123*'],
    ['sin minúscula', 'ADMIN123*'],
    ['sin número', 'Adminabc*'],
    ['sin símbolo', 'Admin1234'],
  ])('rechaza una contraseña %s', (_, password) => {
    expect(passwordPolicyViolations(password).length).toBeGreaterThan(0);
  });
});

describe('hash Argon2id', () => {
  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('Admin123*');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Admin123*')).toBe(true);
    expect(await verifyPassword(hash, 'admin123*')).toBe(false);
  });

  it('no lanza con un hash corrupto', async () => {
    expect(await verifyPassword('no-es-un-hash', 'Admin123*')).toBe(false);
  });
});
