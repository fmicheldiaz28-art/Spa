import { describe, expect, it } from 'vitest';
import { changedFields, diff, redact } from './audit-diff.js';

describe('redact', () => {
  it('oculta hashes y contraseñas', () => {
    expect(redact({ email: 'a@b.c', passwordHash: '$argon2id$…', temporaryPassword: 'X1*' })).toEqual({
      email: 'a@b.c',
      passwordHash: '[REDACTED]',
      temporaryPassword: '[REDACTED]',
    });
  });

  it('serializa fechas a ISO', () => {
    expect(redact({ at: new Date('2026-10-14T19:00:00Z') })).toEqual({ at: '2026-10-14T19:00:00.000Z' });
  });

  it('devuelve null sin valores', () => {
    expect(redact(undefined)).toBeNull();
  });
});

describe('diff', () => {
  it('conserva solo los campos que cambiaron', () => {
    expect(diff({ firstName: 'Ana', lastName: 'Rojas', role: 'EMPLEADA' }, { firstName: 'Ana', lastName: 'Rojas', role: 'ADMIN' })).toEqual({
      oldValues: { role: 'EMPLEADA' },
      newValues: { role: 'ADMIN' },
    });
  });

  it('devuelve null si no hubo cambios', () => {
    expect(diff({ a: 1 }, { a: 1 })).toBeNull();
  });

  it('detecta campos agregados y quitados', () => {
    expect(changedFields({ a: 1 }, { b: 2 }).sort()).toEqual(['a', 'b']);
  });
});
