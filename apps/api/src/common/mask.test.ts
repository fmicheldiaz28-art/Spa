import { describe, expect, it } from 'vitest';
import { lastNameInitial, maskEmail, maskPhone } from './mask.js';
import { phoneSchema, timeSchema } from './validation.js';

describe('enmascaramiento', () => {
  it('oculta el teléfono salvo prefijo, primer y últimos dígitos', () => {
    expect(maskPhone('+59170012345')).toBe('+591 7•••••45');
    expect(maskPhone(null)).toBeNull();
  });

  it('oculta el usuario del email', () => {
    expect(maskEmail('maria.rojas@gmail.com')).toBe('m••••@gmail.com');
  });

  it('reduce el apellido a su inicial', () => {
    expect(lastNameInitial('rojas')).toBe('R.');
    expect(lastNameInitial('')).toBe('');
  });

  it('nunca expone el número completo', () => {
    for (const phone of ['+59170012345', '+5491123456789', '+59160000001']) {
      const masked = maskPhone(phone)!;
      expect(masked.replace(/\D/g, '').length).toBeLessThan(phone.replace(/\D/g, '').length - 3);
    }
  });
});

describe('validaciones', () => {
  it('normaliza teléfonos bolivianos a E.164', () => {
    expect(phoneSchema.parse('700 12345')).toBe('+59170012345');
    expect(phoneSchema.parse('+54 11 2345-6789')).toBe('+541123456789');
    expect(phoneSchema.safeParse('abc').success).toBe(false);
  });

  it('convierte HH:MM a minutos', () => {
    expect(timeSchema.parse('09:30')).toBe(570);
    expect(timeSchema.safeParse('25:00').success).toBe(false);
  });
});
