import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { resolveBranch } from '../../common/org.js';
import { env } from '../../config/env.js';
import { MailService } from '../../infrastructure/mail/mail.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { addDays, localDate, localToUtc, utcToLocalMinutes } from '../availability/domain/time.js';
import { resolveSettings } from '../organization/settings.service.js';
import { isSendTime, previousWeek, renderWeeklyReport, type WeeklyStats } from './domain/weekly-report.js';

const CHECK_EVERY_MS = 10 * 60_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reporte semanal por email a las administradoras (Fase 2): cada lunes, las cifras de la semana
 * anterior. Usa `notifications` como registro: una fila por destinataria y semana (índice único).
 */
@Injectable()
export class WeeklyReportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WeeklyReportService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  onApplicationBootstrap() {
    if (env.NODE_ENV === 'test' || !env.WEEKLY_REPORT_ENABLED) return;
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5_000).unref(); // al arrancar, por si el API estuvo caído el lunes a la hora de envío
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.prisma.organization.findMany({ select: { id: true, name: true, settings: true } });
      for (const org of orgs) await this.forOrganization(org, now);
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running = false;
    }
  }

  private async forOrganization(org: { id: string; name: string; settings: unknown }, now: Date) {
    const { weekly_report: cfg } = resolveSettings(org.settings);
    if (!cfg.enabled) return;
    const branch = await resolveBranch(this.prisma, org.id);
    const today = localDate(now, branch.timezone);
    const hour = Math.floor(utcToLocalMinutes(now, today, branch.timezone) / 60);
    if (!isSendTime(today, hour, cfg.send_hour)) return;

    const week = previousWeek(today);
    const recipients = await this.prisma.user.findMany({
      where: { organizationId: org.id, status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { code: 'ADMIN' } } } },
      select: { id: true, email: true },
    });
    let report: ReturnType<typeof renderWeeklyReport> | null = null;
    for (const r of recipients) {
      const payload = JSON.stringify({ week: week.from });
      const inserted = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO notifications (organization_id, channel, template_code, recipient_user_id, recipient_address, payload, scheduled_at, attempts)
        VALUES (${org.id}::uuid, 'EMAIL', 'WEEKLY_REPORT', ${r.id}::uuid, ${r.email}, ${payload}::jsonb, ${now}, 1)
        ON CONFLICT DO NOTHING
        RETURNING id`;
      if (!inserted.length) continue; // ya enviado (o en curso) para esta semana
      try {
        report ??= renderWeeklyReport(await this.stats(org.id, branch.timezone, week), org.name, env.WEB_ORIGIN);
        await this.mail.send({ to: r.email, ...report });
        await this.prisma.notification.update({ where: { id: inserted[0]!.id }, data: { status: 'ENVIADA', sentAt: new Date() } });
      } catch (err) {
        this.logger.warn(`Reporte semanal a ${r.id} falló: ${String(err)}`);
        await this.prisma.notification.update({ where: { id: inserted[0]!.id }, data: { status: 'FALLIDA', lastError: String(err) } });
      }
    }
  }

  /** Cifras de una semana (fechas locales). También alimenta la vista previa del dashboard. */
  async stats(organizationId: string, tz: string, week: { from: string; to: string }): Promise<WeeklyStats> {
    const from = localToUtc(week.from, 0, tz);
    const to = localToUtc(addDays(week.to, 1), 0, tz);
    const prevFrom = localToUtc(addDays(week.from, -7), 0, tz);
    const nextTo = localToUtc(addDays(week.to, 8), 0, tz);
    const inWeek = { organizationId, deletedAt: null, startAt: { gte: from, lt: to } };

    const [groups, clientConfirmed, remindersSent, payments, prevPayments, newClients, top, nextWeek, seal] = await Promise.all([
      this.prisma.appointment.groupBy({ by: ['status', 'source'], where: inWeek, _count: true }),
      this.prisma.appointment.count({ where: { ...inWeek, clientConfirmedAt: { not: null } } }),
      this.prisma.notification.count({ where: { organizationId, OR: [{ templateCode: { startsWith: 'REMINDER_' } }, { templateCode: 'WHATSAPP_REMINDER' }], status: 'ENVIADA', sentAt: { gte: from, lt: to } } }),
      this.prisma.payment.findMany({ where: { organizationId, status: 'REGISTRADO', paidAt: { gte: from, lt: to } }, select: { amount: true, type: true } }),
      this.prisma.payment.findMany({ where: { organizationId, status: 'REGISTRADO', paidAt: { gte: prevFrom, lt: from } }, select: { amount: true, type: true } }),
      this.prisma.client.count({ where: { organizationId, deletedAt: null, createdAt: { gte: from, lt: to } } }),
      this.prisma.appointmentItem.groupBy({
        by: ['serviceName'],
        where: { organizationId, startAt: { gte: from, lt: to }, appointment: { deletedAt: null, status: 'COMPLETADA' } },
        _count: true,
        orderBy: { _count: { serviceName: 'desc' } },
        take: 3,
      }),
      this.prisma.appointment.count({ where: { organizationId, deletedAt: null, status: { in: ['PENDIENTE', 'CONFIRMADA'] }, startAt: { gte: to, lt: nextTo } } }),
      this.prisma.auditLog.findFirst({ where: { sealSeq: { not: null } }, orderBy: { sealSeq: 'desc' }, select: { sealSeq: true, hash: true } }),
    ]);
    const count = (pred: (g: (typeof groups)[number]) => boolean) => groups.filter(pred).reduce((s, g) => s + g._count, 0);
    const sum = (rows: typeof payments) => round2(rows.reduce((s, p) => s + (p.type === 'REEMBOLSO' ? -1 : 1) * Number(p.amount), 0));
    return {
      week,
      appointments: count(() => true),
      completed: count((g) => g.status === 'COMPLETADA'),
      noShow: count((g) => g.status === 'NO_SHOW'),
      cancelled: count((g) => g.status === 'CANCELADA'),
      online: count((g) => g.source === 'ONLINE'),
      clientConfirmed,
      remindersSent,
      revenue: sum(payments),
      prevRevenue: sum(prevPayments),
      newClients,
      topServices: top.map((t) => ({ name: t.serviceName, count: t._count })),
      nextWeekAppointments: nextWeek,
      auditSeal: seal?.sealSeq && seal.hash ? { seq: Number(seal.sealSeq), hash: Buffer.from(seal.hash).toString('hex') } : null,
    };
  }

  /** Vista previa para el dashboard: la semana anterior a `date` (o a hoy). */
  async preview(organizationId: string, orgName: string, date?: string) {
    const branch = await resolveBranch(this.prisma, organizationId);
    const week = previousWeek(date ?? localDate(new Date(), branch.timezone));
    const stats = await this.stats(organizationId, branch.timezone, week);
    return { stats, email: renderWeeklyReport(stats, orgName, env.WEB_ORIGIN) };
  }
}
