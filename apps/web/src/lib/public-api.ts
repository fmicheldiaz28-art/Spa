import { ApiError, type Problem } from './api';

/** Cliente de la API pública de reservas: sin sesión del personal; token de clienta opcional. */
export async function publicApi<T>(path: string, init: RequestInit & { clientToken?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.clientToken) headers.set('Authorization', `Bearer ${init.clientToken}`);
  const res = await fetch(`/api/v1/public${path}`, { ...init, headers, credentials: 'omit' });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as Problem | null;
    throw new ApiError(problem ?? { status: res.status, code: 'NETWORK_ERROR', title: 'No se pudo conectar con el servidor' });
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  imageUrl: string | null;
  category: { id: string; name: string; color: string | null };
  staff: { id: string; name: string; color: string; photoUrl: string | null }[];
}

export interface PublicInfo {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  policy: { minLeadTimeMin: number; maxAdvanceDays: number; cancelUntilHours: number; rescheduleUntilHours: number; holdMinutes: number };
}

export interface PublicSlot {
  time: string;
  startAt: string;
  staff: { id: string; name: string }[];
}

export interface PublicAppointment {
  id: string;
  code: string;
  status: 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA' | 'NO_SHOW';
  startAt: string;
  endAt: string;
  localDate: string;
  localTime: string;
  service: { id: string; name: string; durationMin: number };
  staff: { id: string; name: string };
  total: string;
  client: { firstName: string; lastName: string; email: string | null };
  canCancel: boolean;
  canReschedule: boolean;
  cancelUntilHours: number;
  rescheduleUntilHours: number;
  manageToken?: string;
}

const CLIENT_TOKEN_KEY = 'ns_client_token';

/** El token de clienta vive en sessionStorage: se borra al cerrar el navegador. */
export const clientSession = {
  get(): string | null {
    try {
      return sessionStorage.getItem(CLIENT_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      sessionStorage.setItem(CLIENT_TOKEN_KEY, token);
    } catch {
      /* sin almacenamiento: la sesión dura lo que la página */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(CLIENT_TOKEN_KEY);
    } catch {
      /* noop */
    }
  },
};

/** Enlace "Agregar a Google Calendar" para la reserva. */
export function googleCalendarUrl(a: { service: { name: string }; staff: { name: string }; startAt: string; endAt: string; code: string }, place: string) {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${a.service.name} · ${place}`,
    dates: `${fmt(a.startAt)}/${fmt(a.endAt)}`,
    details: `Reserva ${a.code} con ${a.staff.name}`,
    location: place,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
