import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Adaptador de Prisma con las sesiones en UTC.
 *
 * El adaptador envía y lee `timestamptz` sin desplazamiento horario: si la sesión de PostgreSQL
 * no está en UTC (ej. servidor en America/La_Paz), las fechas se guardan corridas. Por eso:
 *  - cada conexión pide `TimeZone=UTC` en el arranque (parámetro `options`), y
 *  - la migración 20260922010000 fija UTC como zona por defecto de la base (cubre servidores
 *    que ignoran `options`, como PGlite).
 * La presentación en hora local se hace siempre en la aplicación (RNF-LOC-01).
 */
export function createPrismaAdapter(connectionString: string, max: number): PrismaPg {
  return new PrismaPg({ connectionString, max, options: '-c TimeZone=UTC' });
}
