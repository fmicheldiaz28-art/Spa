export const WEEKDAYS = [
  { n: 2, label: 'Martes' },
  { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' },
  { n: 5, label: 'Viernes' },
  { n: 6, label: 'Sábado' },
  { n: 7, label: 'Domingo' },
  { n: 1, label: 'Lunes' },
] as const;

export const WEEKDAY_NAME: Record<number, string> = Object.fromEntries(WEEKDAYS.map((w) => [w.n, w.label]));

export interface Block {
  weekday: number;
  start: string;
  end: string;
}

export interface ScheduleException {
  id: string;
  staff: { id: string; displayName: string; color: string | null } | null;
  type: 'VACACIONES' | 'PERMISO' | 'BLOQUEO' | 'EXTRA';
  status: 'SOLICITADA' | 'APROBADA' | 'RECHAZADA' | 'CANCELADA';
  startAt: string;
  endAt: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  reason: string | null;
  rejectionReason: string | null;
}

export interface AffectedAppointment {
  appointmentId: string;
  code: string;
  client: string;
  staff: string;
  service: string;
  startAt: string;
}

export const EXCEPTION_LABELS: Record<ScheduleException['type'], string> = {
  VACACIONES: 'Vacaciones',
  PERMISO: 'Permiso',
  BLOQUEO: 'Bloqueo',
  EXTRA: 'Disponibilidad extra',
};

export const EXCEPTION_STATUS: Record<ScheduleException['status'], { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  SOLICITADA: { label: 'Pendiente', tone: 'warning' },
  APROBADA: { label: 'Aprobada', tone: 'success' },
  RECHAZADA: { label: 'Rechazada', tone: 'danger' },
  CANCELADA: { label: 'Retirada', tone: 'neutral' },
};

/** "YYYY-MM-DD" de hoy en Bolivia. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());
}

const dayFmt = new Intl.DateTimeFormat('es-BO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const formatDay = (date: string) => dayFmt.format(new Date(`${date}T12:00:00Z`));

const timeFmt = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

export function describeException(e: ScheduleException): string {
  const range = e.startDate === e.endDate ? formatDay(e.startDate) : `${formatDay(e.startDate)} – ${formatDay(e.endDate)}`;
  return e.allDay ? range : `${range} · ${formatTime(e.startAt)}–${formatTime(e.endAt)}`;
}
