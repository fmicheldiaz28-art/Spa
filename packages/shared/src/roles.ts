import { ALL_PERMISSIONS, type Permission } from './permissions.js';

export const SYSTEM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'EMPLEADA', 'CLIENTE'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ROLE_NAMES: Record<SystemRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  EMPLEADA: 'Empleada',
  CLIENTE: 'Cliente',
};

const EMPLEADA: Permission[] = [
  'dashboard.view_own',
  'reports.view_own',
  'clients.read_assigned',
  'clients.update_service_notes',
  'services.read',
  'packages.read',
  'schedules.read_own',
  'schedules.request',
  'appointments.read_own',
  'appointments.update_status_own',
];

/** Todo lo operativo y administrativo de la organización, sin gestión de plataforma ni roles. */
const ADMIN: Permission[] = ALL_PERMISSIONS.filter(
  (code) => !['platform.manage', 'roles.manage', 'booking.self'].includes(code),
);

/** Matriz rol × permiso (docs/07-roles-permisos.md §11.4). */
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS.filter((code) => code !== 'booking.self'),
  ADMIN,
  EMPLEADA,
  CLIENTE: ['booking.self'],
};

/** Roles que cada rol puede asignar al crear o editar usuarios (sin auto-elevación). */
export const ASSIGNABLE_ROLES: Record<SystemRole, SystemRole[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'EMPLEADA'],
  ADMIN: ['ADMIN', 'EMPLEADA'],
  EMPLEADA: [],
  CLIENTE: [],
};
