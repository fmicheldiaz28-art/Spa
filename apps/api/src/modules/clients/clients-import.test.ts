import { describe, expect, it } from 'vitest';
import { validateImport } from './clients-import.js';

describe('validateImport', () => {
  it('normaliza teléfonos y separa nombre completo', () => {
    const r = validateImport([{ firstName: 'María José Rojas', phone: '700 123 45', email: 'MJ@Gmail.com ' }]);
    expect(r.valid[0]).toMatchObject({ firstName: 'María', lastName: 'José Rojas', phoneE164: '+59170012345', email: 'mj@gmail.com', line: 2 });
  });

  it('reporta errores con el número de fila', () => {
    const r = validateImport([{ firstName: '' }, { firstName: 'Ana', phone: 'abc' }, { firstName: 'Luz', email: 'no-es-email' }]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.valid).toHaveLength(0);
  });

  it('detecta duplicadas dentro del archivo por teléfono o email', () => {
    const r = validateImport([
      { firstName: 'Ana', phone: '70000001' },
      { firstName: 'Ana B', phone: '+59170000001' },
      { firstName: 'Carla', email: 'c@x.com' },
      { firstName: 'Carla M', email: 'C@X.COM' },
    ]);
    expect(r.valid.map((v) => v.firstName)).toEqual(['Ana', 'Carla']);
    expect(r.duplicatesInFile.map((d) => d.problem)).toEqual(['Repetida con la fila 2', 'Repetida con la fila 4']);
  });

  it('acepta clientas sin contacto (se registran igual)', () => {
    expect(validateImport([{ firstName: 'Sin Contacto' }]).valid).toHaveLength(1);
  });
});

describe('filas sin contacto', () => {
  it('detecta repetidas por nombre completo, sin importar tildes ni mayúsculas', () => {
    const r = validateImport([{ firstName: 'Gabriela Paz' }, { firstName: 'gabriela', lastName: 'paz' }, { firstName: 'Gabriela Páz' }]);
    expect(r.valid).toHaveLength(1);
    expect(r.duplicatesInFile).toHaveLength(2);
  });
});
