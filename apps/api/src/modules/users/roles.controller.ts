import { Controller, Get } from '@nestjs/common';
import { ASSIGNABLE_ROLES, type SystemRole } from '@naturalspa/shared';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Controller()
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('roles')
  @RequirePermission('roles.read')
  async roles(@CurrentUser() user: AuthUser) {
    const assignable = new Set(user.roles.flatMap((r) => ASSIGNABLE_ROLES[r]));
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: user.organizationId ?? undefined }] },
      include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      assignable: assignable.has(r.code as SystemRole),
      permissions: r.rolePermissions.map((rp) => rp.permission.code).sort(),
    }));
  }

  @Get('permissions')
  @RequirePermission('roles.read')
  permissions() {
    return this.prisma.permission.findMany({
      select: { code: true, module: true, description: true, isSensitive: true },
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
  }
}
