import { ASSIGNABLE_ROLES, type SystemRole } from '@naturalspa/shared';

/** Roles que se gestionan en la pantalla de Usuarios (el personal; las clientas van aparte). */
export const STAFF_ROLES: SystemRole[] = ['SUPER_ADMIN', 'ADMIN', 'EMPLEADA'];

export type PolicyViolation =
  | 'CANNOT_MANAGE_SUPER_ADMIN'
  | 'ROLE_NOT_ASSIGNABLE'
  | 'CANNOT_DEACTIVATE_SELF'
  | 'LAST_SUPER_ADMIN';

export const POLICY_MESSAGES: Record<PolicyViolation, string> = {
  CANNOT_MANAGE_SUPER_ADMIN: 'Solo un Super Admin puede modificar a otro Super Admin',
  ROLE_NOT_ASSIGNABLE: 'No puedes asignar ese rol',
  CANNOT_DEACTIVATE_SELF: 'No puedes desactivar tu propia cuenta',
  LAST_SUPER_ADMIN: 'Debe quedar al menos un Super Admin activo',
};

/** RF-USR-06: un ADMIN no puede crear, editar ni desactivar a un SUPER_ADMIN. */
export function canManageTarget(actorRoles: SystemRole[], targetRoles: SystemRole[]): PolicyViolation | null {
  if (targetRoles.includes('SUPER_ADMIN') && !actorRoles.includes('SUPER_ADMIN')) return 'CANNOT_MANAGE_SUPER_ADMIN';
  return null;
}

/** Sin auto-elevación: solo se asignan roles permitidos para el rol del actor. */
export function canAssignRole(actorRoles: SystemRole[], role: SystemRole): PolicyViolation | null {
  const assignable = new Set(actorRoles.flatMap((r) => ASSIGNABLE_ROLES[r]));
  return assignable.has(role) ? null : 'ROLE_NOT_ASSIGNABLE';
}

/**
 * RF-USR-07: no se puede dejar el sistema sin SUPER_ADMIN activo, ni desactivarse a uno mismo.
 * `activeSuperAdmins` es la cantidad actual, incluido el objetivo si lo es.
 */
export function canDeactivate(
  actorId: string,
  targetId: string,
  targetRoles: SystemRole[],
  activeSuperAdmins: number,
): PolicyViolation | null {
  if (actorId === targetId) return 'CANNOT_DEACTIVATE_SELF';
  if (targetRoles.includes('SUPER_ADMIN') && activeSuperAdmins <= 1) return 'LAST_SUPER_ADMIN';
  return null;
}

/** RF-USR-07 aplicado a un cambio de rol: quitarle SUPER_ADMIN al último activo. */
export function canChangeRole(
  targetRoles: SystemRole[],
  newRole: SystemRole,
  activeSuperAdmins: number,
): PolicyViolation | null {
  if (targetRoles.includes('SUPER_ADMIN') && newRole !== 'SUPER_ADMIN' && activeSuperAdmins <= 1) {
    return 'LAST_SUPER_ADMIN';
  }
  return null;
}
