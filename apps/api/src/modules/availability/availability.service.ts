import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth-user.js';
import { Errors } from '../../common/errors.js';
import { resolveBranch, resolveOrganizationId } from '../../common/org.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { HoldStore } from './hold-store.js';
import { computeSlots, type DayInput, type StaffDay, workableIntervals } from './domain/availability.engine.js';
import { type PlanItem, planPackage } from './domain/package-planner.js';
import {
  addDays,
  contains,
  type Interval,
  isoWeekday,
  localDate,
  localToUtc,
  minutesToHHMM,
  overlaps,
  subtract,
  timeColumnToMinutes,
  utcToLocalMinutes,
} from './domain/time.js';

export interface SlotsQuery {
  serviceId: string;
  staffId?: string; // undefined = cualquiera
  date: string;
}

interface Settings {
  booking?: { slot_interval_min?: number; min_lead_time_min?: number; max_advance_days?: number };
}

type Branch = { id: string; timezone: string; organizationId: string };

/** Por día: lo que el motor necesita sin la parte específica del servicio. */
interface DayContext {
  businessHours: Interval[];
  holiday: DayInput['holiday'];
  staff: Map<string, StaffDay>;
}

export type SlotProblem = 'OUTSIDE_WORKING_HOURS' | 'STAFF_ABSENT' | 'SLOT_TAKEN';

export const SLOT_PROBLEM_MESSAGES: Record<SlotProblem, string> = {
  OUTSIDE_WORKING_HOURS: 'Está fuera del horario de trabajo de la colaboradora',
  STAFF_ABSENT: 'La colaboradora no está disponible (ausencia o bloqueo)',
  SLOT_TAKEN: 'La colaboradora ya tiene una cita en ese horario',
};

/**
 * Carga lo necesario para un rango de días y lo entrega al motor puro (docs/03 §7.7).
 * Todo el rango se lee en pocas consultas; luego se calcula día por día en memoria.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holds: HoldStore,
  ) {}

  async context(user: AuthUser) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const [branch, org] = await Promise.all([
      resolveBranch(this.prisma, organizationId),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } }),
    ]);
    return { organizationId, branch, settings: (org.settings ?? {}) as Settings };
  }

  /** Horario trabajable, ausencias y ocupación de un conjunto de colaboradoras en un rango de días. */
  async loadDays(branch: Branch, staffIds: string[], from: string, to: string, excludeAppointmentId?: string, excludeHoldId?: string): Promise<Map<string, DayContext>> {
    const tz = branch.timezone;
    const rangeStart = localToUtc(from, 0, tz);
    const rangeEnd = localToUtc(addDays(to, 1), 0, tz);

    const [business, holidays, schedules, exceptions, items] = await Promise.all([
      this.prisma.businessHours.findMany({ where: { branchId: branch.id } }),
      this.prisma.holiday.findMany({ where: { branchId: branch.id, date: { gte: new Date(from), lte: new Date(to) } } }),
      this.prisma.workSchedule.findMany({
        where: { staffId: { in: staffIds }, validFrom: { lte: new Date(to) }, OR: [{ validTo: null }, { validTo: { gte: new Date(from) } }] },
      }),
      this.prisma.scheduleException.findMany({
        where: {
          branchId: branch.id,
          deletedAt: null,
          status: 'APROBADA',
          OR: [{ staffId: { in: staffIds } }, { staffId: null }],
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
      }),
      this.prisma.appointmentItem.findMany({
        where: {
          staffId: { in: staffIds },
          blocksCalendar: true,
          startAt: { lt: rangeEnd },
          blockedUntil: { gt: rangeStart },
          ...(excludeAppointmentId && { appointmentId: { not: excludeAppointmentId } }),
        },
        select: { staffId: true, startAt: true, blockedUntil: true },
      }),
    ]);

    // Las retenciones de reservas online en curso ocupan la agenda como una cita más.
    const held = this.holds.active(staffIds, rangeStart, rangeEnd, excludeHoldId).map((h) => ({ staffId: h.staffId, startAt: h.startAt, blockedUntil: h.blockedUntil }));
    const busyItems = [...items, ...held];
    const toLocal = (date: string, a: Date, b: Date): Interval => ({ start: utcToLocalMinutes(a, date, tz), end: utcToLocalMinutes(b, date, tz) });
    const days = new Map<string, DayContext>();

    for (let date = from; date <= to; date = addDays(date, 1)) {
      const weekday = isoWeekday(date);
      const holiday = holidays.find((h) => h.date.toISOString().slice(0, 10) === date);
      const dayStart = localToUtc(date, 0, tz);
      const dayEnd = localToUtc(addDays(date, 1), 0, tz);
      const staff = new Map<string, StaffDay>();
      for (const staffId of staffIds) {
        const ex = exceptions.filter((e) => (e.staffId === staffId || e.staffId === null) && e.startAt < dayEnd && e.endAt > dayStart);
        staff.set(staffId, {
          staffId,
          shifts: schedules
            .filter(
              (w) =>
                w.staffId === staffId &&
                w.weekday === weekday &&
                w.validFrom.toISOString().slice(0, 10) <= date &&
                (!w.validTo || w.validTo.toISOString().slice(0, 10) >= date),
            )
            .map((w) => ({ start: timeColumnToMinutes(w.startTime), end: timeColumnToMinutes(w.endTime) })),
          absences: ex.filter((e) => e.type !== 'EXTRA').map((e) => toLocal(date, e.startAt, e.endAt)),
          extra: ex.filter((e) => e.type === 'EXTRA').map((e) => toLocal(date, e.startAt, e.endAt)),
          busy: busyItems.filter((i) => i.staffId === staffId && i.startAt < dayEnd && i.blockedUntil > dayStart).map((i) => toLocal(date, i.startAt, i.blockedUntil)),
        });
      }
      days.set(date, {
        businessHours: business.filter((b) => b.weekday === weekday).map((b) => ({ start: timeColumnToMinutes(b.openTime), end: timeColumnToMinutes(b.closeTime) })),
        holiday: !holiday
          ? null
          : holiday.isClosed
            ? { closed: true }
            : { closed: false, open: [{ start: timeColumnToMinutes(holiday.openTime!), end: timeColumnToMinutes(holiday.closeTime!) }] },
        staff,
      });
    }
    return days;
  }

  async serviceWithStaff(organizationId: string, branchId: string, serviceId: string, staffId?: string, onlineOnly = false) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, organizationId, deletedAt: null, isActive: true, ...(onlineOnly && { isOnlineBookable: true }) },
      include: {
        staffServices: {
          where: {
            ...(staffId && { staffId }),
            staff: { isActive: true, branchId, user: { status: 'ACTIVE', deletedAt: null }, ...(onlineOnly && { isBookableOnline: true }) },
          },
          select: { staffId: true, customPrice: true, staff: { select: { displayName: true, color: true } } },
        },
      },
    });
    if (!service) throw Errors.notFound();
    return service;
  }

  async slots(user: AuthUser, query: SlotsQuery, options: { leadTimeMin?: number; onlineOnly?: boolean } = {}) {
    const { organizationId, branch, settings } = await this.context(user);
    const service = await this.serviceWithStaff(organizationId, branch.id, query.serviceId, query.staffId, options.onlineOnly);
    const days = await this.loadDays(branch, service.staffServices.map((s) => s.staffId), query.date, query.date);
    const input = this.dayInput(days.get(query.date), service, branch.timezone, query.date, settings, options.leadTimeMin ?? 0);
    const names = new Map(service.staffServices.map((s) => [s.staffId, { id: s.staffId, name: s.staff.displayName, color: s.staff.color }]));
    return {
      date: query.date,
      timezone: branch.timezone,
      service: { id: service.id, name: service.name, durationMin: service.durationMin, bufferAfterMin: service.bufferAfterMin },
      slots: (input ? computeSlots(input) : []).map((s) => ({
        time: minutesToHHMM(s.start),
        startAt: localToUtc(query.date, s.start, branch.timezone).toISOString(),
        endAt: localToUtc(query.date, s.end, branch.timezone).toISOString(),
        staff: s.staffIds.map((id) => names.get(id)!).sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  }

  /** Días del mes con al menos un horario libre (para pintar el calendario). */
  async days(user: AuthUser, serviceId: string, staffId: string | undefined, month: string, options: { leadTimeMin?: number; onlineOnly?: boolean } = {}) {
    const { organizationId, branch, settings } = await this.context(user);
    const service = await this.serviceWithStaff(organizationId, branch.id, serviceId, staffId, options.onlineOnly);
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number) as [number, number];
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const days = await this.loadDays(branch, service.staffServices.map((s) => s.staffId), from, to);
    const out: { date: string; available: boolean; slots: number }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const input = this.dayInput(days.get(d), service, branch.timezone, d, settings, options.leadTimeMin ?? 0);
      const n = input ? computeSlots(input).length : 0;
      out.push({ date: d, available: n > 0, slots: n });
    }
    return { month, timezone: branch.timezone, days: out };
  }

  /**
   * Verifica un horario puntual para una colaboradora (al crear, editar o reagendar).
   * Devuelve el motivo si no está disponible. `excludeAppointmentId` ignora la propia cita.
   */
  async checkSlot(
    branch: Branch,
    staffId: string,
    startAt: Date,
    durationMin: number,
    bufferAfterMin: number,
    excludeAppointmentId?: string,
    excludeHoldId?: string,
  ): Promise<SlotProblem | null> {
    const date = localDate(startAt, branch.timezone);
    const day = (await this.loadDays(branch, [staffId], date, date, excludeAppointmentId, excludeHoldId)).get(date)!;
    const staff = day.staff.get(staffId)!;
    const start = utcToLocalMinutes(startAt, date, branch.timezone);
    const service = { start, end: start + durationMin };
    const blocked = { start, end: service.end + bufferAfterMin };
    if (!contains(workableIntervals({ businessHours: day.businessHours, holiday: day.holiday }, staff), service)) return 'OUTSIDE_WORKING_HOURS';
    if (overlaps(blocked, staff.absences)) return 'STAFF_ABSENT';
    if (overlaps(blocked, staff.busy)) return 'SLOT_TAKEN';
    return null;
  }

  /** Hasta 3 horarios libres cercanos al pedido, para ofrecer alternativas ante un conflicto. */
  async suggestions(user: AuthUser, serviceId: string, startAt: Date, preferredStaffId?: string) {
    const { branch } = await this.context(user);
    const date = localDate(startAt, branch.timezone);
    const target = startAt.getTime();
    const byDistance = <T extends { startAt: string }>(list: T[]) =>
      [...list].sort((a, b) => Math.abs(new Date(a.startAt).getTime() - target) - Math.abs(new Date(b.startAt).getTime() - target));
    const own = preferredStaffId ? (await this.slots(user, { serviceId, staffId: preferredStaffId, date })).slots : [];
    const any = (await this.slots(user, { serviceId, date })).slots;
    const picked = [...byDistance(own).slice(0, 2), ...byDistance(any)].filter((s, i, arr) => arr.findIndex((x) => x.startAt === s.startAt) === i).slice(0, 3);
    return picked.map((s) => ({ startAt: s.startAt, time: s.time, staff: s.staff }));
  }

  /**
   * Horarios posibles para un paquete en un día: para cada inicio candidato (cada 15 min) intenta
   * armar el plan completo; devuelve hasta `limit` opciones con la asignación de colaboradoras.
   */
  async packagePlans(user: AuthUser, packageId: string, date: string, limit = 8) {
    const { organizationId, branch, settings } = await this.context(user);
    const pkg = await this.prisma.package.findFirst({
      where: { id: packageId, organizationId, deletedAt: null, isActive: true },
      include: {
        items: {
          orderBy: { sequence: 'asc' },
          include: {
            service: {
              include: {
                staffServices: {
                  where: { staff: { isActive: true, branchId: branch.id, user: { status: 'ACTIVE', deletedAt: null } } },
                  select: { staffId: true, staff: { select: { displayName: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!pkg) throw Errors.notFound();
    const today = localDate(new Date(), branch.timezone);
    if (date < today) return { date, plans: [] };

    const staffIds = [...new Set(pkg.items.flatMap((i) => i.service.staffServices.map((s) => s.staffId)))];
    const names = new Map(pkg.items.flatMap((i) => i.service.staffServices.map((s) => [s.staffId, s.staff.displayName] as const)));
    const day = (await this.loadDays(branch, staffIds, date, date)).get(date)!;
    const items: PlanItem[] = pkg.items.map((i) => ({
      serviceId: i.serviceId,
      sequence: i.sequence,
      parallelGroup: i.parallelGroup,
      durationMin: i.service.durationMin,
      bufferAfterMin: i.service.bufferAfterMin,
      candidates: i.service.staffServices.map((s) => s.staffId),
    }));
    const serviceName = new Map(pkg.items.map((i) => [i.serviceId, i.service.name]));
    const step = settings.booking?.slot_interval_min ?? 15;
    const open = Math.min(...day.businessHours.map((b) => b.start), 24 * 60);
    const close = Math.max(...day.businessHours.map((b) => b.end), 0);
    const earliest = date === today ? utcToLocalMinutes(new Date(), date, branch.timezone) : 0;

    const plans = [];
    for (let start = Math.ceil(Math.max(open, earliest) / step) * step; start < close && plans.length < limit; start += step) {
      const plan = planPackage({ businessHours: day.businessHours, holiday: day.holiday }, day.staff, items, start);
      if (!plan) continue;
      plans.push({
        time: minutesToHHMM(start),
        endTime: minutesToHHMM(Math.max(...plan.map((p) => p.end))),
        items: plan.map((p) => ({
          serviceId: p.serviceId,
          serviceName: serviceName.get(p.serviceId)!,
          staffId: p.staffId,
          staffName: names.get(p.staffId)!,
          startAt: localToUtc(date, p.start, branch.timezone).toISOString(),
          time: minutesToHHMM(p.start),
        })),
      });
    }
    return { date, package: { id: pkg.id, name: pkg.name, price: pkg.price.toFixed(2) }, plans };
  }

  /** Para la vista de agenda: tramos trabajables y ausencias de cada colaboradora por día. */
  async calendarDays(user: AuthUser, staffIds: string[], from: string, to: string) {
    const { branch } = await this.context(user);
    const days = await this.loadDays(branch, staffIds, from, to);
    const out: Record<string, Record<string, { workable: { start: string; end: string }[]; absences: { start: string; end: string }[] }>> = {};
    const fmt = (i: Interval) => ({ start: minutesToHHMM(Math.max(0, i.start)), end: minutesToHHMM(Math.min(1440, i.end)) });
    for (const [date, day] of days) {
      out[date] = {};
      for (const [staffId, s] of day.staff) {
        const workable = workableIntervals({ businessHours: day.businessHours, holiday: day.holiday }, s);
        out[date][staffId] = {
          workable: subtract(workable, s.absences).map(fmt),
          absences: s.absences.map((a) => ({ start: Math.max(0, a.start), end: Math.min(1440, a.end) })).filter((a) => a.end > a.start).map(fmt),
        };
      }
    }
    return { timezone: branch.timezone, days: out };
  }

  private dayInput(
    day: DayContext | undefined,
    service: { durationMin: number; bufferAfterMin: number; staffServices: { staffId: string }[] },
    tz: string,
    date: string,
    settings: Settings,
    leadTimeMin: number,
  ): DayInput | null {
    if (!day) return null;
    const now = new Date();
    const today = localDate(now, tz);
    if (date < today || date > addDays(today, settings.booking?.max_advance_days ?? 365)) return null;
    return {
      businessHours: day.businessHours,
      holiday: day.holiday,
      staff: service.staffServices.map((s) => day.staff.get(s.staffId)!),
      durationMin: service.durationMin,
      bufferAfterMin: service.bufferAfterMin,
      slotIntervalMin: settings.booking?.slot_interval_min ?? 15,
      earliestStart: date === today ? utcToLocalMinutes(now, date, tz) + leadTimeMin : undefined,
    };
  }
}
