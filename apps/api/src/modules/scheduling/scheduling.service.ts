import { Injectable } from '@nestjs/common';
import { type AuthUser, can } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import { resolveBranch, resolveOrganizationId } from '../../common/org.js';
import type { ExceptionStatus, ExceptionType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  addDays,
  contains,
  localDate,
  localToUtc,
  minutesToHHMM,
  minutesToTimeColumn,
  normalize,
  timeColumnToMinutes,
  utcToLocalMinutes,
} from '../availability/domain/time.js';

export interface Block {
  weekday: number;
  start: number;
  end: number;
}

export interface ExceptionInput {
  staffId: string | null;
  type: ExceptionType;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: number;
  endTime?: number;
  reason?: string | null;
}

const WEEKDAYS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** "martes 09:00–13:00, 14:00–19:00; miércoles …" — representación auditable de un horario. */
function describeBlocks(blocks: Block[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let d = 1; d <= 7; d++) {
    const day = normalize(blocks.filter((b) => b.weekday === d)).map((b) => `${minutesToHHMM(b.start)}–${minutesToHHMM(b.end)}`);
    out[WEEKDAYS[d]!] = day.length ? day.join(', ') : 'no trabaja';
  }
  return out;
}

function validateBlocks(blocks: Block[]) {
  for (let d = 1; d <= 7; d++) {
    const day = blocks.filter((b) => b.weekday === d).sort((a, b) => a.start - b.start);
    for (const [i, b] of day.entries()) {
      if (b.end <= b.start) throw Errors.validation([{ field: 'blocks', code: 'INVALID_RANGE', message: `El ${WEEKDAYS[d]} tiene un tramo que termina antes de empezar` }]);
      if (i > 0 && b.start < day[i - 1]!.end) {
        throw Errors.validation([{ field: 'blocks', code: 'OVERLAP', message: `Los tramos del ${WEEKDAYS[d]} se solapan` }]);
      }
    }
  }
}

/** Horarios, ausencias y feriados (docs/06-modulos.md M8). */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- colaboradoras

  async listStaff(user: AuthUser) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const staff = await this.prisma.staffProfile.findMany({
      where: {
        organizationId,
        user: { deletedAt: null },
        ...(!can(user, 'staff.read_all') && { id: user.staffId ?? '00000000-0000-0000-0000-000000000000' }),
      },
      include: {
        user: { select: { status: true, email: true } },
        staffServices: { select: { service: { select: { id: true, name: true } } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    return staff.map((s) => ({
      id: s.id,
      userId: s.userId,
      displayName: s.displayName,
      color: s.color,
      isActive: s.isActive && s.user.status === 'ACTIVE',
      isBookableOnline: s.isBookableOnline,
      services: s.staffServices.map((ss) => ss.service),
    }));
  }

  /** La empleada solo accede a su propio perfil; se responde 404 para no revelar otros. */
  private async findStaff(user: AuthUser, staffId: string) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const staff = await this.prisma.staffProfile.findFirst({ where: { id: staffId, organizationId } });
    if (!staff || (!can(user, 'schedules.read_all') && staff.id !== user.staffId)) throw Errors.notFound();
    return staff;
  }

  // ---------------------------------------------------------------- horario semanal

  async workSchedule(user: AuthUser, staffId: string) {
    const staff = await this.findStaff(user, staffId);
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: staff.branchId } });
    const today = localDate(new Date(), branch.timezone);
    const rows = await this.prisma.workSchedule.findMany({
      where: { staffId, OR: [{ validTo: null }, { validTo: { gte: new Date(today) } }] },
      orderBy: [{ validFrom: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }],
    });
    const toBlock = (r: (typeof rows)[number]) => ({
      weekday: r.weekday,
      start: minutesToHHMM(timeColumnToMinutes(r.startTime)),
      end: minutesToHHMM(timeColumnToMinutes(r.endTime)),
    });
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const current = rows.filter((r) => iso(r.validFrom) <= today);
    const upcoming = rows.filter((r) => iso(r.validFrom) > today);
    return {
      staffId,
      current: { validFrom: current[0] ? iso(current[0].validFrom) : null, blocks: current.map(toBlock) },
      upcoming: upcoming.length ? { validFrom: iso(upcoming[0]!.validFrom), blocks: upcoming.map(toBlock) } : null,
    };
  }

  /**
   * Reemplaza el horario semanal desde `validFrom` (RF-HOR-02). No toca citas existentes: informa
   * cuántas citas futuras quedarían fuera del horario nuevo (RF-HOR-07).
   */
  async setWorkSchedule(user: AuthUser, staffId: string, validFrom: string, blocks: Block[]) {
    const staff = await this.findStaff(user, staffId);
    validateBlocks(blocks);
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: staff.branchId } });
    const today = localDate(new Date(), branch.timezone);
    if (validFrom < today) throw Errors.validation([{ field: 'validFrom', code: 'PAST_DATE', message: 'La vigencia no puede empezar en el pasado' }]);

    // Debe respetar el horario del negocio (las horas fuera se cargan como disponibilidad EXTRA).
    const business = await this.prisma.businessHours.findMany({ where: { branchId: branch.id } });
    for (const b of blocks) {
      const open = business.filter((h) => h.weekday === b.weekday).map((h) => ({ start: timeColumnToMinutes(h.openTime), end: timeColumnToMinutes(h.closeTime) }));
      if (!contains(open, b)) {
        throw new AppException(
          422,
          'OUTSIDE_BUSINESS_HOURS',
          `El ${WEEKDAYS[b.weekday]} ${minutesToHHMM(b.start)}–${minutesToHHMM(b.end)} está fuera del horario del negocio`,
          'Para horas extra puntuales usa una ausencia de tipo "Disponibilidad extra".',
        );
      }
    }

    const before = await this.workSchedule(user, staffId);
    const from = new Date(validFrom);
    await this.prisma.$transaction(async (tx) => {
      await tx.workSchedule.deleteMany({ where: { staffId, validFrom: { gte: from } } });
      await tx.workSchedule.updateMany({
        where: { staffId, validFrom: { lt: from }, OR: [{ validTo: null }, { validTo: { gte: from } }] },
        data: { validTo: new Date(addDays(validFrom, -1)) },
      });
      await tx.workSchedule.createMany({
        data: blocks.map((b) => ({
          staffId,
          weekday: b.weekday,
          startTime: minutesToTimeColumn(b.start),
          endTime: minutesToTimeColumn(b.end),
          validFrom: from,
          createdBy: user.id,
        })),
      });
      const old = (before.upcoming ?? before.current).blocks.map((b) => ({
        weekday: b.weekday,
        start: Number(b.start.slice(0, 2)) * 60 + Number(b.start.slice(3)),
        end: Number(b.end.slice(0, 2)) * 60 + Number(b.end.slice(3)),
      }));
      await this.audit.record(
        {
          action: 'SCHEDULE_UPDATED',
          module: 'schedules',
          entity: { type: 'StaffProfile', id: staffId, label: staff.displayName },
          oldValues: describeBlocks(old),
          newValues: { ...describeBlocks(blocks), vigenteDesde: validFrom },
        },
        tx,
      );
    });

    const outside = await this.appointmentsOutside(staffId, branch.timezone, validFrom, blocks);
    return { ...(await this.workSchedule(user, staffId)), appointmentsOutside: outside };
  }

  private async appointmentsOutside(staffId: string, timeZone: string, validFrom: string, blocks: Block[]) {
    const items = await this.prisma.appointmentItem.findMany({
      where: { staffId, blocksCalendar: true, startAt: { gte: localToUtc(validFrom, 0, timeZone) } },
      select: { startAt: true, endAt: true },
      take: 500,
    });
    return items.filter((i) => {
      const date = localDate(i.startAt, timeZone);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
      const slot = { start: utcToLocalMinutes(i.startAt, date, timeZone), end: utcToLocalMinutes(i.endAt, date, timeZone) };
      return !contains(blocks.filter((b) => b.weekday === weekday), slot);
    }).length;
  }

  // ---------------------------------------------------------------- horario del negocio

  async businessHours(user: AuthUser) {
    const branch = await resolveBranch(this.prisma, await resolveOrganizationId(this.prisma, user));
    const rows = await this.prisma.businessHours.findMany({ where: { branchId: branch.id }, orderBy: [{ weekday: 'asc' }, { openTime: 'asc' }] });
    return {
      branchId: branch.id,
      timezone: branch.timezone,
      blocks: rows.map((r) => ({ weekday: r.weekday, start: minutesToHHMM(timeColumnToMinutes(r.openTime)), end: minutesToHHMM(timeColumnToMinutes(r.closeTime)) })),
    };
  }

  async setBusinessHours(user: AuthUser, blocks: Block[]) {
    validateBlocks(blocks);
    const branch = await resolveBranch(this.prisma, await resolveOrganizationId(this.prisma, user));
    const old = await this.prisma.businessHours.findMany({ where: { branchId: branch.id } });
    await this.prisma.$transaction(async (tx) => {
      await tx.businessHours.deleteMany({ where: { branchId: branch.id } });
      await tx.businessHours.createMany({
        data: blocks.map((b) => ({ branchId: branch.id, weekday: b.weekday, openTime: minutesToTimeColumn(b.start), closeTime: minutesToTimeColumn(b.end) })),
      });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: 'schedules',
          entity: { type: 'Branch', id: branch.id, label: `Horario de ${branch.name}` },
          oldValues: describeBlocks(old.map((o) => ({ weekday: o.weekday, start: timeColumnToMinutes(o.openTime), end: timeColumnToMinutes(o.closeTime) }))),
          newValues: describeBlocks(blocks),
        },
        tx,
      );
    });
    return this.businessHours(user);
  }

  // ---------------------------------------------------------------- ausencias

  private exceptionDto(e: Prisma.ScheduleExceptionGetPayload<{ include: { staff: { select: { displayName: true; color: true } } } }>, timeZone: string) {
    return {
      id: e.id,
      staff: e.staffId ? { id: e.staffId, displayName: e.staff?.displayName ?? '', color: e.staff?.color ?? null } : null,
      type: e.type,
      status: e.status,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      startDate: localDate(e.startAt, timeZone),
      // El fin es exclusivo: una ausencia "hasta el 25" termina el 26 a las 00:00.
      endDate: localDate(new Date(e.endAt.getTime() - 1), timeZone),
      allDay: e.allDay,
      reason: e.reason,
      rejectionReason: e.rejectionReason,
      createdAt: e.createdAt.toISOString(),
    };
  }

  async listExceptions(user: AuthUser, query: { staffId?: string; from?: string; to?: string; status?: ExceptionStatus }) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const branch = await resolveBranch(this.prisma, organizationId);
    const ownOnly = !can(user, 'schedules.read_all');
    const where: Prisma.ScheduleExceptionWhereInput = {
      organizationId,
      deletedAt: null,
      ...(ownOnly ? { OR: [{ staffId: user.staffId ?? '00000000-0000-0000-0000-000000000000' }, { staffId: null }] } : query.staffId ? { staffId: query.staffId } : {}),
      ...(query.status && { status: query.status }),
      ...(query.from && { endAt: { gt: localToUtc(query.from, 0, branch.timezone) } }),
      ...(query.to && { startAt: { lt: localToUtc(addDays(query.to, 1), 0, branch.timezone) } }),
    };
    const rows = await this.prisma.scheduleException.findMany({
      where,
      include: { staff: { select: { displayName: true, color: true } } },
      orderBy: { startAt: 'asc' },
      take: 500,
    });
    return rows.map((r) => this.exceptionDto(r, branch.timezone));
  }

  private toRange(input: ExceptionInput, timeZone: string): { startAt: Date; endAt: Date } {
    if (input.endDate < input.startDate) throw Errors.validation([{ field: 'endDate', code: 'INVALID_RANGE', message: 'La fecha final es anterior a la inicial' }]);
    if (input.allDay) {
      return { startAt: localToUtc(input.startDate, 0, timeZone), endAt: localToUtc(addDays(input.endDate, 1), 0, timeZone) };
    }
    if (input.startTime === undefined || input.endTime === undefined) {
      throw Errors.validation([{ field: 'startTime', code: 'REQUIRED', message: 'Indica la hora de inicio y fin' }]);
    }
    const startAt = localToUtc(input.startDate, input.startTime, timeZone);
    const endAt = localToUtc(input.endDate, input.endTime, timeZone);
    if (endAt <= startAt) throw Errors.validation([{ field: 'endTime', code: 'INVALID_RANGE', message: 'La hora final debe ser posterior a la inicial' }]);
    return { startAt, endAt };
  }

  /** Citas activas que chocan con una ausencia (RF-HOR-07). */
  private async affectedAppointments(staffId: string | null, organizationId: string, startAt: Date, endAt: Date) {
    const items = await this.prisma.appointmentItem.findMany({
      where: {
        organizationId,
        blocksCalendar: true,
        ...(staffId && { staffId }),
        startAt: { lt: endAt },
        blockedUntil: { gt: startAt },
      },
      include: { appointment: { select: { id: true, code: true, client: { select: { firstName: true, lastName: true } } } }, staff: { select: { displayName: true } } },
      orderBy: { startAt: 'asc' },
      take: 100,
    });
    return items.map((i) => ({
      appointmentId: i.appointment.id,
      code: i.appointment.code,
      client: `${i.appointment.client.firstName} ${i.appointment.client.lastName}`.trim(),
      staff: i.staff.displayName,
      service: i.serviceName,
      startAt: i.startAt.toISOString(),
    }));
  }

  /** Administración registra una ausencia aprobada (o disponibilidad extra). */
  async createException(user: AuthUser, input: ExceptionInput) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const branch = await resolveBranch(this.prisma, organizationId);
    if (input.staffId) await this.findStaff(user, input.staffId);
    if (!input.staffId && input.type !== 'BLOQUEO') {
      throw Errors.validation([{ field: 'staffId', code: 'REQUIRED', message: 'Solo los bloqueos pueden aplicarse a toda la sede' }]);
    }
    const { startAt, endAt } = this.toRange(input, branch.timezone);

    const created = await this.prisma.$transaction(async (tx) => {
      const e = await tx.scheduleException.create({
        data: {
          organizationId,
          branchId: branch.id,
          staffId: input.staffId,
          type: input.type,
          status: 'APROBADA',
          startAt,
          endAt,
          allDay: input.allDay,
          reason: input.reason ?? null,
          approvedBy: user.id,
          approvedAt: new Date(),
          createdBy: user.id,
          updatedBy: user.id,
        },
        include: { staff: { select: { displayName: true, color: true } } },
      });
      await this.audit.record(
        {
          action: 'EXCEPTION_CREATED',
          module: 'schedules',
          entity: { type: 'ScheduleException', id: e.id, label: `${e.type} · ${e.staff?.displayName ?? 'Toda la sede'}` },
          newValues: { tipo: e.type, colaboradora: e.staff?.displayName ?? 'Toda la sede', desde: startAt.toISOString(), hasta: endAt.toISOString(), diaCompleto: e.allDay },
          reason: e.reason,
        },
        tx,
      );
      return e;
    });

    const affected = input.type === 'EXTRA' ? [] : await this.affectedAppointments(input.staffId, organizationId, startAt, endAt);
    return { exception: this.exceptionDto(created, branch.timezone), affectedAppointments: affected };
  }

  /** La empleada solicita vacaciones o un permiso para sí misma (RF-HOR-08). */
  async requestException(user: AuthUser, input: Omit<ExceptionInput, 'staffId'>) {
    if (!user.staffId) throw Errors.forbidden();
    if (input.type !== 'VACACIONES' && input.type !== 'PERMISO') {
      throw Errors.validation([{ field: 'type', code: 'INVALID', message: 'Solo puedes solicitar vacaciones o permisos' }]);
    }
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const branch = await resolveBranch(this.prisma, organizationId);
    const { startAt, endAt } = this.toRange({ ...input, staffId: user.staffId }, branch.timezone);
    if (startAt < new Date()) throw Errors.validation([{ field: 'startDate', code: 'PAST_DATE', message: 'No puedes solicitar fechas pasadas' }]);

    return this.prisma.$transaction(async (tx) => {
      const e = await tx.scheduleException.create({
        data: {
          organizationId,
          branchId: branch.id,
          staffId: user.staffId,
          type: input.type,
          status: 'SOLICITADA',
          startAt,
          endAt,
          allDay: input.allDay,
          reason: input.reason ?? null,
          requestedBy: user.id,
          createdBy: user.id,
          updatedBy: user.id,
        },
        include: { staff: { select: { displayName: true, color: true } } },
      });
      await this.audit.record(
        {
          action: 'EXCEPTION_REQUESTED',
          module: 'schedules',
          entity: { type: 'ScheduleException', id: e.id, label: `${e.type} · ${e.staff?.displayName}` },
          newValues: { tipo: e.type, desde: startAt.toISOString(), hasta: endAt.toISOString() },
          reason: e.reason,
        },
        tx,
      );
      return this.exceptionDto(e, branch.timezone);
    });
  }

  async decideException(user: AuthUser, id: string, approve: boolean, reason?: string) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const branch = await resolveBranch(this.prisma, organizationId);
    const e = await this.prisma.scheduleException.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!e) throw Errors.notFound();
    if (e.status !== 'SOLICITADA') throw new AppException(422, 'NOT_PENDING', 'La solicitud ya fue resuelta');

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.scheduleException.update({
        where: { id },
        data: approve
          ? { status: 'APROBADA', approvedBy: user.id, approvedAt: new Date(), updatedBy: user.id }
          : { status: 'RECHAZADA', rejectionReason: reason ?? null, updatedBy: user.id },
        include: { staff: { select: { displayName: true, color: true } } },
      });
      await this.audit.record(
        {
          action: approve ? 'EXCEPTION_APPROVED' : 'EXCEPTION_REJECTED',
          module: 'schedules',
          entity: { type: 'ScheduleException', id, label: `${u.type} · ${u.staff?.displayName}` },
          oldValues: { status: e.status },
          newValues: { status: u.status },
          reason: reason ?? null,
        },
        tx,
      );
      return u;
    });
    const affected = approve ? await this.affectedAppointments(e.staffId, organizationId, e.startAt, e.endAt) : [];
    return { exception: this.exceptionDto(updated, branch.timezone), affectedAppointments: affected };
  }

  /** Administración elimina (soft) una ausencia; la empleada solo puede retirar su solicitud pendiente. */
  async removeException(user: AuthUser, id: string) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const e = await this.prisma.scheduleException.findFirst({ where: { id, organizationId, deletedAt: null }, include: { staff: { select: { displayName: true } } } });
    const isManager = can(user, 'schedules.manage');
    if (!e || (!isManager && e.staffId !== user.staffId)) throw Errors.notFound();
    if (!isManager && e.status !== 'SOLICITADA') throw new AppException(422, 'NOT_PENDING', 'Solo puedes retirar solicitudes pendientes');

    await this.prisma.$transaction(async (tx) => {
      if (isManager) await tx.scheduleException.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id } });
      else await tx.scheduleException.update({ where: { id }, data: { status: 'CANCELADA', updatedBy: user.id } });
      await this.audit.record(
        {
          action: isManager ? 'DELETE' : 'EXCEPTION_CANCELLED',
          module: 'schedules',
          entity: { type: 'ScheduleException', id, label: `${e.type} · ${e.staff?.displayName ?? 'Toda la sede'}` },
          oldValues: { status: e.status, desde: e.startAt.toISOString(), hasta: e.endAt.toISOString() },
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- feriados

  async holidays(user: AuthUser, year?: number) {
    const branch = await resolveBranch(this.prisma, await resolveOrganizationId(this.prisma, user));
    const rows = await this.prisma.holiday.findMany({
      where: { branchId: branch.id, ...(year && { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } }) },
      orderBy: { date: 'asc' },
    });
    return rows.map((h) => ({
      id: h.id,
      date: h.date.toISOString().slice(0, 10),
      name: h.name,
      isClosed: h.isClosed,
      openTime: h.openTime ? minutesToHHMM(timeColumnToMinutes(h.openTime)) : null,
      closeTime: h.closeTime ? minutesToHHMM(timeColumnToMinutes(h.closeTime)) : null,
    }));
  }

  async createHoliday(user: AuthUser, input: { date: string; name: string; isClosed: boolean; openTime?: number; closeTime?: number }) {
    const branch = await resolveBranch(this.prisma, await resolveOrganizationId(this.prisma, user));
    if (!input.isClosed && (input.openTime === undefined || input.closeTime === undefined || input.closeTime <= input.openTime)) {
      throw Errors.validation([{ field: 'openTime', code: 'REQUIRED', message: 'Indica el horario de apertura parcial' }]);
    }
    if (await this.prisma.holiday.findFirst({ where: { branchId: branch.id, date: new Date(input.date) } })) {
      throw new AppException(409, 'HOLIDAY_EXISTS', 'Ya hay un feriado registrado ese día');
    }
    await this.prisma.$transaction(async (tx) => {
      const h = await tx.holiday.create({
        data: {
          branchId: branch.id,
          date: new Date(input.date),
          name: input.name,
          isClosed: input.isClosed,
          openTime: input.isClosed ? null : minutesToTimeColumn(input.openTime!),
          closeTime: input.isClosed ? null : minutesToTimeColumn(input.closeTime!),
          createdBy: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'HOLIDAY_CREATED',
          module: 'schedules',
          entity: { type: 'Holiday', id: h.id, label: `${input.date} ${input.name}` },
          newValues: { fecha: input.date, nombre: input.name, cerrado: input.isClosed },
        },
        tx,
      );
    });
    return this.holidays(user, Number(input.date.slice(0, 4)));
  }

  async deleteHoliday(user: AuthUser, id: string) {
    const branch = await resolveBranch(this.prisma, await resolveOrganizationId(this.prisma, user));
    const h = await this.prisma.holiday.findFirst({ where: { id, branchId: branch.id } });
    if (!h) throw Errors.notFound();
    const date = h.date.toISOString().slice(0, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await this.audit.record(
        { action: 'HOLIDAY_DELETED', module: 'schedules', entity: { type: 'Holiday', id, label: `${date} ${h.name}` }, oldValues: { fecha: date, nombre: h.name, cerrado: h.isClosed } },
        tx,
      );
    });
  }
}
