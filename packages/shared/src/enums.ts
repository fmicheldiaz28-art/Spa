export const APPOINTMENT_STATUSES = [
  'PENDIENTE',
  'CONFIRMADA',
  'EN_CURSO',
  'COMPLETADA',
  'CANCELADA',
  'NO_SHOW',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados que ocupan la agenda (docs/04-base-de-datos.md §9.6). */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'];

export const APPOINTMENT_SOURCES = ['ADMIN', 'ONLINE', 'WHATSAPP', 'TELEFONO', 'WALK_IN'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const PAYMENT_METHODS = ['EFECTIVO', 'QR', 'TRANSFERENCIA', 'TARJETA', 'OTRO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DEFAULT_TIMEZONE = 'America/La_Paz';
export const DEFAULT_CURRENCY = 'BOB';
