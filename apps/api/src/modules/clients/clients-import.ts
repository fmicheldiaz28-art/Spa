import { emailSchema, phoneSchema } from '../../common/validation.js';

export interface ImportRow {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  allergies?: string;
  preferences?: string;
  notes?: string;
}

export interface CleanRow {
  line: number;
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  allergies: string | null;
  preferences: string | null;
  internalNotes: string | null;
}

export interface RowIssue {
  line: number;
  name: string;
  problem: string;
}

const clean = (v?: string) => (v ?? '').trim().replace(/\s+/g, ' ');

/** "María  José" y "maria jose" son la misma persona a efectos de detectar repetidas. */
export const nameKey = (firstName: string, lastName: string) =>
  `${firstName} ${lastName}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Validación de la importación desde Google Sheets (docs/10 §18.4): normaliza teléfonos a E.164,
 * separa "Nombre Apellido" si viene en una sola columna y detecta duplicados dentro del archivo.
 * Función pura: el cruce con la base de datos lo hace el servicio.
 */
export function validateImport(rows: ImportRow[]): { valid: CleanRow[]; errors: RowIssue[]; duplicatesInFile: RowIssue[] } {
  const valid: CleanRow[] = [];
  const errors: RowIssue[] = [];
  const duplicatesInFile: RowIssue[] = [];
  const seen = new Map<string, number>();

  rows.forEach((raw, index) => {
    const line = index + 2; // fila 1 = encabezados
    let firstName = clean(raw.firstName);
    let lastName = clean(raw.lastName);
    if (!lastName && firstName.includes(' ')) {
      const [first, ...rest] = firstName.split(' ');
      firstName = first!;
      lastName = rest.join(' ');
    }
    const name = `${firstName} ${lastName}`.trim() || '(sin nombre)';
    if (firstName.length < 2) return errors.push({ line, name, problem: 'Falta el nombre' });

    let phoneE164: string | null = null;
    if (clean(raw.phone)) {
      const p = phoneSchema.safeParse(clean(raw.phone));
      if (!p.success) return errors.push({ line, name, problem: `Teléfono inválido: ${raw.phone}` });
      phoneE164 = p.data;
    }
    let email: string | null = null;
    if (clean(raw.email)) {
      const e = emailSchema.safeParse(clean(raw.email));
      if (!e.success) return errors.push({ line, name, problem: `Email inválido: ${raw.email}` });
      email = e.data;
    }

    // Sin datos de contacto, el único criterio para detectar repetidas es el nombre completo.
    const keys = (phoneE164 || email ? [phoneE164 && `p:${phoneE164}`, email && `e:${email}`] : [`n:${nameKey(firstName, lastName)}`]).filter(Boolean) as string[];
    const dupOf = keys.map((k) => seen.get(k)).find((l) => l !== undefined);
    if (dupOf !== undefined) return duplicatesInFile.push({ line, name, problem: `Repetida con la fila ${dupOf}` });
    keys.forEach((k) => seen.set(k, line));

    valid.push({
      line,
      firstName,
      lastName,
      phoneE164,
      email,
      allergies: clean(raw.allergies) || null,
      preferences: clean(raw.preferences) || null,
      internalNotes: clean(raw.notes) || null,
    });
  });

  return { valid, errors, duplicatesInFile };
}
