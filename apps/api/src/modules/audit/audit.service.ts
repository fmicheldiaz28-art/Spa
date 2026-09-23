import { Injectable } from '@nestjs/common';
import { displayName } from '../../common/auth-user.js';
import { currentContext } from '../../common/context/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { changedFields, type Json, redact } from './audit-diff.js';

export interface AuditEntry {
  action: string;
  module: string;
  entity?: { type: string; id?: string | null; label?: string | null };
  oldValues?: Json | null;
  newValues?: Json | null;
  reason?: string | null;
  organizationId?: string | null;
  /** Actor explícito cuando no hay usuario en el contexto (login, jobs, seed). */
  actor?: {
    type: 'USER' | 'CLIENT' | 'SYSTEM' | 'ANONYMOUS';
    userId?: string | null;
    name?: string | null;
    role?: string | null;
  };
  sessionId?: string | null;
}

/**
 * Registro de auditoría append-only. Si se pasa `tx`, se escribe en la misma transacción que
 * el cambio: no puede existir un cambio sin su registro.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const ctx = currentContext();
    const user = ctx?.user;
    const oldValues = redact(entry.oldValues);
    const newValues = redact(entry.newValues);

    await (tx ?? this.prisma).auditLog.create({
      data: {
        organizationId: entry.organizationId ?? user?.organizationId ?? null,
        actorType: entry.actor?.type ?? (user ? 'USER' : 'ANONYMOUS'),
        actorUserId: entry.actor?.userId ?? user?.id ?? null,
        actorName: entry.actor?.name ?? (user ? displayName(user) : null),
        actorRole: entry.actor?.role ?? user?.roles[0] ?? null,
        action: entry.action,
        module: entry.module,
        entityType: entry.entity?.type ?? null,
        entityId: entry.entity?.id ?? null,
        entityLabel: entry.entity?.label ?? null,
        oldValues: (oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
        newValues: (newValues ?? undefined) as Prisma.InputJsonValue | undefined,
        changedFields: changedFields(oldValues, newValues),
        reason: entry.reason ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
        sessionId: entry.sessionId ?? user?.sessionId ?? null,
      },
    });
  }
}
