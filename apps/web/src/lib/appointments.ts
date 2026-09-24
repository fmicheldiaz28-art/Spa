import type { AppointmentStatus } from '@naturalspa/shared';
import type { BadgeTone } from '@/components/ui';

export type Action = 'confirm' | 'check-in' | 'complete' | 'no-show' | 'cancel';

export interface AppointmentItem {
  id: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  staff: { id: string; displayName: string; color: string };
  startAt: string;
  endAt: string;
  price?: string;
}

export interface Appointment {
  id: string;
  code: string;
  status: AppointmentStatus;
  source: 'ADMIN' | 'ONLINE' | 'WHATSAPP' | 'TELEFONO' | 'WALK_IN';
  startAt: string;
  endAt: string;
  client: { id: string; name: string; allergies: string | null; contraindications: string | null; preferences: string | null };
  items: AppointmentItem[];
  total?: string;
  internalNotes?: string | null;
  clientNotes: string | null;
  isOverbooking: boolean;
  overbookingReason?: string | null;
  cancelReason: string | null;
  cancelledByType: 'CLIENTE' | 'SPA' | 'SISTEMA' | null;
  rescheduleCount: number;
  clientConfirmedAt: string | null;
  actions: Action[];
  version: number;
  deleted: boolean;
}

export interface CalendarData {
  timezone: string;
  from: string;
  to: string;
  staff: { id: string; displayName: string; color: string }[];
  availability: Record<string, Record<string, { workable: { start: string; end: string }[]; absences: { start: string; end: string }[] }>>;
  appointments: Appointment[];
}

export interface Slot {
  time: string;
  startAt: string;
  endAt: string;
  staff: { id: string; name: string; color: string }[];
}

export const STATUS: Record<AppointmentStatus, { label: string; tone: BadgeTone; icon: string }> = {
  PENDIENTE: { label: 'Pendiente', tone: 'warning', icon: '⏳' },
  CONFIRMADA: { label: 'Confirmada', tone: 'primary', icon: '◷' },
  EN_CURSO: { label: 'En curso', tone: 'info', icon: '▶' },
  COMPLETADA: { label: 'Completada', tone: 'success', icon: '✓' },
  CANCELADA: { label: 'Cancelada', tone: 'neutral', icon: '⊘' },
  NO_SHOW: { label: 'No asistió', tone: 'danger', icon: '✗' },
};

export const SOURCE_LABELS: Record<Appointment['source'], string> = {
  ADMIN: 'Administración',
  ONLINE: 'Reserva online',
  WHATSAPP: 'WhatsApp',
  TELEFONO: 'Teléfono',
  WALK_IN: 'Presencial',
};

export const ACTION_LABELS: Record<Action, string> = {
  confirm: 'Confirmar',
  'check-in': 'Iniciar',
  complete: 'Finalizar',
  'no-show': 'No asistió',
  cancel: 'Cancelar cita',
};

export const CANCEL_REASONS = ['Clienta canceló', 'Clienta no puede asistir', 'Enfermedad de la especialista', 'Error de agenda'];

const TZ = 'America/La_Paz';
const TZ_OFFSET = '-04:00'; // Bolivia: UTC−4 todo el año

/** Minutos desde la medianoche local de un instante ISO. */
export function localMinutes(iso: string): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso)).split(':').map(Number);
  return h! * 60 + m!;
}

export const localDateOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Fecha local + "HH:MM" → ISO con desplazamiento de Bolivia. */
export const toInstant = (date: string, hhmm: string) => `${date}T${hhmm}:00${TZ_OFFSET}`;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha (la semana del spa se muestra de martes a lunes, pero el cálculo parte del lunes). */
export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - day);
}

export const timeOf = (iso: string) => toHHMM(localMinutes(iso));

const longDay = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export const formatLongDay = (date: string) => longDay.format(new Date(`${date}T12:00:00Z`));

/** Texto de error legible desde un Problem Details, con sugerencias de horario si las hay. */
export function problemSuggestions(errors?: { field: string; message: string }[]): { startAt: string; time: string; staff: { id: string; name: string }[] }[] {
  const raw = errors?.find((e) => e.field === 'suggestions')?.message;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
