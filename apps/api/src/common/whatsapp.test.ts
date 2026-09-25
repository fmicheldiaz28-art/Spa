import { describe, expect, it } from 'vitest';
import { reminderText, waitlistText, waLink } from './whatsapp.js';

describe('waLink', () => {
  it('usa solo los dígitos del teléfono y codifica el texto', () => {
    const url = waLink('+591 70-000-123', 'Hola & chau\n¿ok?');
    expect(url).toBe('https://wa.me/59170000123?text=Hola%20%26%20chau%0A%C2%BFok%3F');
  });
});

describe('textos', () => {
  it('recordatorio con enlace de gestión', () => {
    const t = reminderText({ firstName: 'Camila', when: 'mañana a las 15:00', services: 'Masaje relajante con Andrea', orgName: 'NaturalSpa', manageUrl: 'https://x/y' });
    expect(t).toContain('Te recordamos tu cita en NaturalSpa mañana a las 15:00: Masaje relajante con Andrea.');
    expect(t).toContain('https://x/y');
  });

  it('lista de espera con horarios (máximo 5)', () => {
    const t = waitlistText({ firstName: 'Laura', day: 'martes 29 de septiembre', service: 'Manicure', times: ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00'], orgName: 'NaturalSpa', bookUrl: 'https://r' });
    expect(t).toContain('(09:00, 10:00, 11:00, 12:00, 14:00)');
    expect(t).not.toContain('15:00');
  });
});
