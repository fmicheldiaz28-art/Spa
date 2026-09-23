import type { Permission, SystemRole } from '@naturalspa/shared';

/** Usuario autenticado, resuelto en cada petición a partir del token y la base de datos. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  roles: SystemRole[];
  permissions: ReadonlySet<Permission>;
  staffId: string | null;
  clientId: string | null;
  sessionId: string;
  mustChangePassword: boolean;
}

export function can(user: AuthUser, permission: Permission): boolean {
  return user.permissions.has(permission);
}

export function displayName(user: Pick<AuthUser, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
