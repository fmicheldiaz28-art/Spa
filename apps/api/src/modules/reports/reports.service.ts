import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { type AuthUser, can, displayName } from '../../common/auth-user.js';
import { Errors } from '../../common/errors.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { addDays, isoWeekday, localDate, localToUtc } from '../availability/domain/time.js';

export type ReportType = 'sales' | 'services' | 'clients' | 'staff' | 'cancellations';

interface Column {
  key: string;
  label: string;
  type?: 'money' | 'number' | 'pct' | 'text' | 'date';
}

export interface ReportTable {
  title: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
}

export interface Report {
  type: ReportType;
  period: { from: string; to: string };
  summary: { label: string; value: string | number; type?: Column['type'] }[];
  tables: ReportTable[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const WEEKDAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const METHOD = { EFECTIVO: 'Efectivo', QR: 'QR', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta', OTRO: 'Otro' } as Record<string, string>;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Reportes automáticos (docs/06-modulos.md M11). Exportación solo ADMIN y auditada. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  private async range(user: AuthUser, from: string, to: string) {
    const { organizationId, branch } = await this.availability.context(user);
    return { organizationId, branch, tz: branch.timezone, start: localToUtc(from, 0, branch.timezone), end: localToUtc(addDays(to, 1), 0, branch.timezone) };
  }

  async build(user: AuthUser, type: ReportType, from: string, to: string, staffId?: string): Promise<Report> {
    switch (type) {
      case 'sales':
        return this.sales(user, from, to);
      case 'services':
        return this.services(user, from, to);
      case 'clients':
        return this.clients(user, from, to);
      case 'staff':
        return this.staff(user, from, to, staffId);
      case 'cancellations':
        return this.cancellations(user, from, to);
    }
  }

  private async sales(user: AuthUser, from: string, to: string): Promise<Report> {
    const { organizationId, tz, start, end } = await this.range(user, from, to);
    const payments = await this.prisma.payment.findMany({
      where: { organizationId, status: 'REGISTRADO', paidAt: { gte: start, lt: end } },
      select: { amount: true, type: true, method: true, paidAt: true, appointmentId: true },
    });
    const sign = (t: string) => (t === 'REEMBOLSO' ? -1 : 1);
    const total = round2(payments.reduce((s, p) => s + sign(p.type) * Number(p.amount), 0));
    const byDay = new Map<string, { total: number; count: number }>();
    const byMethod = new Map<string, number>();
    for (const p of payments) {
      const d = localDate(p.paidAt, tz);
      const e = byDay.get(d) ?? { total: 0, count: 0 };
      e.total += sign(p.type) * Number(p.amount);
      e.count += 1;
      byDay.set(d, e);
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + sign(p.type) * Number(p.amount));
    }
    const tickets = new Set(payments.map((p) => p.appointmentId).filter(Boolean)).size;

    // Ingreso atribuido por colaboradora: precio de los servicios completados en el período.
    const items = await this.prisma.appointmentItem.findMany({
      where: { organizationId, startAt: { gte: start, lt: end }, appointment: { deletedAt: null, status: 'COMPLETADA' } },
      select: { price: true, staff: { select: { displayName: true } } },
    });
    const byStaff = new Map<string, { revenue: number; count: number }>();
    for (const i of items) {
      const e = byStaff.get(i.staff.displayName) ?? { revenue: 0, count: 0 };
      e.revenue += Number(i.price);
      e.count += 1;
      byStaff.set(i.staff.displayName, e);
    }

    return {
      type: 'sales',
      period: { from, to },
      summary: [
        { label: 'Total cobrado', value: total, type: 'money' },
        { label: 'Cobros', value: payments.length, type: 'number' },
        { label: 'Citas cobradas', value: tickets, type: 'number' },
        { label: 'Ticket promedio', value: tickets ? round2(total / tickets) : 0, type: 'money' },
      ],
      tables: [
        {
          title: 'Por día',
          columns: [{ key: 'date', label: 'Fecha', type: 'date' }, { key: 'count', label: 'Cobros', type: 'number' }, { key: 'total', label: 'Total', type: 'money' }],
          rows: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, e]) => ({ date, count: e.count, total: round2(e.total) })),
        },
        {
          title: 'Por método de pago',
          columns: [{ key: 'method', label: 'Método' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'pct', label: '% del total', type: 'pct' }],
          rows: [...byMethod.entries()].map(([m, v]) => ({ method: METHOD[m] ?? m, total: round2(v), pct: pct(v, total) })),
        },
        {
          title: 'Servicios completados por colaboradora',
          columns: [{ key: 'staff', label: 'Colaboradora' }, { key: 'count', label: 'Servicios', type: 'number' }, { key: 'revenue', label: 'Ingreso atribuido', type: 'money' }],
          rows: [...byStaff.entries()].sort(([, a], [, b]) => b.revenue - a.revenue).map(([staff, e]) => ({ staff, count: e.count, revenue: round2(e.revenue) })),
        },
      ],
    };
  }

  private async services(user: AuthUser, from: string, to: string): Promise<Report> {
    const { organizationId, start, end } = await this.range(user, from, to);
    const items = await this.prisma.appointmentItem.findMany({
      where: { organizationId, startAt: { gte: start, lt: end }, appointment: { deletedAt: null } },
      select: { serviceName: true, price: true, durationMin: true, appointment: { select: { status: true } } },
    });
    const map = new Map<string, { booked: number; completed: number; cancelled: number; noShow: number; revenue: number; minutes: number }>();
    for (const i of items) {
      const e = map.get(i.serviceName) ?? { booked: 0, completed: 0, cancelled: 0, noShow: 0, revenue: 0, minutes: 0 };
      e.booked += 1;
      if (i.appointment.status === 'COMPLETADA') {
        e.completed += 1;
        e.revenue += Number(i.price);
        e.minutes += i.durationMin;
      }
      if (i.appointment.status === 'CANCELADA') e.cancelled += 1;
      if (i.appointment.status === 'NO_SHOW') e.noShow += 1;
      map.set(i.serviceName, e);
    }
    const totalRevenue = [...map.values()].reduce((s, e) => s + e.revenue, 0);
    return {
      type: 'services',
      period: { from, to },
      summary: [
        { label: 'Servicios agendados', value: items.length, type: 'number' },
        { label: 'Ingreso de servicios completados', value: round2(totalRevenue), type: 'money' },
      ],
      tables: [
        {
          title: 'Ranking de servicios',
          columns: [
            { key: 'service', label: 'Servicio' },
            { key: 'booked', label: 'Agendados', type: 'number' },
            { key: 'completed', label: 'Completados', type: 'number' },
            { key: 'revenue', label: 'Ingreso', type: 'money' },
            { key: 'share', label: '% ingreso', type: 'pct' },
            { key: 'hours', label: 'Horas', type: 'number' },
            { key: 'cancelRate', label: '% cancelación', type: 'pct' },
          ],
          rows: [...map.entries()]
            .sort(([, a], [, b]) => b.booked - a.booked)
            .map(([service, e]) => ({
              service,
              booked: e.booked,
              completed: e.completed,
              revenue: round2(e.revenue),
              share: pct(e.revenue, totalRevenue),
              hours: round2(e.minutes / 60),
              cancelRate: pct(e.cancelled, e.booked),
            })),
        },
      ],
    };
  }

  private async clients(user: AuthUser, from: string, to: string): Promise<Report> {
    const { organizationId, start, end, tz } = await this.range(user, from, to);
    const [newClients, completed, inactive, payments] = await Promise.all([
      this.prisma.client.findMany({ where: { organizationId, deletedAt: null, createdAt: { gte: start, lt: end } }, select: { source: true } }),
      this.prisma.appointment.groupBy({ by: ['clientId'], where: { organizationId, deletedAt: null, status: 'COMPLETADA', startAt: { gte: start, lt: end } }, _count: true }),
      this.prisma.client.count({ where: { organizationId, deletedAt: null, lastVisitAt: { lt: localToUtc(addDays(localDate(new Date(), tz), -90), 0, tz) } } }),
      this.prisma.payment.groupBy({ by: ['clientId'], where: { organizationId, status: 'REGISTRADO', type: 'COBRO', paidAt: { gte: start, lt: end }, clientId: { not: null } }, _sum: { amount: true }, _count: true }),
    ]);
    const top = payments.sort((a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0)).slice(0, 20);
    const names = new Map(
      (await this.prisma.client.findMany({ where: { id: { in: top.map((t) => t.clientId!) } }, select: { id: true, firstName: true, lastName: true, visitsCount: true } })).map((c) => [c.id, c]),
    );
    const bySource = new Map<string, number>();
    for (const c of newClients) bySource.set(c.source ?? 'SIN DATO', (bySource.get(c.source ?? 'SIN DATO') ?? 0) + 1);
    return {
      type: 'clients',
      period: { from, to },
      summary: [
        { label: 'Clientas nuevas', value: newClients.length, type: 'number' },
        { label: 'Clientas atendidas', value: completed.length, type: 'number' },
        { label: 'Recurrentes (2+ visitas en el período)', value: completed.filter((c) => c._count >= 2).length, type: 'number' },
        { label: 'Inactivas (más de 90 días sin venir)', value: inactive, type: 'number' },
      ],
      tables: [
        {
          title: 'Clientas nuevas por origen',
          columns: [{ key: 'source', label: 'Origen' }, { key: 'count', label: 'Clientas', type: 'number' }],
          rows: [...bySource.entries()].map(([source, count]) => ({ source, count })),
        },
        {
          title: 'Top clientas por gasto en el período',
          columns: [{ key: 'client', label: 'Clienta' }, { key: 'payments', label: 'Cobros', type: 'number' }, { key: 'spent', label: 'Gasto', type: 'money' }, { key: 'visits', label: 'Visitas totales', type: 'number' }],
          rows: top.map((t) => {
            const c = names.get(t.clientId!);
            return { client: c ? `${c.firstName} ${c.lastName}`.trim() : '—', payments: t._count, spent: round2(Number(t._sum.amount ?? 0)), visits: c?.visitsCount ?? 0 };
          }),
        },
      ],
    };
  }

  private async staff(user: AuthUser, from: string, to: string, staffId?: string): Promise<Report> {
    const { organizationId, branch, start, end } = await this.range(user, from, to);
    // La especialista solo ve su propio reporte (RF-REP-08).
    const onlyStaff = can(user, 'reports.view_global') ? staffId : (user.staffId ?? '00000000-0000-0000-0000-000000000000');
    const staff = await this.prisma.staffProfile.findMany({
      where: { organizationId, branchId: branch.id, ...(onlyStaff ? { id: onlyStaff } : { isActive: true }) },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    const cal = await this.availability.calendarDays(user, staff.map((s) => s.id), from, to);
    const items = await this.prisma.appointmentItem.findMany({
      where: { organizationId, staffId: { in: staff.map((s) => s.id) }, startAt: { gte: start, lt: end }, appointment: { deletedAt: null } },
      select: { staffId: true, durationMin: true, price: true, appointment: { select: { status: true, source: true } } },
    });
    const global = can(user, 'reports.view_global');
    const rows = staff.map((s) => {
      const mine = items.filter((i) => i.staffId === s.id);
      const done = mine.filter((i) => i.appointment.status === 'COMPLETADA');
      const booked = mine.filter((i) => ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'].includes(i.appointment.status));
      const available = Object.values(cal.days).reduce((sum, d) => sum + (d[s.id]?.workable ?? []).reduce((a, w) => a + minutes(w.end) - minutes(w.start), 0), 0);
      return {
        staff: s.displayName,
        completed: done.length,
        hours: round2(done.reduce((a, i) => a + i.durationMin, 0) / 60),
        occupancy: pct(booked.reduce((a, i) => a + i.durationMin, 0), available),
        cancelled: mine.filter((i) => i.appointment.status === 'CANCELADA').length,
        noShow: mine.filter((i) => i.appointment.status === 'NO_SHOW').length,
        online: mine.filter((i) => i.appointment.source === 'ONLINE').length,
        ...(global && { revenue: round2(done.reduce((a, i) => a + Number(i.price), 0)) }),
      };
    });
    const columns: Column[] = [
      { key: 'staff', label: 'Colaboradora' },
      { key: 'completed', label: 'Atendidas', type: 'number' },
      { key: 'hours', label: 'Horas', type: 'number' },
      { key: 'occupancy', label: 'Ocupación', type: 'pct' },
      { key: 'cancelled', label: 'Canceladas', type: 'number' },
      { key: 'noShow', label: 'No asistió', type: 'number' },
      { key: 'online', label: 'Online', type: 'number' },
      ...(global ? [{ key: 'revenue', label: 'Ingreso', type: 'money' as const }] : []),
    ];
    return {
      type: 'staff',
      period: { from, to },
      summary: [
        { label: 'Citas atendidas', value: rows.reduce((s, r) => s + r.completed, 0), type: 'number' },
        { label: 'Horas de servicio', value: round2(rows.reduce((s, r) => s + r.hours, 0)), type: 'number' },
      ],
      tables: [{ title: global ? 'Desempeño por colaboradora' : 'Mi desempeño', columns, rows }],
    };
  }

  private async cancellations(user: AuthUser, from: string, to: string): Promise<Report> {
    const { organizationId, tz, start, end } = await this.range(user, from, to);
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId, deletedAt: null, startAt: { gte: start, lt: end } },
      select: { status: true, source: true, cancelReason: true, cancelledByType: true, startAt: true, items: { select: { serviceName: true }, take: 1 } },
    });
    const total = rows.length;
    const cancelled = rows.filter((r) => r.status === 'CANCELADA');
    const noShow = rows.filter((r) => r.status === 'NO_SHOW');
    const group = <T>(list: T[], key: (x: T) => string) => {
      const m = new Map<string, number>();
      for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
      return [...m.entries()].sort(([, a], [, b]) => b - a);
    };
    const lost = [...cancelled, ...noShow];
    return {
      type: 'cancellations',
      period: { from, to },
      summary: [
        { label: 'Citas del período', value: total, type: 'number' },
        { label: 'Canceladas', value: cancelled.length, type: 'number' },
        { label: '% cancelación', value: pct(cancelled.length, total), type: 'pct' },
        { label: 'No asistió', value: noShow.length, type: 'number' },
        { label: '% no-show', value: pct(noShow.length, rows.filter((r) => r.status === 'COMPLETADA').length + noShow.length), type: 'pct' },
      ],
      tables: [
        {
          title: 'Cancelaciones por motivo',
          columns: [{ key: 'reason', label: 'Motivo' }, { key: 'count', label: 'Citas', type: 'number' }],
          rows: group(cancelled, (r) => `${r.cancelReason ?? 'Sin motivo'} (${r.cancelledByType === 'CLIENTE' ? 'clienta' : 'spa'})`).map(([reason, count]) => ({ reason, count })),
        },
        {
          title: 'Canceladas y no-show por día de la semana',
          columns: [{ key: 'weekday', label: 'Día' }, { key: 'count', label: 'Citas', type: 'number' }],
          rows: group(lost, (r) => WEEKDAYS[isoWeekday(localDate(r.startAt, tz))]!).map(([weekday, count]) => ({ weekday, count })),
        },
        {
          title: 'Por servicio',
          columns: [{ key: 'service', label: 'Servicio' }, { key: 'count', label: 'Canceladas + no-show', type: 'number' }],
          rows: group(lost, (r) => r.items[0]?.serviceName ?? '—').map(([service, count]) => ({ service, count })),
        },
        {
          title: 'Por origen de la reserva',
          columns: [{ key: 'source', label: 'Origen' }, { key: 'count', label: 'Canceladas + no-show', type: 'number' }, { key: 'rate', label: '% de las citas de ese origen', type: 'pct' }],
          rows: group(lost, (r) => r.source).map(([source, count]) => ({ source, count, rate: pct(count, rows.filter((r) => r.source === source).length) })),
        },
      ],
    };
  }

  /** Exportación a Excel (RF-REP-06): auditada, con motivo y pie de "generado por". */
  async export(user: AuthUser, type: ReportType, from: string, to: string, reason: string) {
    if (!can(user, 'reports.export')) throw Errors.forbidden();
    const report = await this.build(user, type, from, to);
    const { organizationId } = await this.availability.context(user);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'NaturalSpa Manager';
    const titles: Record<ReportType, string> = { sales: 'Ventas', services: 'Servicios', clients: 'Clientes', staff: 'Personal', cancellations: 'Cancelaciones' };

    const summary = wb.addWorksheet('Resumen');
    summary.addRow([`Reporte de ${titles[type]} · ${from} a ${to}`]).font = { bold: true, size: 14 };
    summary.addRow([]);
    for (const s of report.summary) summary.addRow([s.label, s.value]);
    summary.addRow([]);
    summary.addRow([`Generado por ${displayName(user)} el ${new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}`]).font = { italic: true, color: { argb: 'FF6B7770' } };
    summary.getColumn(1).width = 44;
    summary.getColumn(2).width = 18;

    for (const t of report.tables) {
      const ws = wb.addWorksheet(t.title.slice(0, 31));
      ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E8E3' } };
      for (const r of t.rows) ws.addRow(r);
      t.columns.forEach((c, i) => {
        if (c.type === 'money') ws.getColumn(i + 1).numFmt = '"Bs" #,##0.00';
        if (c.type === 'pct') ws.getColumn(i + 1).numFmt = '0.0"%"';
      });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await this.prisma.$transaction(async (tx) => {
      await tx.exportJob.create({
        data: { organizationId, requestedBy: user.id, exportType: `REPORT_${type.toUpperCase()}`, filters: { from, to }, reason, format: 'XLSX', status: 'COMPLETADO', rowCount: report.tables.reduce((s, t) => s + t.rows.length, 0) },
      });
      await this.audit.record({ action: 'EXPORT', module: 'reports', entity: { type: 'Report', label: `${titles[type]} ${from} → ${to}` }, newValues: { formato: 'XLSX', filas: report.tables.reduce((s, t) => s + t.rows.length, 0) }, reason }, tx);
    });
    return { buffer, filename: `naturalspa-${type}-${from}_${to}.xlsx` };
  }
}
