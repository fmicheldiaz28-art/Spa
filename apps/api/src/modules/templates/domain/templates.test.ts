import { describe, expect, it } from 'vitest';
import { render, SAMPLE_VARS, TEMPLATE_CODES, TEMPLATES, validate } from './templates.js';

describe('render', () => {
  it('reemplaza variables sin importar mayúsculas', () => {
    expect(render('Hola {nombre}, te esperamos {Cuando}.', { nombre: 'Ana', cuando: 'hoy' })).toBe('Hola Ana, te esperamos hoy.');
  });

  it('una variable sin valor queda vacía y no deja líneas en blanco dobles', () => {
    expect(render('A\n\nDirección: {direccion}\n\n\nB', { direccion: null })).toBe('A\n\nDirección:\n\nB');
  });

  it('las plantillas predeterminadas no dejan variables sin reemplazar', () => {
    for (const code of TEMPLATE_CODES) {
      const t = TEMPLATES[code];
      expect(render(`${t.subject ?? ''}\n${t.body}`, SAMPLE_VARS)).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('validate', () => {
  it('las predeterminadas son válidas', () => {
    for (const code of TEMPLATE_CODES) expect(validate(code, TEMPLATES[code].subject, TEMPLATES[code].body)).toEqual([]);
  });

  it('detecta variables desconocidas y la falta del enlace', () => {
    expect(validate('REMINDER_WHATSAPP', null, 'Hola {nombre}, {precio}')).toEqual(['La variable {precio} no existe en este mensaje', 'El mensaje debe incluir {enlace}']);
  });

  it('{horarios} solo existe en los mensajes de lista de espera', () => {
    expect(validate('REMINDER_EMAIL', 'Asunto', 'Hola {horarios} {enlace}')).toEqual(['La variable {horarios} no existe en este mensaje']);
  });

  it('el email necesita asunto', () => {
    expect(validate('WAITLIST_EMAIL', '  ', '{enlace}')).toContain('El asunto no puede estar vacío');
  });
});
