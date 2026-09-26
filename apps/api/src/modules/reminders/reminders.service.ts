import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { env } from '../../config/env.js';
import { MailService } from '../../infrastructure/mail/mail.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { humanWhen } from '../../common/when.js';
import { ClientTokenService } from '../booking/client-token.service.js';
import { resolveSettings } from '../organization/settings.service.js';
import { textToHtml } from '../templates/domain/email-html.js';
import { TemplatesService } from '../templates/templates.service.js';
import { dueReminder, reminderSlots } from './domain/reminder-plan.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60_000;
const ACTIVE = ['PENDIENTE', 'CONFIRMADA'] as const;

/**
 * Recordatorios automáticos por email (Fase 2, CU-21). La tabla `notifications` es la cola:
 * 1) programar: una fila por cita, aviso y horario (índice único → idempotente);
 * 2) despachar: envía las filas vencidas, revalidando que la cita siga activa y en el mismo horario.
 * Sin Redis: funciona igual con una o varias instancias.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: ClientTokenService,
    private readonly templates: TemplatesService,
  ) {}

  onApplicationBootstrap() {
    if (env.NODE_ENV === 'test' || env.REMINDERS_INTERVAL_SEC === 0) return;
    this.timer = setInterval(() => void this.tick(), env.REMINDERS_INTERVAL_SEC * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.schedule(now);
      await this.dispatch(now);
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running = false;
    }
  }

  /** Programa los avisos que corresponden ahora. */
  private async schedule(now: Date) {
    const orgs = await this.prisma.organization.findMany({ select: { id: true, settings: true } });
    for (const org of orgs) {
      const { reminders } = resolveSettings(org.settings);
      // Por ahora solo email; WhatsApp requiere la plantilla aprobada por Meta (docs/10 §17).
      if (!reminders.enabled || !reminders.channels.includes('EMAIL')) continue;
      const slots = reminderSlots(reminders.hours_before);
      if (!slots.length) continue;
      const candidates = await this.prisma.appointment.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          status: { in: [...ACTIVE] },
          startAt: { gt: now, lte: new Date(now.getTime() + slots[0]!.hoursBefore * 3_600_000) },
          client: { deletedAt: null, email: { not: null }, remindersOptIn: true },
        },
        select: { id: true, startAt: true, createdAt: true, clientId: true, client: { select: { email: true } } },
      });
      for (const a of candidates) {
        const slot = dueReminder(a, now, slots);
        if (!slot) continue;
        const payload = JSON.stringify({ startAt: a.startAt.toISOString() });
        await this.prisma.$executeRaw`
          INSERT INTO notifications (organization_id, channel, template_code, recipient_client_id, recipient_address, appointment_id, payload, scheduled_at)
          VALUES (${org.id}::uuid, 'EMAIL', ${slot.code}, ${a.clientId}::uuid, ${a.client.email}, ${a.id}::uuid, ${payload}::jsonb, ${now})
          ON CONFLICT DO NOTHING`;
      }
    }
  }

  /** Envía los avisos vencidos. Cada fila se reclama con una actualización condicional. */
  private async dispatch(now: Date) {
    const due = await this.prisma.notification.findMany({
      where: { status: 'PROGRAMADA', scheduledAt: { lte: now }, templateCode: { startsWith: 'REMINDER_' }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    });
    for (const n of due) {
      const claimed = await this.prisma.notification.updateMany({ where: { id: n.id, status: 'PROGRAMADA', attempts: n.attempts }, data: { attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      try {
        const sent = await this.send(n.appointmentId, n.templateCode, (n.payload as { startAt?: string }).startAt, n.recipientAddress, now);
        await this.prisma.notification.update({
          where: { id: n.id },
          data: sent ? { status: 'ENVIADA', sentAt: new Date() } : { status: 'CANCELADA', lastError: 'La cita cambió o ya no está activa' },
        });
      } catch (err) {
        const attempts = n.attempts + 1;
        this.logger.warn(`Recordatorio ${n.id} falló (intento ${attempts}): ${String(err)}`);
        await this.prisma.notification.update({
          where: { id: n.id },
          data: attempts >= MAX_ATTEMPTS ? { status: 'FALLIDA', lastError: String(err) } : { lastError: String(err), scheduledAt: new Date(now.getTime() + RETRY_DELAY_MS) },
        });
      }
    }
  }

  /** Devuelve false si el aviso ya no aplica (cita cancelada, reagendada o por empezar). */
  private async send(appointmentId: string | null, _code: string, startAtIso: string | undefined, to: string | null, now: Date): Promise<boolean> {
    if (!appointmentId || !to) return false;
    const a = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        client: { select: { firstName: true } },
        items: { include: { staff: { select: { displayName: true } } }, orderBy: { startAt: 'asc' } },
        branch: true,
        organization: { select: { name: true } },
      },
    });
    if (!a || a.deletedAt || !(ACTIVE as readonly string[]).includes(a.status)) return false;
    if (a.startAt.toISOString() !== startAtIso || a.startAt <= now) return false;

    const branch = a.branch;
    const link = await this.tokens.signAppointmentLink(a.id, a.organizationId, a.endAt);
    const url = `${env.WEB_ORIGIN}/reservar/gestionar/${link}`;
    // Texto editable en Configuración → Mensajes (plantilla REMINDER_EMAIL).
    const { subject, text } = await this.templates.render(a.organizationId, 'REMINDER_EMAIL', {
      nombre: a.client.firstName,
      negocio: a.organization.name,
      cuando: humanWhen(a.startAt, now, branch.timezone),
      servicios: a.items.map((i) => `${i.serviceName} con ${i.staff.displayName}`).join(' + '),
      direccion: [branch.address, branch.city].filter(Boolean).join(', '),
      enlace: url,
    });
    const label = a.clientConfirmedAt ? 'Ver o cambiar mi reserva' : 'Confirmar asistencia';
    await this.mail.send({ to, subject: subject!, text, html: textToHtml(text, { url, label }) });
    return true;
  }
}
