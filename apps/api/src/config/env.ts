import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(8),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('NaturalSpa <no-responder@naturalspa.bo>'),
  // Cada cuánto revisa y envía recordatorios; 0 los apaga en esta instancia.
  REMINDERS_INTERVAL_SEC: z.coerce.number().int().min(0).default(60),
  // Clave AES-256 (32 bytes en base64) para cifrar los secretos MFA. Sin ella se deriva de JWT_SECRET.
  MFA_ENCRYPTION_KEY: z.string().optional(),
  // Sellado de la auditoría con hash encadenado; 0 lo apaga en esta instancia.
  AUDIT_SEAL_INTERVAL_SEC: z.coerce.number().int().min(0).default(60),
  // Reporte semanal por email a administración (los lunes). 'false' lo apaga en esta instancia.
  WEEKLY_REPORT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

export const env = schema.parse(process.env);
export const isProduction = env.NODE_ENV === 'production';

/** Política de bloqueo por intentos fallidos (docs/04-base-de-datos.md §9.7 security). */
export const LOGIN_POLICY = {
  maxFailedLogins: 5,
  lockoutMinutes: 15,
} as const;
