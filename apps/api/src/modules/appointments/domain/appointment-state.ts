import type { AppointmentStatus } from '@naturalspa/shared';

/**
 * Máquina de estados de la cita (docs/04-base-de-datos.md §9.6).
 * Reagendar no es una transición: la cita sigue CONFIRMADA (o PENDIENTE) con otro horario.
 */
export type StatusAction = 'confirm' | 'check-in' | 'complete' | 'no-show' | 'cancel';

const TRANSITIONS: Record<StatusAction, { from: AppointmentStatus[]; to: AppointmentStatus }> = {
  confirm: { from: ['PENDIENTE'], to: 'CONFIRMADA' },
  'check-in': { from: ['CONFIRMADA'], to: 'EN_CURSO' },
  complete: { from: ['EN_CURSO', 'CONFIRMADA'], to: 'COMPLETADA' },
  'no-show': { from: ['CONFIRMADA'], to: 'NO_SHOW' },
  cancel: { from: ['PENDIENTE', 'CONFIRMADA'], to: 'CANCELADA' },
};

/** Correcciones que solo ADMIN puede hacer, con motivo (RF-AGE, docs §9.6). */
const REVERSIONS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  NO_SHOW: ['CONFIRMADA'],
  COMPLETADA: ['EN_CURSO', 'CONFIRMADA'],
  EN_CURSO: ['CONFIRMADA'],
  CANCELADA: ['CONFIRMADA'],
};

export function nextStatus(current: AppointmentStatus, action: StatusAction): AppointmentStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export function canRevert(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return REVERSIONS[from]?.includes(to) ?? false;
}

/** Estados que ocupan la agenda y por lo tanto se pueden mover. */
export function isReschedulable(status: AppointmentStatus): boolean {
  return status === 'PENDIENTE' || status === 'CONFIRMADA';
}

/** Acciones que la especialista puede hacer sobre sus propias citas (RF-AGE-15). */
export const STAFF_ACTIONS: StatusAction[] = ['check-in', 'complete', 'no-show'];

/** El no-show solo se puede marcar una vez iniciada la cita más la tolerancia (docs §9.7 no_show.grace_minutes). */
export function canMarkNoShow(startAt: Date, now: Date, graceMinutes: number): boolean {
  return now.getTime() >= startAt.getTime() + graceMinutes * 60_000;
}

export function availableActions(status: AppointmentStatus): StatusAction[] {
  return (Object.keys(TRANSITIONS) as StatusAction[]).filter((a) => nextStatus(status, a) !== null);
}
