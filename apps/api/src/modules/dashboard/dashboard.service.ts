import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth-user.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { addDays, isoWeekday, localDate, localToUtc } from '../availability/domain/time.js';

const ACTIVE = ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole ? round1((part / whole) * 100) : 0);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** KPIs y gráficas del dashboard ejecutivo (docs/09-ux-ui.md §16). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  private async sales(organizationId: string, from: Date, to: Date) {
    const rows = await this.prisma.payment.findMany({
      where: { organizationId, status: 'REGISTRADO', paidAt: { gte: from, lt: to } },
      select: { amount: true, type: true, paidAt: true },
    });
    return rows;
  }

  private sum(rows: { amount: Prisma.Decimal; type: string }[]) {
    return round2(rows.reduce((s, r) => s + (r.type === 'REEMBOLSO' ? -1 : 1) * Number(r.amount), 0));
  }

  /** Ocupación = minutos reservados ÷ minutos disponibles (horario − ausencias − feriados). */
  private async occupancy(user: AuthUser, organizationId: string, branchId: string, tz: string, from: string, to: string) {
    const staff = await this.prisma.staffProfile.findMany({
      where: { organizationId, branchId, isActive: true, user: { status: 'ACTIVE', deletedAt: null } },
      select: { id: true, displayName: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    const cal = await this.availability.calendarDays(user, staff.map((s) => s.id), from, to);
    const items = await this.prisma.appointmentItem.findMany({
      where: {
        organizationId,
        staffId: { in: staff.map((s) => s.id) },
        startAt: { gte: localToUtc(from, 0, tz), lt: localToUtc(addDays(to, 1), 0, tz) },
        appointment: { deletedAt: null, status: { in: [...ACTIVE] } },
      },
      select: { staffId: true, durationMin: true },
    });
    const perStaff = staff.map((s) => {
      const available = Object.values(cal.days).reduce((sum, day) => sum + (day[s.id]?.workable ?? []).reduce((a, w) => a + minutes(w.end) - minutes(w.start), 0), 0);
      const reserved = items.filter((i) => i.staffId === s.id).reduce((a, i) => a + i.durationMin, 0);
      return { id: s.id, name: s.displayName, color: s.color, available, reserved, pct: pct(reserved, available) };
    });
    const available = perStaff.reduce((s, x) => s + x.available, 0);
    const reserved = perStaff.reduce((s, x) => s + x.reserved, 0);
    return { pct: pct(reserved, available), reservedMin: reserved, availableMin: available, perStaff };
  }

  async summary(user: AuthUser, query: { from?: string; to?: string }) {
    const { organizationId, branch } = await this.availability.context(user);
    const tz = branch.timezone;
    const today = localDate(new Date(), tz);
    const monthStart = `${today.slice(0, 8)}01`;
    const from = query.from ?? monthStart;
    const to = query.to ?? today;
    const u = (d: string) => localToUtc(d, 0, tz);

    // Ventas del día vs. mismo día de la semana anterior; ventas del mes (MTD) vs. mismo tramo del mes anterior.
    const [today$, lastWeek$, month$, prevMonth$] = await Promise.all([
      this.sales(organizationId, u(today), u(addDays(today, 1))),
      this.sales(organizationId, u(addDays(today, -7)), u(addDays(today, -6))),
      this.sales(organizationId, u(monthStart), u(addDays(today, 1))),
      (() => {
        const [y, m] = today.split('-').map(Number) as [number, number];
        const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
        const prevEnd = addDays(prevStart, Number(today.slice(8)) - 1);
        return this.sales(organizationId, u(prevStart), u(addDays(prevEnd, 1)));
      })(),
    ]);
    const salesToday = this.sum(today$);
    const salesLastWeekDay = this.sum(lastWeek$);
    const salesMonth = this.sum(month$);
    const salesPrevMonth = this.sum(prevMonth$);

    const [todayAppointments, period] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['status'],
        where: { organizationId, deletedAt: null, startAt: { gte: u(today), lt: u(addDays(today, 1)) } },
        _count: true,
      }),
      this.prisma.appointment.groupBy({
        by: ['status', 'source'],
        where: { organizationId, deletedAt: null, startAt: { gte: u(from), lt: u(addDays(to, 1)) } },
        _count: true,
      }),
    ]);
    const byStatus = Object.fromEntries(todayAppointments.map((g) => [g.status, g._count]));
    const count = (pred: (g: (typeof period)[number]) => boolean) => period.filter(pred).reduce((s, g) => s + g._count, 0);
    const total = count(() => true);
    const cancelled = count((g) => g.status === 'CANCELADA');
    const noShow = count((g) => g.status === 'NO_SHOW');
    const completed = count((g) => g.status === 'COMPLETADA');
    const online = count((g) => g.source === 'ONLINE');

    const weekStart = addDays(today, 1 - isoWeekday(today));
    const [occToday, occWeek] = await Promise.all([
      this.occupancy(user, organizationId, branch.id, tz, today, today),
      this.occupancy(user, organizationId, branch.id, tz, weekStart, addDays(weekStart, 6)),
    ]);

    return {
      period: { from, to },
      today,
      kpis: {
        salesToday: { value: salesToday.toFixed(2), deltaPct: salesLastWeekDay ? round1(((salesToday - salesLastWeekDay) / salesLastWeekDay) * 100) : null },
        salesMonth: { value: salesMonth.toFixed(2), deltaPct: salesPrevMonth ? round1(((salesMonth - salesPrevMonth) / salesPrevMonth) * 100) : null },
        appointmentsToday: { value: Object.values(byStatus).reduce((s, n) => s + n, 0), byStatus },
        occupancy: { todayPct: occToday.pct, weekPct: occWeek.pct },
        cancellations: { count: cancelled, pct: pct(cancelled, total) },
        // No-show sobre las citas que debían ocurrir (docs §16.1).
        noShow: { count: noShow, pct: pct(noShow, completed + noShow) },
        onlineBookings: { count: online, pct: pct(online, total) },
      },
    };
  }

  async charts(user: AuthUser, query: { from?: string; to?: string }) {
    const { organizationId, branch } = await this.availability.context(user);
    const tz = branch.timezone;
    const today = localDate(new Date(), tz);
    const from = query.from ?? `${today.slice(0, 8)}01`;
    const to = query.to ?? today;
    const u = (d: string) => localToUtc(d, 0, tz);

    // Ventas de los últimos 30 días y los 30 anteriores.
    const start = addDays(today, -29);
    const rows = await this.sales(organizationId, u(addDays(start, -30)), u(addDays(today, 1)));
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const d = localDate(r.paidAt, tz);
      byDay.set(d, (byDay.get(d) ?? 0) + (r.type === 'REEMBOLSO' ? -1 : 1) * Number(r.amount));
    }
    const sales = Array.from({ length: 30 }, (_, i) => {
      const d = addDays(start, i);
      return { date: d, amount: round2(byDay.get(d) ?? 0), previous: round2(byDay.get(addDays(d, -30)) ?? 0) };
    });

    const items = await this.prisma.appointmentItem.findMany({
      where: {
        organizationId,
        startAt: { gte: u(from), lt: u(addDays(to, 1)) },
        appointment: { deletedAt: null, status: { in: [...ACTIVE] } },
      },
      select: { serviceName: true, price: true },
    });
    const services = new Map<string, { name: string; count: number; revenue: number }>();
    for (const i of items) {
      const s = services.get(i.serviceName) ?? { name: i.serviceName, count: 0, revenue: 0 };
      s.count += 1;
      s.revenue = round2(s.revenue + Number(i.price));
      services.set(i.serviceName, s);
    }
    const topServices = [...services.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 10);

    const occ = await this.occupancy(user, organizationId, branch.id, tz, from, to);

    // Clientas nuevas por semana (últimas 8 semanas), por origen.
    const weekStart = addDays(today, 1 - isoWeekday(today));
    const firstWeek = addDays(weekStart, -7 * 7);
    const clients = await this.prisma.client.findMany({
      where: { organizationId, deletedAt: null, createdAt: { gte: u(firstWeek) } },
      select: { createdAt: true, source: true },
    });
    const newClients = Array.from({ length: 8 }, (_, i) => {
      const ws = addDays(firstWeek, i * 7);
      const inWeek = clients.filter((c) => {
        const d = localDate(c.createdAt, tz);
        return d >= ws && d < addDays(ws, 7);
      });
      return { weekStart: ws, online: inWeek.filter((c) => c.source === 'ONLINE').length, manual: inWeek.filter((c) => c.source !== 'ONLINE').length };
    });

    return { period: { from, to }, sales, topServices, staffOccupancy: occ.perStaff.map(({ id, name, color, pct: p }) => ({ id, name, color, pct: p })), newClients };
  }

  /** "Mi día": sin montos ni datos de otras colaboradoras (RF-DASH-13). */
  async me(user: AuthUser) {
    const { organizationId, branch } = await this.availability.context(user);
    const tz = branch.timezone;
    const today = localDate(new Date(), tz);
    const monthStart = `${today.slice(0, 8)}01`;
    const staffId = user.staffId ?? '00000000-0000-0000-0000-000000000000';
    const completedThisMonth = await this.prisma.appointmentItem.count({
      where: { staffId, startAt: { gte: localToUtc(monthStart, 0, tz), lt: localToUtc(addDays(today, 1), 0, tz) }, appointment: { deletedAt: null, status: 'COMPLETADA' } },
    });
    const staff = await this.prisma.staffProfile.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!staff) return { today, completedThisMonth: 0, occupancyMonthPct: 0 };
    const cal = await this.availability.calendarDays(user, [staffId], monthStart, today);
    const available = Object.values(cal.days).reduce((s, d) => s + (d[staffId]?.workable ?? []).reduce((a, w) => a + minutes(w.end) - minutes(w.start), 0), 0);
    const items = await this.prisma.appointmentItem.findMany({
      where: { staffId, startAt: { gte: localToUtc(monthStart, 0, tz), lt: localToUtc(addDays(today, 1), 0, tz) }, appointment: { deletedAt: null, status: { in: [...ACTIVE] } } },
      select: { durationMin: true },
    });
    return { today, completedThisMonth, occupancyMonthPct: pct(items.reduce((s, i) => s + i.durationMin, 0), available) };
  }
}
