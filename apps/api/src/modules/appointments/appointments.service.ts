import { Injectable } from '@nestjs/common';
import type { AppointmentStatus } from '@naturalspa/shared';
import { type AuthUser, can } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import { lastNameInitial } from '../../common/mask.js';
import type { AppointmentSource, CancelledByType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService, SLOT_PROBLEM_MESSAGES } from '../availability/availability.service.js';
import { EventsService } from '../events/events.service.js';
import { addDays, localToUtc } from '../availability/domain/time.js';
import {
  availableActions,
  canMarkNoShow,
  canRevert,
  isReschedulable,
  nextStatus,
  STAFF_ACTIONS,
  type StatusAction,
} from './domain/appointment-state.js';

export interface ItemInput {
  serviceId: string;
  staffId: string;
  startAt: Date;
}

export interface CreateAppointmentInput {
  clientId: string;
  source: AppointmentSource;
  items: ItemInput[];
  clientNotes?: string | null;
  internalNotes?: string | null;
  overbookingReason?: string | null;
  packageId?: string | null;
}

const NONE = '00000000-0000-0000-0000-000000000000';

const include = {
  client: { select: { id: true, firstName: true, lastName: true, allergies: true, contraindications: true, preferences: true } },
  items: {
    include: { staff: { select: { id: true, displayName: true, color: true } } },
    orderBy: { startAt: 'asc' },
  },
} satisfies Prisma.AppointmentInclude;

type AppointmentRecord = Prisma.AppointmentGetPayload<{ include: typeof include }>;

interface Settings {
  no_show?: { grace_minutes?: number };
}

/** Error de la restricción EXCLUDE (23P01): otra cita ocupó el horario entre la validación y el guardado. */
function isOverlapViolation(err: unknown): boolean {
  const text = `${String(err)} ${JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}))}`;
  return text.includes('23P01') || text.includes('ex_staff_no_overlap') || text.includes('ex_resource_no_overlap');
}

/** Citas: ciclo de vida completo con alcance por rol y auditoría (docs/06-modulos.md M7). */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
    private readonly events: EventsService,
  ) {}

  // -------------------------------------------------------------------- lectura

  /** La empleada solo ve citas con al menos un ítem suyo (docs/07 §11.5). */
  private scope(user: AuthUser, organizationId: string): Prisma.AppointmentWhereInput {
    const base = { organizationId, deletedAt: null };
    if (can(user, 'appointments.read_all')) return base;
    return { ...base, items: { some: { staffId: user.staffId ?? NONE } } };
  }

  dto(user: AuthUser, a: AppointmentRecord) {
    const full = can(user, 'appointments.read_all');
    const items = full ? a.items : a.items.filter((i) => i.staffId === user.staffId); // solo sus ítems en paquetes compartidos
    const clientName = full ? `${a.client.firstName} ${a.client.lastName}`.trim() : `${a.client.firstName} ${lastNameInitial(a.client.lastName)}`.trim();
    return {
      id: a.id,
      code: a.code,
      status: a.status as AppointmentStatus,
      source: a.source,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      client: {
        id: a.client.id,
        name: clientName,
        allergies: a.client.allergies,
        contraindications: a.client.contraindications,
        preferences: a.client.preferences,
      },
      items: items.map((i) => ({
        id: i.id,
        serviceId: i.serviceId,
        serviceName: i.serviceName,
        durationMin: i.durationMin,
        staff: i.staff,
        startAt: i.startAt.toISOString(),
        endAt: i.endAt.toISOString(),
        ...(full && { price: i.price.toFixed(2) }),
      })),
      ...(full && { total: a.total.toFixed(2), internalNotes: a.internalNotes }),
      clientNotes: a.clientNotes,
      isOverbooking: a.isOverbooking,
      overbookingReason: full ? a.overbookingReason : undefined,
      cancelReason: a.cancelReason,
      cancelledByType: a.cancelledByType,
      rescheduleCount: a.rescheduleCount,
      clientConfirmedAt: a.clientConfirmedAt?.toISOString() ?? null,
      actions: availableActions(a.status as AppointmentStatus),
      version: a.version,
      deleted: !!a.deletedAt,
    };
  }

  async list(user: AuthUser, organizationId: string, query: { from: Date; to: Date; staffId?: string; status?: AppointmentStatus[]; clientId?: string }) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        AND: [
          this.scope(user, organizationId),
          { startAt: { lt: query.to }, endAt: { gt: query.from } },
          query.staffId ? { items: { some: { staffId: query.staffId } } } : {},
          query.status?.length ? { status: { in: query.status } } : {},
          query.clientId ? { clientId: query.clientId } : {},
        ],
      },
      include,
      orderBy: { startAt: 'asc' },
      take: 1000,
    });
    return rows.map((a) => this.dto(user, a));
  }

  /** Datos de la agenda: colaboradoras visibles, sus horarios trabajables y las citas del rango. */
  async calendar(user: AuthUser, from: string, to: string, staffFilter?: string) {
    const { organizationId, branch } = await this.availability.context(user);
    const ownOnly = !can(user, 'appointments.read_all');
    const staff = await this.prisma.staffProfile.findMany({
      where: {
        organizationId,
        branchId: branch.id,
        isActive: true,
        user: { status: 'ACTIVE', deletedAt: null },
        ...(ownOnly ? { id: user.staffId ?? NONE } : staffFilter ? { id: staffFilter } : {}),
      },
      select: { id: true, displayName: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    const tz = branch.timezone;
    const [availability, appointments] = await Promise.all([
      this.availability.calendarDays(user, staff.map((s) => s.id), from, to),
      this.list(user, organizationId, {
        from: localToUtc(from, 0, tz),
        to: localToUtc(addDays(to, 1), 0, tz),
        staffId: ownOnly ? undefined : staffFilter,
        status: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'NO_SHOW', 'CANCELADA'],
      }),
    ]);
    return { timezone: tz, from, to, staff, availability: availability.days, appointments };
  }

  async get(user: AuthUser, id: string) {
    return this.dto(user, await this.find(user, id));
  }

  /** Línea de tiempo de la cita. La empleada ve los hechos, sin datos de otras colaboradoras. */
  async history(user: AuthUser, id: string) {
    const a = await this.find(user, id);
    const events = await this.prisma.auditLog.findMany({
      where: { entityType: 'Appointment', entityId: a.id },
      orderBy: { id: 'asc' },
      take: 200,
    });
    const full = can(user, 'appointments.read_all');
    return events.map((e) => ({
      id: e.id.toString(),
      occurredAt: e.occurredAt.toISOString(),
      action: e.action,
      actor: full ? (e.actorName ?? (e.actorType === 'SYSTEM' ? 'Sistema' : '—')) : e.actorUserId === user.id ? 'Tú' : 'Administración',
      reason: e.reason,
      ...(full && { oldValues: e.oldValues, newValues: e.newValues }),
    }));
  }

  // -------------------------------------------------------------------- escritura

  async create(user: AuthUser, input: CreateAppointmentInput) {
    const { organizationId, branch } = await this.availability.context(user);
    const client = await this.prisma.client.findFirst({ where: { id: input.clientId, organizationId, deletedAt: null } });
    if (!client) throw Errors.validation([{ field: 'clientId', code: 'NOT_FOUND', message: 'La clienta no existe' }]);
    if (!input.items.length) throw Errors.validation([{ field: 'items', code: 'REQUIRED', message: 'Agrega al menos un servicio' }]);

    const overbooking = !!input.overbookingReason;
    if (overbooking && !can(user, 'appointments.overbook')) throw Errors.forbidden();

    const items = await this.buildItems(organizationId, branch.id, input.items);
    if (input.packageId) await this.applyPackagePrice(organizationId, input.packageId, items);
    this.assertNotPast(items[0]!.startAt, overbooking);
    this.assertNoInternalOverlap(items);
    if (!overbooking) {
      for (const item of items) await this.assertAvailable(user, branch, item);
    }

    const subtotal = items.reduce((sum, i) => sum + i.price, 0);
    const startAt = new Date(Math.min(...items.map((i) => i.startAt.getTime())));
    const endAt = new Date(Math.max(...items.map((i) => i.endAt.getTime())));

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const a = await tx.appointment.create({
          data: {
            organizationId,
            branchId: branch.id,
            clientId: client.id,
            packageId: input.packageId ?? null,
            status: 'CONFIRMADA',
            source: input.source,
            startAt,
            endAt,
            subtotal,
            total: subtotal,
            clientNotes: input.clientNotes ?? null,
            internalNotes: input.internalNotes ?? null,
            isOverbooking: overbooking,
            overbookingReason: input.overbookingReason ?? null,
            confirmedAt: new Date(),
            createdBy: user.id,
            updatedBy: user.id,
            items: {
              create: items.map((i) => ({
                organizationId,
                serviceId: i.serviceId,
                staffId: i.staffId,
                startAt: i.startAt,
                endAt: i.endAt,
                blockedUntil: i.blockedUntil,
                serviceName: i.serviceName,
                durationMin: i.durationMin,
                price: i.price,
                // Un sobre-turno no ocupa la agenda para no violar la restricción (docs §9.4).
                blocksCalendar: !overbooking,
              })),
            },
            statusHistory: { create: { toStatus: 'CONFIRMADA', changedBy: user.id, actorType: 'USER' } },
          },
          include,
        });
        await this.audit.record(
          {
            action: overbooking ? 'OVERBOOKING' : 'CREATE',
            module: 'appointments',
            entity: { type: 'Appointment', id: a.id, label: a.code },
            newValues: {
              clienta: `${client.firstName} ${client.lastName}`.trim(),
              servicios: items.map((i) => `${i.serviceName} · ${i.staffName} · ${i.startAt.toISOString()}`).join(' | '),
              origen: input.source,
              total: subtotal.toFixed(2),
            },
            reason: input.overbookingReason ?? null,
          },
          tx,
        );
        return a;
      });
      this.events.appointmentChanged(organizationId, created.id, created.items.map((i) => i.staffId));
      return this.dto(user, created);
    } catch (err) {
      if (isOverlapViolation(err)) await this.throwSlotTaken(user, items[0]!);
      throw err;
    }
  }

  async updateNotes(user: AuthUser, id: string, version: number | undefined, input: { clientNotes?: string | null; internalNotes?: string | null }) {
    const before = await this.find(user, id);
    return this.write(user, before, version, async (tx) => {
      const after = await tx.appointment.update({
        where: { id },
        data: { clientNotes: input.clientNotes, internalNotes: input.internalNotes, version: { increment: 1 }, updatedBy: user.id },
        include,
      });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: 'appointments',
          entity: { type: 'Appointment', id, label: before.code },
          oldValues: { clientNotes: before.clientNotes, internalNotes: before.internalNotes },
          newValues: { clientNotes: after.clientNotes, internalNotes: after.internalNotes },
        },
        tx,
      );
      return after;
    });
  }

  /**
   * RF-AGE-05: reagendar mueve la MISMA cita (historial conservado). Valida disponibilidad
   * ignorando la propia cita; la restricción EXCLUDE cubre las carreras.
   */
  async reschedule(user: AuthUser, id: string, version: number | undefined, moves: { itemId: string; startAt: Date; staffId?: string }[], reason?: string | null) {
    const before = await this.find(user, id);
    if (!isReschedulable(before.status as AppointmentStatus)) {
      throw new AppException(422, 'INVALID_STATE_TRANSITION', 'Solo se pueden reagendar citas pendientes o confirmadas');
    }
    const { organizationId, branch } = await this.availability.context(user);
    const planned: { item: AppointmentRecord['items'][number]; built: Awaited<ReturnType<AppointmentsService['buildItems']>>[number] }[] = [];
    for (const move of moves) {
      const item = before.items.find((i) => i.id === move.itemId);
      if (!item) throw Errors.validation([{ field: 'items', code: 'NOT_FOUND', message: 'Ítem de la cita inexistente' }]);
      const staffId = move.staffId ?? item.staffId;
      const [built] = await this.buildItems(organizationId, branch.id, [{ serviceId: item.serviceId, staffId, startAt: move.startAt }], item);
      planned.push({ item, built: built! });
    }
    this.assertNotPast(planned[0]!.built.startAt, before.isOverbooking);
    if (!before.isOverbooking) {
      for (const p of planned) await this.assertAvailable(user, branch, p.built, id);
    }

    try {
      const after = await this.write(user, before, version, async (tx) => {
        for (const { item, built } of planned) {
          await tx.appointmentItem.update({
            where: { id: item.id },
            data: { staffId: built.staffId, startAt: built.startAt, endAt: built.endAt, blockedUntil: built.blockedUntil },
          });
        }
        const items = await tx.appointmentItem.findMany({ where: { appointmentId: id } });
        const startAt = new Date(Math.min(...items.map((i) => i.startAt.getTime())));
        const updated = await tx.appointment.update({
          where: { id },
          data: {
            startAt,
            endAt: new Date(Math.max(...items.map((i) => i.endAt.getTime()))),
            // La confirmación de la clienta era para el horario anterior.
            ...(startAt.getTime() !== before.startAt.getTime() && { clientConfirmedAt: null }),
            rescheduleCount: { increment: 1 },
            version: { increment: 1 },
            updatedBy: user.id,
          },
          include,
        });
        const describe = (a: AppointmentRecord) => ({
          inicio: a.startAt.toISOString(),
          colaboradora: a.items.map((i) => i.staff.displayName).join(', '),
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: id,
            fromStatus: before.status,
            toStatus: before.status,
            changedBy: user.id,
            actorType: 'USER',
            reason: reason ?? null,
            metadata: { antes: describe(before), despues: describe(updated) },
          },
        });
        await this.audit.record(
          { action: 'RESCHEDULE', module: 'appointments', entity: { type: 'Appointment', id, label: before.code }, oldValues: describe(before), newValues: describe(updated), reason: reason ?? null },
          tx,
        );
        return updated;
      });
      return after;
    } catch (err) {
      if (isOverlapViolation(err)) await this.throwSlotTaken(user, planned[0]!.built);
      throw err;
    }
  }

  async changeStatus(user: AuthUser, id: string, action: StatusAction, version: number | undefined, extra: { reason?: string | null; cancelledByType?: CancelledByType } = {}) {
    const before = await this.find(user, id);
    const manageAll = can(user, 'appointments.update_status_all');
    if (action === 'cancel' && !can(user, 'appointments.cancel')) throw Errors.forbidden();
    if (action === 'confirm' && !can(user, 'appointments.update')) throw Errors.forbidden();
    if (!manageAll && action !== 'cancel' && action !== 'confirm') {
      // La especialista solo marca el estado de sus propias citas.
      if (!STAFF_ACTIONS.includes(action) || !before.items.some((i) => i.staffId === user.staffId)) throw Errors.forbidden();
    }
    const to = nextStatus(before.status as AppointmentStatus, action);
    if (!to) throw new AppException(422, 'INVALID_STATE_TRANSITION', 'La cita no admite ese cambio de estado');
    if (action === 'cancel' && !extra.reason) throw Errors.validation([{ field: 'reason', code: 'REQUIRED', message: 'Indica el motivo de la cancelación' }]);
    if (action === 'no-show') {
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: before.organizationId }, select: { settings: true } });
      const grace = (org.settings as Settings).no_show?.grace_minutes ?? 15;
      if (!canMarkNoShow(before.startAt, new Date(), grace)) {
        throw new AppException(422, 'TOO_EARLY_FOR_NO_SHOW', `Espera ${grace} minutos después de la hora de inicio para marcar que no asistió`);
      }
    }

    const now = new Date();
    const data: Prisma.AppointmentUpdateInput = {
      status: to,
      version: { increment: 1 },
      updatedBy: user.id,
      ...(to === 'CONFIRMADA' && { confirmedAt: now }),
      ...(to === 'EN_CURSO' && { checkedInAt: now }),
      ...(to === 'COMPLETADA' && { completedAt: now }),
      ...(to === 'NO_SHOW' && { noShowAt: now }),
      ...(to === 'CANCELADA' && { cancelledAt: now, cancelledBy: user.id, cancelledByType: extra.cancelledByType ?? 'SPA', cancelReason: extra.reason }),
    };

    return this.write(user, before, version, async (tx) => {
      const after = await tx.appointment.update({ where: { id }, data, include });
      await tx.appointmentStatusHistory.create({
        data: { appointmentId: id, fromStatus: before.status, toStatus: to, changedBy: user.id, actorType: 'USER', reason: extra.reason ?? null },
      });
      await this.audit.record(
        {
          action: action === 'cancel' ? 'CANCEL' : 'STATUS_CHANGE',
          module: 'appointments',
          entity: { type: 'Appointment', id, label: before.code },
          oldValues: { status: before.status },
          newValues: { status: to, ...(to === 'CANCELADA' && { canceladaPor: extra.cancelledByType ?? 'SPA' }) },
          reason: extra.reason ?? null,
        },
        tx,
      );
      await this.refreshClientStats(tx, before.clientId);
      return after;
    });
  }

  /** Corrección de estados finales, solo ADMIN y con motivo (CU-11 A2). */
  async revertStatus(user: AuthUser, id: string, version: number | undefined, to: AppointmentStatus, reason: string) {
    const before = await this.find(user, id);
    if (!canRevert(before.status as AppointmentStatus, to)) throw new AppException(422, 'INVALID_STATE_TRANSITION', 'Esa corrección de estado no está permitida');
    try {
      return await this.write(user, before, version, async (tx) => {
        const after = await tx.appointment.update({
          where: { id },
          data: {
            status: to,
            version: { increment: 1 },
            updatedBy: user.id,
            ...(to !== 'COMPLETADA' && { completedAt: null }),
            ...(to === 'CONFIRMADA' && { checkedInAt: null, noShowAt: null, cancelledAt: null, cancelledBy: null, cancelledByType: null, cancelReason: null }),
          },
          include,
        });
        await tx.appointmentStatusHistory.create({ data: { appointmentId: id, fromStatus: before.status, toStatus: to, changedBy: user.id, actorType: 'USER', reason } });
        await this.audit.record(
          { action: 'REVERT_STATUS', module: 'appointments', entity: { type: 'Appointment', id, label: before.code }, oldValues: { status: before.status }, newValues: { status: to }, reason },
          tx,
        );
        await this.refreshClientStats(tx, before.clientId);
        return after;
      });
    } catch (err) {
      // Reactivar una cancelada puede chocar con otra cita que tomó el horario.
      if (isOverlapViolation(err)) throw new AppException(409, 'SLOT_TAKEN', 'El horario ya fue ocupado por otra cita', 'Reagéndala en otro horario.');
      throw err;
    }
  }

  /** RF-AGE-10: eliminar es lógico y con motivo; la cita sigue en la base y en la auditoría. */
  async remove(user: AuthUser, id: string, reason: string) {
    const before = await this.find(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id, deleteReason: reason, version: { increment: 1 } } });
      await this.audit.record(
        {
          action: 'DELETE',
          module: 'appointments',
          entity: { type: 'Appointment', id, label: before.code },
          oldValues: {
            clienta: `${before.client.firstName} ${before.client.lastName}`.trim(),
            estado: before.status,
            inicio: before.startAt.toISOString(),
            servicios: before.items.map((i) => `${i.serviceName} · ${i.staff.displayName}`).join(' | '),
          },
          reason,
        },
        tx,
      );
      await this.refreshClientStats(tx, before.clientId);
    });
    this.events.appointmentChanged(before.organizationId, id, before.items.map((i) => i.staffId));
  }

  async restore(user: AuthUser, id: string) {
    const { organizationId } = await this.availability.context(user);
    const before = await this.prisma.appointment.findFirst({ where: { id, organizationId, deletedAt: { not: null } }, include });
    if (!before) throw Errors.notFound();
    try {
      const after = await this.prisma.$transaction(async (tx) => {
        const a = await tx.appointment.update({ where: { id }, data: { deletedAt: null, deletedBy: null, deleteReason: null, version: { increment: 1 }, updatedBy: user.id }, include });
        await this.audit.record({ action: 'RESTORE', module: 'appointments', entity: { type: 'Appointment', id, label: before.code }, oldValues: { eliminada: true }, newValues: { eliminada: false } }, tx);
        await this.refreshClientStats(tx, before.clientId);
        return a;
      });
      this.events.appointmentChanged(organizationId, id, after.items.map((i) => i.staffId));
      return this.dto(user, after);
    } catch (err) {
      if (isOverlapViolation(err)) throw new AppException(409, 'SLOT_TAKEN', 'El horario ya fue ocupado por otra cita', 'Restáurala y reagéndala, o crea una nueva.');
      throw err;
    }
  }

  async deleted(user: AuthUser) {
    const { organizationId } = await this.availability.context(user);
    const rows = await this.prisma.appointment.findMany({ where: { organizationId, deletedAt: { not: null } }, include, orderBy: { deletedAt: 'desc' }, take: 100 });
    return rows.map((a) => ({ ...this.dto(user, a), deleteReason: a.deleteReason, deletedAt: a.deletedAt!.toISOString() }));
  }

  // -------------------------------------------------------------------- apoyo

  private async find(user: AuthUser, id: string): Promise<AppointmentRecord> {
    const { organizationId } = await this.availability.context(user);
    const a = await this.prisma.appointment.findFirst({ where: { AND: [this.scope(user, organizationId), { id }] }, include });
    if (!a) throw Errors.notFound(); // 404 también si es de otra colaboradora
    return a;
  }

  /** Bloqueo optimista (RF-AGE-14): si otra persona modificó la cita, 412. */
  private async write(user: AuthUser, before: AppointmentRecord, version: number | undefined, fn: (tx: Prisma.TransactionClient) => Promise<AppointmentRecord>) {
    const expected = version ?? before.version;
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({ where: { id: before.id, version: expected }, data: { updatedAt: new Date() } });
      if (count === 0) {
        throw new AppException(412, 'VERSION_CONFLICT', 'La cita fue modificada por otra persona', 'Recarga para ver la versión actual.');
      }
      return fn(tx);
    });
    // Aviso en tiempo real a quienes ven la cita antes y después (ej. reasignada a otra colaboradora).
    this.events.appointmentChanged(result.organizationId, result.id, [...before.items, ...result.items].map((i) => i.staffId));
    return this.dto(user, result);
  }

  private async buildItems(organizationId: string, branchId: string, inputs: ItemInput[], keepFrom?: { durationMin: number; price: Prisma.Decimal; serviceName: string }) {
    const out = [];
    for (const input of inputs) {
      const service = await this.prisma.service.findFirst({ where: { id: input.serviceId, organizationId, deletedAt: null } });
      if (!service || (!service.isActive && !keepFrom)) throw Errors.validation([{ field: 'serviceId', code: 'NOT_FOUND', message: 'Servicio inexistente o inactivo' }]);
      const performs = await this.prisma.staffService.findFirst({
        where: { serviceId: service.id, staffId: input.staffId, staff: { branchId, isActive: true, user: { status: 'ACTIVE' } } },
        include: { staff: { select: { displayName: true } } },
      });
      if (!performs) {
        throw new AppException(422, 'STAFF_CANNOT_PERFORM_SERVICE', 'La colaboradora no realiza ese servicio o no está activa');
      }
      // Al reagendar se conserva la duración y el precio pactados (snapshot).
      const durationMin = keepFrom?.durationMin ?? performs.customDurationMin ?? service.durationMin;
      const price = keepFrom ? Number(keepFrom.price) : Number(performs.customPrice ?? service.price);
      const endAt = new Date(input.startAt.getTime() + durationMin * 60_000);
      out.push({
        serviceId: service.id,
        serviceName: keepFrom?.serviceName ?? service.name,
        staffId: input.staffId,
        staffName: performs.staff.displayName,
        startAt: input.startAt,
        endAt,
        blockedUntil: new Date(endAt.getTime() + service.bufferAfterMin * 60_000),
        durationMin,
        bufferAfterMin: service.bufferAfterMin,
        price,
      });
    }
    return out;
  }

  /**
   * Paquete: el precio total del paquete se prorratea entre sus servicios según su precio de lista,
   * para que los reportes por servicio y por colaboradora sumen el precio real (docs/06 M6).
   */
  private async applyPackagePrice(organizationId: string, packageId: string, items: { serviceId: string; price: number }[]) {
    const pkg = await this.prisma.package.findFirst({ where: { id: packageId, organizationId, deletedAt: null }, include: { items: true } });
    if (!pkg) throw Errors.validation([{ field: 'packageId', code: 'NOT_FOUND', message: 'El paquete no existe' }]);
    const expected = pkg.items.map((i) => i.serviceId).sort().join();
    if (items.map((i) => i.serviceId).sort().join() !== expected) {
      throw Errors.validation([{ field: 'items', code: 'PACKAGE_MISMATCH', message: 'Los servicios no coinciden con el paquete' }]);
    }
    const list = items.reduce((sum, i) => sum + i.price, 0);
    const total = Number(pkg.price);
    let assigned = 0;
    items.forEach((item, index) => {
      item.price = index === items.length - 1 ? Math.round((total - assigned) * 100) / 100 : Math.round(((list ? item.price / list : 1 / items.length) * total) * 100) / 100;
      assigned += item.price;
    });
  }

  private assertNotPast(startAt: Date, overbooking: boolean) {
    // Se permite registrar una atención recién iniciada (walk-in) hasta 60 min atrás.
    if (!overbooking && startAt.getTime() < Date.now() - 60 * 60_000) {
      throw new AppException(422, 'PAST_DATE', 'No se pueden agendar citas en el pasado');
    }
  }

  private assertNoInternalOverlap(items: { staffId: string; startAt: Date; blockedUntil: Date }[]) {
    for (const [i, a] of items.entries()) {
      for (const b of items.slice(i + 1)) {
        if (a.staffId === b.staffId && a.startAt < b.blockedUntil && b.startAt < a.blockedUntil) {
          throw new AppException(422, 'ITEMS_OVERLAP', 'Dos servicios de la misma colaboradora se superponen');
        }
      }
    }
  }

  private async assertAvailable(
    user: AuthUser,
    branch: { id: string; timezone: string; organizationId: string },
    item: { serviceId: string; staffId: string; startAt: Date; durationMin: number; bufferAfterMin: number; staffName: string },
    excludeAppointmentId?: string,
  ) {
    const problem = await this.availability.checkSlot(branch, item.staffId, item.startAt, item.durationMin, item.bufferAfterMin, excludeAppointmentId);
    if (!problem) return;
    const suggestions = await this.availability.suggestions(user, item.serviceId, item.startAt, item.staffId).catch(() => []);
    throw new AppException(problem === 'SLOT_TAKEN' ? 409 : 422, problem, `${item.staffName}: ${SLOT_PROBLEM_MESSAGES[problem].toLowerCase()}`, undefined, [
      { field: 'suggestions', code: 'SUGGESTIONS', message: JSON.stringify(suggestions) },
    ]);
  }

  private async throwSlotTaken(user: AuthUser, item: { serviceId: string; staffId: string; startAt: Date; staffName: string }): Promise<never> {
    const suggestions = await this.availability.suggestions(user, item.serviceId, item.startAt, item.staffId).catch(() => []);
    throw new AppException(409, 'SLOT_TAKEN', `${item.staffName}: el horario acaba de ser ocupado por otra cita`, undefined, [
      { field: 'suggestions', code: 'SUGGESTIONS', message: JSON.stringify(suggestions) },
    ]);
  }

  /** Visitas, no-show y fechas de visita se recalculan desde las citas (fuente única de verdad). */
  private async refreshClientStats(tx: Prisma.TransactionClient, clientId: string) {
    const [completed, noShows] = await Promise.all([
      tx.appointment.aggregate({ where: { clientId, deletedAt: null, status: 'COMPLETADA' }, _count: true, _min: { startAt: true }, _max: { startAt: true } }),
      tx.appointment.count({ where: { clientId, deletedAt: null, status: 'NO_SHOW' } }),
    ]);
    await tx.client.update({
      where: { id: clientId },
      data: {
        visitsCount: completed._count,
        noShowCount: noShows,
        firstVisitAt: completed._min.startAt,
        lastVisitAt: completed._max.startAt,
      },
    });
  }

}
