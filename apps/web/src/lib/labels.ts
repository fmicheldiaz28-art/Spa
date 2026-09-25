import type { SystemRole } from '@naturalspa/shared';
import type { BadgeTone } from '@/components/ui';

export const ROLE_LABELS: Record<SystemRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administración',
  EMPLEADA: 'Empleada',
  CLIENTE: 'Cliente',
};

export const ROLE_DESCRIPTIONS: Partial<Record<SystemRole, string>> = {
  SUPER_ADMIN: 'Acceso total a la plataforma, incluidos roles y organizaciones.',
  ADMIN: 'Todo lo del negocio: agenda, clientas, reportes, usuarios y auditoría.',
  EMPLEADA: 'Solo su agenda, sus citas y las clientas asignadas, sin datos de contacto.',
};

export const MODULE_LABELS: Record<string, string> = {
  auth: 'Acceso',
  users: 'Usuarios',
  system: 'Sistema',
  appointments: 'Citas',
  clients: 'Clientes',
  services: 'Servicios',
  schedules: 'Horarios',
  payments: 'Cobros',
  settings: 'Configuración',
  waitlist: 'Lista de espera',
  booking: 'Reservas online',
};

export const ACTION_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  CREATE: { label: 'Creó', tone: 'success' },
  UPDATE: { label: 'Editó', tone: 'info' },
  DELETE: { label: 'Eliminó', tone: 'danger' },
  RESTORE: { label: 'Restauró', tone: 'success' },
  ROLE_CHANGED: { label: 'Cambió rol', tone: 'warning' },
  USER_DEACTIVATED: { label: 'Desactivó', tone: 'danger' },
  USER_ACTIVATED: { label: 'Reactivó', tone: 'success' },
  USER_UNLOCKED: { label: 'Desbloqueó', tone: 'success' },
  FORCE_PASSWORD_RESET: { label: 'Restableció contraseña', tone: 'warning' },
  SESSION_REVOKED: { label: 'Cerró sesiones', tone: 'warning' },
  LOGIN: { label: 'Inició sesión', tone: 'neutral' },
  LOGOUT: { label: 'Cerró sesión', tone: 'neutral' },
  LOGIN_FAILED: { label: 'Login fallido', tone: 'warning' },
  ACCOUNT_LOCKED: { label: 'Cuenta bloqueada', tone: 'danger' },
  SESSION_HIJACK_SUSPECTED: { label: 'Posible robo de sesión', tone: 'danger' },
  PASSWORD_CHANGED: { label: 'Cambió su contraseña', tone: 'info' },
  PASSWORD_RESET_REQUESTED: { label: 'Pidió recuperar contraseña', tone: 'neutral' },
  PASSWORD_RESET: { label: 'Recuperó contraseña', tone: 'info' },
  VIEW_SENSITIVE: { label: 'Vio dato sensible', tone: 'warning' },
  EXPORT: { label: 'Exportó', tone: 'warning' },
  SEED: { label: 'Carga inicial', tone: 'neutral' },
  OVERBOOKING: { label: 'Creó sobre-turno', tone: 'warning' },
  RESCHEDULE: { label: 'Reagendó', tone: 'info' },
  CANCEL: { label: 'Canceló', tone: 'danger' },
  STATUS_CHANGE: { label: 'Cambió estado', tone: 'info' },
  REVERT_STATUS: { label: 'Corrigió estado', tone: 'warning' },
  CONFIRM_ATTENDANCE: { label: 'Confirmó asistencia', tone: 'success' },
  WHATSAPP_REMINDER: { label: 'Recordó por WhatsApp', tone: 'info' },
  WHATSAPP_WAITLIST: { label: 'Avisó por WhatsApp (lista de espera)', tone: 'info' },
  MFA_ENABLED: { label: 'Activó verificación en 2 pasos', tone: 'success' },
  MFA_DISABLED: { label: 'Desactivó verificación en 2 pasos', tone: 'warning' },
  MFA_RESET: { label: 'Reinició verificación en 2 pasos', tone: 'warning' },
  MFA_FAILED: { label: 'Código 2 pasos incorrecto', tone: 'warning' },
};

export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? { label: action, tone: 'neutral' as BadgeTone };
}

export const FIELD_LABELS: Record<string, string> = {
  firstName: 'Nombre',
  lastName: 'Apellido',
  email: 'Email',
  phone: 'Teléfono',
  role: 'Rol',
  status: 'Estado',
  locked: 'Bloqueada',
  mustChangePassword: 'Debe cambiar contraseña',
  staffDisplayName: 'Nombre visible',
  staffColor: 'Color en agenda',
  staffBookableOnline: 'Reservable online',
  revokedSessions: 'Sesiones cerradas',
  permissions: 'Permisos',
  roles: 'Roles',
  demo: 'Datos demo',
};

export const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Activo', INACTIVE: 'Inactivo' };

/** Presenta un valor del diff de auditoría de forma legible. */
export function formatAuditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (field === 'role' && typeof value === 'string') return ROLE_LABELS[value as SystemRole] ?? value;
  if (field === 'status' && typeof value === 'string') return STATUS_LABELS[value] ?? value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const STAFF_COLORS = ['#A7D3B0', '#A9C8EC', '#CDB6E8', '#F4C19C', '#F2DD8C', '#F3A9B8', '#9ED8D3', '#D6D0A8'];
