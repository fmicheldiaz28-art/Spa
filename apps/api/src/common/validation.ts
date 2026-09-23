import { z } from 'zod';

/** Teléfono en E.164; sin prefijo se asume Bolivia (+591) (RNF-LOC-04). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, 'Teléfono inválido'))
  .transform((v) => (v.startsWith('+') ? v : `+591${v}`));

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Email inválido'));

export const nameSchema = z.string().trim().min(2, 'Mínimo 2 caracteres').max(60);

/** Hora local "HH:MM" → minutos desde medianoche. */
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')
  .transform((v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)));

/** Fecha local "YYYY-MM-DD". */
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

export const moneySchema = z.coerce.number().min(0).max(100_000).multipleOf(0.01);

export const reasonSchema = z.string().trim().min(3, 'Indica el motivo').max(300);
