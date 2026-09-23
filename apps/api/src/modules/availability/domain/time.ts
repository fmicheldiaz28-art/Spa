/**
 * Utilidades de fecha y hora local de la sede (RNF-LOC-01). Bolivia no tiene horario de verano,
 * pero el cálculo es general (soporta DST) para el futuro SaaS en otros países.
 */

export interface Interval {
  /** Minutos desde la medianoche local (pueden ser negativos o > 1440 al recortar rangos). */
  start: number;
  end: number;
}

/** Desplazamiento (ms) de la zona `timeZone` respecto de UTC en el instante `utcMs`. */
export function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Fecha local "YYYY-MM-DD" + minutos del día → instante UTC. */
export function localToUtc(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - tzOffsetMs(guess, timeZone);
  // Segunda pasada: corrige si el cambio de horario cae entre la estimación y el resultado.
  return new Date(guess - tzOffsetMs(first, timeZone));
}

/** Instante UTC → minutos respecto de la medianoche local de `date` (puede salir del rango 0–1440). */
export function utcToLocalMinutes(instant: Date, date: string, timeZone: string): number {
  return Math.round((instant.getTime() - localToUtc(date, 0, timeZone).getTime()) / 60_000);
}

/** Fecha local "YYYY-MM-DD" de un instante. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Día ISO de la semana (1 = lunes … 7 = domingo) de una fecha "YYYY-MM-DD". */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Columna `time` de Prisma (fecha 1970-01-01 UTC) → minutos del día. */
export function timeColumnToMinutes(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

export function minutesToTimeColumn(minutes: number): Date {
  return new Date(Date.UTC(1970, 0, 1, 0, minutes));
}

export function minutesToHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Álgebra de intervalos [start, end)
// ---------------------------------------------------------------------------

export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out.at(-1);
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of normalize(a)) {
    for (const y of normalize(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalize(out);
}

export function subtract(base: Interval[], remove: Interval[]): Interval[] {
  let result = normalize(base);
  for (const r of normalize(remove)) {
    result = result.flatMap((i) => {
      if (r.end <= i.start || r.start >= i.end) return [i];
      const parts: Interval[] = [];
      if (r.start > i.start) parts.push({ start: i.start, end: r.start });
      if (r.end < i.end) parts.push({ start: r.end, end: i.end });
      return parts;
    });
  }
  return result;
}

export function overlaps(a: Interval, list: Interval[]): boolean {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

export function contains(list: Interval[], a: Interval): boolean {
  return list.some((b) => b.start <= a.start && a.end <= b.end);
}

export function totalMinutes(list: Interval[]): number {
  return normalize(list).reduce((sum, i) => sum + (i.end - i.start), 0);
}
