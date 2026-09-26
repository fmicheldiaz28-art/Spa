import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { AuthUser } from '../../common/auth-user.js';
import { AppException } from '../../common/errors.js';
import { lastNameInitial } from '../../common/mask.js';
import { humanWhen } from '../../common/when.js';
import { env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { localDate } from '../availability/domain/time.js';
import { EventsService, type LiveEvent } from '../events/events.service.js';
import { encryptPayload, type PushSubscriptionKeys, vapidAuthorization } from './domain/web-push.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Ruta de la app que se abre al tocar la notificación. */
  url: string;
  /** Agrupa notificaciones de la misma cita (la nueva reemplaza a la anterior). */
  tag?: string;
}

/** Qué avisar según la última acción auditada de la cita. Las demás no generan notificación. */
const MESSAGES: Record<string, { staff?: string; admin?: string }> = {
  CREATE: { staff: 'Nueva cita', admin: 'Nueva reserva online' },
  OVERBOOKING: { staff: 'Nueva cita (sobre-turno)' },
  RESCHEDULE: { staff: 'Cita movida', admin: 'Una clienta reagendó online' },
  CANCEL: { staff: 'Cita cancelada', admin: 'Una clienta canceló online' },
  DELETE: { staff: 'Cita eliminada' },
  RESTORE: { staff: 'Cita restaurada' },
  CONFIRM_ATTENDANCE: { staff: 'La clienta confirmó asistencia' },
};
const HORIZON_MS = 30 * 86_400_000;
const MAX_FAILURES = 5;

/**
 * Notificaciones push (Fase 2, docs/09-ux-ui.md §582): avisos a las especialistas cuando les
 * asignan, mueven o cancelan una cita, y a administración cuando una clienta reserva, reagenda o
 * cancela online. Sin configurar VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY queda desactivado.
 */
@Injectable()
export class PushService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private subscription: Subscription | null = null;
  readonly enabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.enabled || env.NODE_ENV === 'test') return;
    this.subscription = this.events.stream.subscribe((e) => {
      if (e.type === 'appointment.changed' && e.appointmentId) void this.onAppointmentChanged(e).catch((err: unknown) => this.logger.warn(`Push: ${String(err)}`));
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  config() {
    return { enabled: this.enabled, publicKey: this.enabled ? env.VAPID_PUBLIC_KEY! : null };
  }

  async subscribe(user: AuthUser, sub: PushSubscriptionKeys, userAgent: string | null) {
    if (!this.enabled) throw new AppException(503, 'PUSH_DISABLED', 'Las notificaciones no están configuradas en el servidor');
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent },
      update: { userId: user.id, p256dh: sub.p256dh, auth: sub.auth, userAgent, failures: 0 },
    });
  }

  async unsubscribe(user: AuthUser, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
  }

  async sendToUsers(userIds: string[], message: PushMessage): Promise<number> {
    if (!this.enabled || !userIds.length) return 0;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(userIds)] } } });
    const results = await Promise.all(subs.map((s) => this.send(s, message)));
    return results.filter(Boolean).length;
  }

  /** Envía a un dispositivo. Borra la suscripción si el servicio push dice que ya no existe. */
  private async send(sub: { id: string; endpoint: string; p256dh: string; auth: string; failures: number }, message: PushMessage): Promise<boolean> {
    try {
      const body = encryptPayload(Buffer.from(JSON.stringify(message)), sub);
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await vapidAuthorization(sub.endpoint, { publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY! }, env.VAPID_SUBJECT),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '3600',
          Urgency: 'high',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) {
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
      await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date(), failures: 0 } });
      return true;
    } catch (err) {
      this.logger.warn(`Push a ${new URL(sub.endpoint).host} falló: ${String(err)}`);
      if (sub.failures + 1 >= MAX_FAILURES) await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
      else await this.prisma.pushSubscription.update({ where: { id: sub.id }, data: { failures: { increment: 1 } } }).catch(() => undefined);
      return false;
    }
  }

  private async onAppointmentChanged(e: LiveEvent) {
    const audit = await this.prisma.auditLog.findFirst({
      where: { entityType: 'Appointment', entityId: e.appointmentId },
      orderBy: { id: 'desc' },
      select: { action: true, actorType: true, actorUserId: true },
    });
    const texts = audit ? MESSAGES[audit.action] : undefined;
    if (!audit || !texts) return;
    const a = await this.prisma.appointment.findUnique({
      where: { id: e.appointmentId },
      include: { client: { select: { firstName: true, lastName: true } }, items: { orderBy: { startAt: 'asc' } }, branch: { select: { timezone: true } } },
    });
    if (!a) return;
    const now = Date.now();
    if (a.startAt.getTime() < now - 3_600_000 || a.startAt.getTime() > now + HORIZON_MS) return; // solo lo próximo
    const tz = a.branch.timezone;
    const when = humanWhen(a.startAt, new Date(now), tz);
    const client = `${a.client.firstName} ${lastNameInitial(a.client.lastName)}`.trim();
    const day = localDate(a.startAt, tz);
    const tag = `appointment-${a.id}`;

    // Especialistas de la cita (antes y después, si se movió de una a otra), menos quien hizo el cambio.
    if (texts.staff) {
      const staff = await this.prisma.staffProfile.findMany({ where: { id: { in: e.staffIds } }, select: { id: true, userId: true } });
      for (const s of staff) {
        if (!s.userId || s.userId === audit.actorUserId) continue;
        const services = a.items.filter((i) => i.staffId === s.id).map((i) => i.serviceName);
        await this.sendToUsers([s.userId], {
          title: texts.staff,
          body: `${when} · ${services.join(' + ') || a.items.map((i) => i.serviceName).join(' + ')} · ${client}`,
          url: day === localDate(new Date(now), tz) ? '/app/mi-dia' : `/app/agenda?view=day&date=${day}`,
          tag,
        });
      }
    }

    // Administración: solo lo que hacen las clientas online (lo demás lo hizo el propio equipo).
    if (texts.admin && audit.actorType === 'CLIENT') {
      const admins = await this.prisma.user.findMany({
        where: { organizationId: a.organizationId, status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { code: 'ADMIN' } } } },
        select: { id: true },
      });
      await this.sendToUsers(
        admins.map((u) => u.id),
        { title: texts.admin, body: `${when} · ${a.items.map((i) => i.serviceName).join(' + ')} · ${client}`, url: `/app/agenda?view=day&date=${day}`, tag },
      );
    }
  }
}
