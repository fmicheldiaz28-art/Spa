import { describe, expect, it } from 'vitest';
import { waLink } from './whatsapp.js';

describe('waLink', () => {
  it('usa solo los dígitos del teléfono y codifica el texto', () => {
    const url = waLink('+591 70-000-123', 'Hola & chau\n¿ok?');
    expect(url).toBe('https://wa.me/59170000123?text=Hola%20%26%20chau%0A%C2%BFok%3F');
  });
});
