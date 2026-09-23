import { Injectable } from '@nestjs/common';
import type { SystemRole } from '@naturalspa/shared';
import { type AuthUser, can } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { diff } from '../audit/audit-diff.js';
import { AuditService } from '../audit/audit.service.js';
import { generateTemporaryPassword, hashPassword, passwordPolicyViolations } from '../auth/password.js';
import {
  canAssignRole,
  canChangeRole,
  canDeactivate,
  canManageTarget,
  POLICY_MESSAGES,
  type PolicyViolation,
  STAFF_ROLES,
} from './users.policy.js';

const userInclude = {
  userRoles: { include: { role: { select: { code: true } } } },
  staffProfile: { select: { id: true, displayName: true, color: true, isBookableOnline: true, isActive: true } },
} satisfies Prisma.UserInclude;

type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export interface ListUsersQuery {
  q?: string;
  role?: SystemRole;
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
  page: number;
  pageSize: number;
}

export interface StaffInput {
  displayName?: string;
  color?: string;
  isBookableOnline?: boolean;
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  role: SystemRole;
  password?: string;
  staff?: StaffInput;
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'password'>>;

const rolesOf = (u: UserRecord) => u.userRoles.map((ur) => ur.role.code as SystemRole);

function toDto(u: UserRecord) {
  const role = rolesOf(u)[0] ?? null;
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
    phone: u.phoneE164,
    role,
    status: u.status,
    locked: !!u.lockedUntil && u.lockedUntil > new Date(),
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    staff: u.staffProfile,
  };
}

/** Instantánea auditable de un usuario (sin hash de contraseña). */
function snapshot(u: UserRecord) {
  return {
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phoneE164,
    role: rolesOf(u)[0] ?? null,
    status: u.status,
    staffDisplayName: u.staffProfile?.displayName ?? null,
    staffColor: u.staffProfile?.color ?? null,
    staffBookableOnline: u.staffProfile?.isBookableOnline ?? null,
  };
}

function violation(v: PolicyViolation | null): void {
  if (v) throw new AppException(v === 'LAST_SUPER_ADMIN' ? 409 : 403, v, POLICY_MESSAGES[v]);
}

/** Gestión del personal (docs/06-modulos.md M3). Todas las escrituras quedan auditadas. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Un ADMIN ve el personal de su organización; el SUPER_ADMIN ve todo el personal. */
  private scope(actor: AuthUser): Prisma.UserWhereInput {
    return {
      deletedAt: null,
      userRoles: { some: { role: { code: { in: STAFF_ROLES } } } },
      ...(can(actor, 'platform.manage') ? {} : { organizationId: actor.organizationId ?? '00000000-0000-0000-0000-000000000000' }),
    };
  }

  async list(actor: AuthUser, query: ListUsersQuery) {
    const now = new Date();
    const where: Prisma.UserWhereInput = {
      AND: [
        this.scope(actor),
        query.q
          ? {
              OR: [
                { firstName: { contains: query.q, mode: 'insensitive' } },
                { lastName: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {},
        query.role ? { userRoles: { some: { role: { code: query.role } } } } : {},
        query.status === 'LOCKED'
          ? { lockedUntil: { gt: now } }
          : query.status
            ? { status: query.status }
            : {},
      ],
    };
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: [{ status: 'asc' }, { firstName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: users.map(toDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(actor: AuthUser, id: string) {
    return toDto(await this.findTarget(actor, id));
  }

  async create(actor: AuthUser, input: CreateUserInput) {
    violation(canAssignRole(actor.roles, input.role));
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new AppException(409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese email');
    }
    if (input.password) this.assertPolicy(input.password);

    const temporaryPassword = input.password ? null : generateTemporaryPassword();
    const passwordHash = await hashPassword(input.password ?? temporaryPassword!);
    const organizationId = input.role === 'SUPER_ADMIN' ? null : await this.resolveOrganizationId(actor);
    const roleId = await this.roleId(input.role);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phoneE164: input.phone ?? null,
          passwordHash,
          mustChangePassword: true,
          createdBy: actor.id,
          updatedBy: actor.id,
          userRoles: { create: { roleId, grantedBy: actor.id } },
        },
      });
      if (input.role === 'EMPLEADA') await this.ensureStaffProfile(tx, created.id, organizationId!, input.firstName, input.staff, actor.id);

      const full = await tx.user.findUniqueOrThrow({ where: { id: created.id }, include: userInclude });
      await this.audit.record(
        { action: 'CREATE', module: 'users', entity: { type: 'User', id: full.id, label: full.email }, newValues: snapshot(full) },
        tx,
      );
      return full;
    });

    return { user: toDto(user), temporaryPassword };
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput) {
    const target = await this.findTarget(actor, id);
    const targetRoles = rolesOf(target);
    violation(canManageTarget(actor.roles, targetRoles));

    const roleChanged = input.role && input.role !== targetRoles[0];
    if (roleChanged) {
      violation(canAssignRole(actor.roles, input.role!));
      violation(canChangeRole(targetRoles, input.role!, await this.activeSuperAdmins()));
    }
    if (input.email && input.email !== target.email && (await this.prisma.user.findUnique({ where: { email: input.email } }))) {
      throw new AppException(409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese email');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phoneE164: input.phone === undefined ? undefined : input.phone,
          updatedBy: actor.id,
        },
      });

      const newRole = (input.role ?? targetRoles[0]) as SystemRole;
      if (roleChanged) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.create({ data: { userId: id, roleId: await this.roleId(newRole), grantedBy: actor.id } });
      }
      if (newRole === 'EMPLEADA') {
        const orgId = target.organizationId ?? (await this.resolveOrganizationId(actor));
        await this.ensureStaffProfile(tx, id, orgId, input.firstName ?? target.firstName, input.staff, actor.id, target.status === 'ACTIVE');
      } else if (target.staffProfile?.isActive) {
        // Deja de ser colaboradora: el perfil se conserva (historial) pero no recibe citas.
        await tx.staffProfile.update({ where: { userId: id }, data: { isActive: false, updatedBy: actor.id } });
      }

      const full = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      const changes = diff(snapshot(target), snapshot(full));
      if (changes) {
        await this.audit.record(
          {
            action: roleChanged ? 'ROLE_CHANGED' : 'UPDATE',
            module: 'users',
            entity: { type: 'User', id, label: full.email },
            ...changes,
          },
          tx,
        );
      }
      return full;
    });
    return toDto(updated);
  }

  async deactivate(actor: AuthUser, id: string, reason?: string) {
    const target = await this.findTarget(actor, id);
    const targetRoles = rolesOf(target);
    violation(canManageTarget(actor.roles, targetRoles));
    violation(canDeactivate(actor.id, id, targetRoles, await this.activeSuperAdmins()));
    if (target.status === 'INACTIVE') return { user: toDto(target), futureAppointments: 0 };

    const futureAppointments = target.staffProfile
      ? await this.prisma.appointmentItem.count({
          where: { staffId: target.staffProfile.id, blocksCalendar: true, startAt: { gt: new Date() } },
        })
      : 0;

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'INACTIVE', updatedBy: actor.id } });
      // Pierde el acceso de inmediato: el guard valida la sesión en cada petición.
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'USER_DEACTIVATED' },
      });
      if (target.staffProfile) {
        await tx.staffProfile.update({ where: { userId: id }, data: { isActive: false, updatedBy: actor.id } });
      }
      await this.audit.record(
        {
          action: 'USER_DEACTIVATED',
          module: 'users',
          entity: { type: 'User', id, label: target.email },
          oldValues: { status: target.status },
          newValues: { status: 'INACTIVE' },
          reason: reason ?? null,
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    });
    return { user: toDto(user), futureAppointments };
  }

  /** Reactiva un usuario desactivado o desbloquea uno bloqueado por intentos fallidos. */
  async activate(actor: AuthUser, id: string) {
    const target = await this.findTarget(actor, id);
    violation(canManageTarget(actor.roles, rolesOf(target)));
    const wasLocked = !!target.lockedUntil && target.lockedUntil > new Date();
    if (target.status === 'ACTIVE' && !wasLocked) return toDto(target);

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, updatedBy: actor.id },
      });
      if (target.staffProfile && rolesOf(target).includes('EMPLEADA')) {
        await tx.staffProfile.update({ where: { userId: id }, data: { isActive: true, updatedBy: actor.id } });
      }
      await this.audit.record(
        {
          action: target.status === 'ACTIVE' ? 'USER_UNLOCKED' : 'USER_ACTIVATED',
          module: 'users',
          entity: { type: 'User', id, label: target.email },
          oldValues: { status: target.status, locked: wasLocked },
          newValues: { status: 'ACTIVE', locked: false },
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
    });
    return toDto(user);
  }

  /** Genera una contraseña temporal (se muestra una vez) y obliga a cambiarla al ingresar. */
  async resetPassword(actor: AuthUser, id: string) {
    const target = await this.findTarget(actor, id);
    violation(canManageTarget(actor.roles, rolesOf(target)));
    if (actor.id === id) {
      throw new AppException(422, 'USE_CHANGE_PASSWORD', 'Para tu propia cuenta usa "Cambiar contraseña"');
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedBy: actor.id },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET_BY_ADMIN' },
      });
      await this.audit.record(
        { action: 'FORCE_PASSWORD_RESET', module: 'users', entity: { type: 'User', id, label: target.email } },
        tx,
      );
    });
    return { temporaryPassword };
  }

  async sessions(actor: AuthUser, id: string) {
    await this.findTarget(actor, id);
    const sessions = await this.prisma.session.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      userAgent: s.userAgent,
      ip: s.ip,
      current: s.id === actor.sessionId,
    }));
  }

  async revokeSessions(actor: AuthUser, id: string) {
    const target = await this.findTarget(actor, id);
    violation(canManageTarget(actor.roles, rolesOf(target)));
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { userId: id, revokedAt: null, id: { not: actor.sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'REVOKED_BY_ADMIN' },
      });
      await this.audit.record(
        {
          action: 'SESSION_REVOKED',
          module: 'users',
          entity: { type: 'User', id, label: target.email },
          newValues: { revokedSessions: count },
        },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------

  private async findTarget(actor: AuthUser, id: string): Promise<UserRecord> {
    const user = await this.prisma.user.findFirst({ where: { AND: [this.scope(actor), { id }] }, include: userInclude });
    if (!user) throw Errors.notFound(); // 404 también si está fuera de alcance
    return user;
  }

  private activeSuperAdmins() {
    return this.prisma.user.count({
      where: { status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { code: 'SUPER_ADMIN' } } } },
    });
  }

  private async roleId(code: SystemRole): Promise<string> {
    const role = await this.prisma.role.findFirst({ where: { code, organizationId: null }, select: { id: true } });
    if (!role) throw new Error(`Rol de sistema ${code} inexistente: ejecuta el seed`);
    return role.id;
  }

  /** Organización del actor; un SUPER_ADMIN (sin organización) usa la única existente. */
  private async resolveOrganizationId(actor: AuthUser): Promise<string> {
    if (actor.organizationId) return actor.organizationId;
    const orgs = await this.prisma.organization.findMany({ select: { id: true }, take: 2 });
    if (orgs.length !== 1) {
      throw new AppException(422, 'ORGANIZATION_REQUIRED', 'Indica la organización del usuario');
    }
    return orgs[0]!.id;
  }

  private async ensureStaffProfile(
    tx: Prisma.TransactionClient,
    userId: string,
    organizationId: string,
    firstName: string,
    staff: StaffInput | undefined,
    actorId: string,
    active = true,
  ) {
    const existing = await tx.staffProfile.findUnique({ where: { userId } });
    if (existing) {
      await tx.staffProfile.update({
        where: { userId },
        data: {
          displayName: staff?.displayName,
          color: staff?.color,
          isBookableOnline: staff?.isBookableOnline,
          isActive: active,
          updatedBy: actorId,
        },
      });
      return;
    }
    const branch = await tx.branch.findFirst({ where: { organizationId, isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!branch) throw new AppException(422, 'BRANCH_REQUIRED', 'La organización no tiene sedes activas');
    await tx.staffProfile.create({
      data: {
        organizationId,
        branchId: branch.id,
        userId,
        displayName: staff?.displayName ?? firstName,
        color: staff?.color ?? '#A7D3B0',
        isBookableOnline: staff?.isBookableOnline ?? true,
        isActive: active,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  private assertPolicy(password: string) {
    const violations = passwordPolicyViolations(password);
    if (violations.length) {
      throw Errors.validation(violations.map((message) => ({ field: 'password', code: 'PASSWORD_POLICY', message })));
    }
  }
}
