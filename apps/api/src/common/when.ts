import { addDays, localDate } from '../modules/availability/domain/time.js';

/** "hoy a las 15:00", "mañana a las 09:30" o "el viernes 25 de septiembre a las 11:00" (hora local). */
export function humanWhen(instant: Date, now: Date, tz: string): string {
  const time = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(instant);
  const day = localDate(instant, tz);
  const today = localDate(now, tz);
  if (day === today) return `hoy a las ${time}`;
  if (day === addDays(today, 1)) return `mañana a las ${time}`;
  const date = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(instant).replace(',', '');
  return `el ${date} a las ${time}`;
}
