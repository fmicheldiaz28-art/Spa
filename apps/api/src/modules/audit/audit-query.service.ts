import { Injectable } from '@nestjs/common';
import { type AuthUser, can } from '../../common/auth-user.js';
import { Errors } from '../../common/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface AuditQuery {
  actorId?: string;
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  q?: string;
  cursor?: string;
  limit: number;
}

type AuditRow = Prisma.AuditLogGetPayload<object>;

function toDto(row: AuditRow) {
  return {
    id: row.id.toString(),
    occurredAt: row.occurredAt.toISOString(),
    actor: { id: row.actorUserId, type: row.actorType, name: row.actorName, role: row.actorRole },
    action: row.action,
    module: row.module,
    entity: row.entityType ? { type: row.entityType, id: row.entityId, label: row.entityLabel } : null,
    changedFields: row.changedFields,
    reason: row.reason,
  };
}

/**
 * Consulta de auditoría (docs/11-seguridad-auditoria.md §20.6). Solo lectura: no existe ninguna
 * operación de modificación. Un ADMIN ve los eventos de su organización; el SUPER_ADMIN, todos.
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(user: AuthUser): Prisma.AuditLogWhereInput {
    return can(user, 'platform.manage') ? {} : { organizationId: user.organizationId ?? '00000000-0000-0000-0000-000000000000' };
  }

  async list(user: AuthUser, query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...this.scope(user),
      ...(query.actorId && { actorUserId: query.actorId }),
      ...(query.module && { module: query.module }),
      ...(query.action && { action: query.action }),
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.entityId && { entityId: query.entityId }),
      ...((query.from || query.to) && { occurredAt: { gte: query.from, lte: query.to } }),
      ...(query.q && {
        OR: [
          { entityLabel: { contains: query.q, mode: 'insensitive' } },
          { actorName: { contains: query.q, mode: 'insensitive' } },
          { reason: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
      ...(query.cursor && { id: { lt: BigInt(query.cursor) } }),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      data: page.map(toDto),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id.toString() : null,
    };
  }

  async get(user: AuthUser, id: string) {
    if (!/^\d+$/.test(id)) throw Errors.notFound();
    const row = await this.prisma.auditLog.findFirst({ where: { ...this.scope(user), id: BigInt(id) } });
    if (!row) throw Errors.notFound();
    return {
      ...toDto(row),
      oldValues: row.oldValues,
      newValues: row.newValues,
      ip: row.ip,
      userAgent: row.userAgent,
      requestId: row.requestId,
      sessionId: row.sessionId,
    };
  }

  /** Valores disponibles para los filtros de la pantalla de auditoría. */
  async facets(user: AuthUser) {
    const where = this.scope(user);
    const [modules, actions, actors] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['module'], where, orderBy: { module: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['action'], where, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.groupBy({
        by: ['actorUserId', 'actorName'],
        where: { ...where, actorUserId: { not: null } },
        orderBy: { actorName: 'asc' },
      }),
    ]);
    return {
      modules: modules.map((m) => m.module),
      actions: actions.map((a) => a.action),
      actors: actors.map((a) => ({ id: a.actorUserId!, name: a.actorName ?? '—' })),
    };
  }
}
