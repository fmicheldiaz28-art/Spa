/**
 * Reglas puras de la lista de espera (Fase 2).
 */

/** Tiempo mínimo entre dos avisos a la misma clienta por la misma entrada. */
export const RENOTIFY_MS = 3 * 3_600_000;

export interface Window {
  /** Minutos del día (hora local); null = sin límite. */
  from: number | null;
  to: number | null;
}

/** Horarios libres que caen dentro de la preferencia de la clienta (inicio dentro de [from, to)). */
export function slotsInWindow<T extends { time: string }>(slots: T[], w: Window): T[] {
  return slots.filter((s) => {
    const [h, m] = s.time.split(':').map(Number) as [number, number];
    const min = h * 60 + m;
    return (w.from === null || min >= w.from) && (w.to === null || min < w.to);
  });
}

/** ¿Corresponde avisar ahora? Solo entradas abiertas y sin aviso reciente. */
export function shouldNotify(entry: { status: string; notifiedAt: Date | null }, now: Date): boolean {
  if (entry.status !== 'ACTIVA' && entry.status !== 'NOTIFICADA') return false;
  return !entry.notifiedAt || now.getTime() - entry.notifiedAt.getTime() >= RENOTIFY_MS;
}

/** Franjas que ofrece la web: mañana, tarde o cualquier hora. */
export const WINDOWS = {
  ANY: { from: null, to: null },
  MORNING: { from: 0, to: 13 * 60 },
  AFTERNOON: { from: 13 * 60, to: 24 * 60 },
} as const satisfies Record<string, Window>;
