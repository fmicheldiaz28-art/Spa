import { Injectable } from '@nestjs/common';
import type { Permission, SystemRole } from '@naturalspa/shared';
import type { AuthUser } from '../../common/auth-user.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

/**
 * Resuelve el usuario autenticado desde la base de datos en cada petición, así revocar una
 * sesión, desactivar un usuario o quitar un permiso tiene efecto inmediato.
 * (F1: consulta directa; se cacheará en Redis con invalidación por versión de permisos.)
 */
@Injectable()
export class AuthUserLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, sessionId: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt < new Date()) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
        staffProfile: { select: { id: true } },
        client: { select: { id: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) return null;

    const permissions = new Set<Permission>();
    for (const { role } of user.userRoles) {
      for (const rp of role.rolePermissions) permissions.add(rp.permission.code as Permission);
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationId: user.organizationId,
      roles: user.userRoles.map((ur) => ur.role.code as SystemRole),
      permissions,
      staffId: user.staffProfile?.id ?? null,
      clientId: user.client?.id ?? null,
      sessionId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
