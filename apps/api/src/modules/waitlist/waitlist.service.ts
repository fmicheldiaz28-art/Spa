import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { AuthUser } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import { maskPhone } from '../../common/mask.js';
import { resolveBranch, resolveOrganizationId } from '../../common/org.js';
import { env } from '../../config/env.js';
import type { Prisma, WaitlistStatus } from '../../generated/prisma/client.js';
import { MailService } from '../../infrastructure/mail/mail.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { addDays, localDate, localToUtc, minutesToHHMM, minutesToTimeColumn, timeColumnToMinutes } from '../availability/domain/time.js';
import { EventsService } from '../events/events.service.js';
import { RENOTIFY_MS, shouldNotify, slotsInWindow } from './domain/waitlist.js';

const OPEN: WaitlistStatus[] = ['ACTIVA', 'NOTIFICADA'];
const CHECK_EVERY_MS = 10 * 60_000;
const DEBOUNCE_MS = 5_000;
const MAX_OPEN_PER_CLIENT = 3;

export interface WaitlistInput {
  clientId: string;
  serviceId: string;
  staffId?: string | null;
  date: string;
  /** Minutos del día; null = sin límite. */
  timeFrom?: number | null;
  timeTo?: number | null;
  notes?: string | null;
}

const include = {
  client: { select: { id: true, firstName: true, lastName: true, email: true, phoneE164: true } },
  service: { select: { id: true, name: true, durationMin: true } },
  staff: { select: { id: true, displayName: true } },
} satisfies Prisma.WaitlistEntryInclude;
type EntryRecord = Prisma.WaitlistEntryGetPayload<{ include: typeof include }>;

/** Identidad del proceso en segundo plano para consultar disponibilidad. */
const systemActor = (organizationId: string): AuthUser => ({
  id: '',
  email: '',
  firstName: 'Sistema',
  lastName: '',
  organizationId,
  roles: [],
  permissions: new Set(),
  staffId: null,
  clientId: null,
  sessionId: '',
  mustChangePassword: false,
  mfaSetupRequired: false,
});

/**
 * Lista de espera (Fase 2, docs/10 §17): cuando se libera un horario compatible, avisa por email.
 * Se revisa al cambiar una cita o un horario (evento en vivo, con pausa de 5 s) y cada 10 minutos.
 */
@Injectable()
export class WaitlistService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WaitlistService.name);
  private timer: NodeJS.Timeout | null = null;
  private subscription: Subscription | null = null;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly events: EventsService,
  ) {}

  onApplicationBootstrap() {
    if (env.NODE_ENV === 'test') return;
    this.subscription = this.events.stream.subscribe((e) => this.schedule(e.organizationId));
    this.timer = setInterval(() => void this.checkAll(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    if (this.timer) clearInterval(this.timer);
    for (const t of this.pending.values()) clearTimeout(t);
  }

  /** Agrupa ráfagas de cambios (p. ej. reagendar varias citas) en una sola revisión. */
  private schedule(organizationId: string) {
    clearTimeout(this.pending.get(organizationId));
    const t = setTimeout(() => {
      this.pending.delete(organizationId);
      void this.check(organizationId);
    }, DEBOUNCE_MS);
    t.unref();
    this.pending.set(organizationId, t);
  }

  private async checkAll() {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const o of orgs) await this.check(o.id);
  }

  // ------------------------------------------------------------------ administración

  async list(user: AuthUser, query: { from?: string; status?: 'open' | 'all' }) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const branch = await resolveBranch(this.prisma, organizationId);
    const today = localDate(new Date(), branch.timezone);
    const rows = await this.prisma.waitlistEntry.findMany({
      where: {
        organizationId,
        date: { gte: new Date(`${query.from ?? today}T00:00:00Z`) },
        ...(query.status !== 'all' && { status: { in: OPEN } }),
      },
      include,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 300,
    });
    const settings = await this.bookingSettings(organizationId);
    const cache = new Map<string, Promise<{ time: string; startAt: string }[]>>();
    return Promise.all(
      rows.map(async (e) => ({
        ...this.dto(e),
        // Horarios libres ahora mismo dentro de la preferencia: para llamar a quien no tiene email.
        freeSlots: OPEN.includes(e.status) ? slotsInWindow(await this.freeSlots(organizationId, e, settings, cache), this.window(e)).map((s) => s.time) : [],
      })),
    );
  }

  async create(user: AuthUser | null, organizationId: string, input: WaitlistInput, source: 'ONLINE' | 'ADMIN') {
    const branch = await resolveBranch(this.prisma, organizationId);
    if (input.date < localDate(new Date(), branch.timezone)) throw new AppException(422, 'PAST_DATE', 'Elige un día de hoy en adelante');
    if (input.timeFrom != null && input.timeTo != null && input.timeFrom >= input.timeTo) throw Errors.validation([{ field: 'timeTo', code: 'RANGE', message: 'La hora final debe ser posterior a la inicial' }]);
    const [client, service] = await Promise.all([
      this.prisma.client.findFirst({ where: { id: input.clientId, organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.service.findFirst({ where: { id: input.serviceId, organizationId, deletedAt: null, isActive: true }, select: { id: true, name: true } }),
    ]);
    if (!client || !service) throw Errors.notFound();
    if (input.staffId) {
      const offers = await this.prisma.staffService.findUnique({ where: { staffId_serviceId: { staffId: input.staffId, serviceId: input.serviceId } } });
      if (!offers) throw Errors.validation([{ field: 'staffId', code: 'NOT_OFFERED', message: 'Esa especialista no realiza este servicio' }]);
    }
    const open = await this.prisma.waitlistEntry.count({ where: { clientId: client.id, status: { in: OPEN } } });
    if (open >= MAX_OPEN_PER_CLIENT) throw new AppException(422, 'WAITLIST_LIMIT', `Ya tiene ${open} esperas activas`, 'Cancela alguna para anotarte en otra.');

    const clientName = `${client.firstName} ${client.lastName}`.trim();
    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const e = await tx.waitlistEntry.create({
          data: {
            organizationId,
            clientId: client.id,
            serviceId: service.id,
            staffId: input.staffId ?? null,
            date: new Date(`${input.date}T00:00:00Z`),
            timeFrom: input.timeFrom == null ? null : minutesToTimeColumn(input.timeFrom),
            timeTo: input.timeTo == null ? null : minutesToTimeColumn(input.timeTo),
            source,
            notes: input.notes ?? null,
            createdBy: user?.id || null,
          },
          include,
        });
        await this.audit.record(
          {
            action: 'CREATE',
            module: 'waitlist',
            ...(source === 'ONLINE' && { actor: { type: 'CLIENT' as const, name: clientName } }),
            organizationId,
            entity: { type: 'WaitlistEntry', id: e.id, label: `${clientName} · ${service.name} · ${input.date}` },
            newValues: { clienta: clientName, servicio: service.name, dia: input.date, origen: source },
          },
          tx,
        );
        return e;
      });
      this.schedule(organizationId); // por si ya hay lugar
      return this.dto(entry);
    } catch (err) {
      if (String(err).includes('ux_waitlist_open_client_day') || String(err).includes('P2002')) {
        throw new AppException(409, 'ALREADY_WAITING', 'Ya está en la lista de espera de ese día para este servicio');
      }
      throw err;
    }
  }

  async setStatus(user: AuthUser | null, organizationId: string, id: string, status: 'CANCELADA' | 'CONVERTIDA' | 'ACTIVA', actorName?: string) {
    const entry = await this.prisma.waitlistEntry.findFirst({ where: { id, organizationId }, include });
    if (!entry) throw Errors.notFound();
    if (entry.status === status) return this.dto(entry);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.waitlistEntry.update({ where: { id }, data: { status, updatedAt: new Date(), ...(status === 'ACTIVA' && { notifiedAt: null }) }, include });
      await this.audit.record(
        {
          action: status === 'CANCELADA' ? 'CANCEL' : 'UPDATE',
          module: 'waitlist',
          ...(!user && { actor: { type: 'CLIENT' as const, name: actorName ?? null } }),
          organizationId,
          entity: { type: 'WaitlistEntry', id, label: `${entry.client.firstName} · ${entry.service.name}` },
          oldValues: { estado: entry.status },
          newValues: { estado: status },
        },
        tx,
      );
      return u;
    });
    return this.dto(updated);
  }

  /** Esperas de una clienta verificada por email (portal "Mis reservas"). */
  async forClientEmail(organizationId: string, email: string) {
    const branch = await resolveBranch(this.prisma, organizationId);
    const rows = await this.prisma.waitlistEntry.findMany({
      where: { organizationId, client: { email, deletedAt: null }, date: { gte: new Date(`${addDays(localDate(new Date(), branch.timezone), -1)}T00:00:00Z`) } },
      include,
      orderBy: { date: 'asc' },
      take: 20,
    });
    return rows.map((e) => this.dto(e, true));
  }

  async cancelForClientEmail(organizationId: string, email: string, id: string) {
    const entry = await this.prisma.waitlistEntry.findFirst({ where: { id, organizationId, client: { email } }, include });
    if (!entry) throw Errors.notFound();
    return { ...(await this.setStatus(null, organizationId, id, 'CANCELADA', `${entry.client.firstName} ${entry.client.lastName}`.trim())), client: undefined };
  }

  // ------------------------------------------------------------------ detección de horarios liberados

  async check(organizationId: string, now = new Date()) {
    if (this.running.has(organizationId)) return this.schedule(organizationId); // vuelve a mirar al terminar
    this.running.add(organizationId);
    try {
      const branch = await resolveBranch(this.prisma, organizationId);
      const today = localDate(now, branch.timezone);
      await this.prisma.waitlistEntry.updateMany({
        where: { organizationId, status: { in: OPEN }, date: { lt: new Date(`${today}T00:00:00Z`) } },
        data: { status: 'VENCIDA', updatedAt: now },
      });
      const entries = await this.prisma.waitlistEntry.findMany({
        where: { organizationId, status: { in: OPEN }, date: { gte: new Date(`${today}T00:00:00Z`) } },
        include,
        orderBy: { createdAt: 'asc' }, // primero en anotarse, primero en enterarse
      });
      if (!entries.length) return;
      const settings = await this.bookingSettings(organizationId);
      const cache = new Map<string, Promise<{ time: string; startAt: string }[]>>();

      for (const e of entries) {
        const date = e.date.toISOString().slice(0, 10);
        if (await this.alreadyBooked(e, date, branch.timezone)) {
          await this.prisma.waitlistEntry.update({ where: { id: e.id }, data: { status: 'CONVERTIDA', updatedAt: now } });
          continue;
        }
        if (!e.client.email || !shouldNotify(e, now)) continue;
        const slots = slotsInWindow(await this.freeSlots(organizationId, e, settings, cache), this.window(e));
        if (!slots.length) continue;
        // Reclamo condicional: con varias instancias, solo una envía el aviso.
        const { count } = await this.prisma.waitlistEntry.updateMany({
          where: { id: e.id, status: { in: OPEN }, OR: [{ notifiedAt: null }, { notifiedAt: { lte: new Date(now.getTime() - RENOTIFY_MS) } }] },
          data: { status: 'NOTIFICADA', notifiedAt: now, notifyCount: { increment: 1 }, updatedAt: now },
        });
        if (!count) continue;
        await this.notify(e, date, slots.map((s) => s.time), organizationId).catch((err: unknown) => this.logger.warn(`Aviso de lista de espera ${e.id}: ${String(err)}`));
      }
    } catch (err) {
      this.logger.error(err);
    } finally {
      this.running.delete(organizationId);
    }
  }

  private async notify(e: EntryRecord, date: string, times: string[], organizationId: string) {
    const url = new URL('/reservar', env.WEB_ORIGIN);
    url.searchParams.set('servicio', e.serviceId);
    url.searchParams.set('fecha', date);
    if (e.staffId) url.searchParams.set('con', e.staffId);
    const day = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(e.date).replace(',', '');
    const shown = times.slice(0, 6).join(', ') + (times.length > 6 ? '…' : '');
    const subject = `¡Se liberó un horario el ${day}! · NaturalSpa`;
    const text = [
      `Hola ${e.client.firstName}:`,
      '',
      `Se liberó lugar para ${e.service.name}${e.staff ? ` con ${e.staff.displayName}` : ''} el ${day}.`,
      `Horarios disponibles ahora: ${shown}.`,
      '',
      `Resérvalo antes de que lo tome otra persona: ${url}`,
      '',
      'Te avisamos porque te anotaste en la lista de espera. NaturalSpa',
    ].join('\n');
    await this.mail.send({ to: e.client.email!, subject, text });
    await this.prisma.notification.create({
      data: {
        organizationId,
        channel: 'EMAIL',
        templateCode: 'WAITLIST_SLOT',
        recipientClientId: e.clientId,
        recipientAddress: e.client.email,
        payload: { entryId: e.id, date, times },
        status: 'ENVIADA',
        sentAt: new Date(),
        attempts: 1,
      },
    });
  }

  private async alreadyBooked(e: EntryRecord, date: string, tz: string) {
    const n = await this.prisma.appointment.count({
      where: {
        clientId: e.clientId,
        deletedAt: null,
        status: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA'] },
        startAt: { gte: localToUtc(date, 0, tz), lt: localToUtc(addDays(date, 1), 0, tz) },
        items: { some: { serviceId: e.serviceId } },
      },
    });
    return n > 0;
  }

  /** Online: mismas reglas que la reserva online (anticipación, especialistas visibles). Administración: todas. */
  private freeSlots(organizationId: string, e: EntryRecord, settings: { leadTimeMin: number }, cache: Map<string, Promise<{ time: string; startAt: string }[]>>) {
    const date = e.date.toISOString().slice(0, 10);
    const online = e.source === 'ONLINE';
    const key = `${e.serviceId}|${e.staffId ?? '*'}|${date}|${online}`;
    let p = cache.get(key);
    if (!p) {
      p = this.availability
        .slots(systemActor(organizationId), { serviceId: e.serviceId, staffId: e.staffId ?? undefined, date }, { onlineOnly: online, leadTimeMin: online ? settings.leadTimeMin : 0 })
        .then((r) => r.slots)
        .catch(() => []);
      cache.set(key, p);
    }
    return p;
  }

  private async bookingSettings(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    const booking = (org?.settings as { booking?: { min_lead_time_min?: number } } | null)?.booking;
    return { leadTimeMin: booking?.min_lead_time_min ?? 120 };
  }

  private window(e: { timeFrom: Date | null; timeTo: Date | null }) {
    return { from: e.timeFrom ? timeColumnToMinutes(e.timeFrom) : null, to: e.timeTo ? timeColumnToMinutes(e.timeTo) : null };
  }

  private dto(e: EntryRecord, forClient = false) {
    const w = this.window(e);
    return {
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      timeFrom: w.from === null ? null : minutesToHHMM(w.from),
      timeTo: w.to === null ? null : minutesToHHMM(w.to),
      status: e.status,
      source: e.source,
      notes: forClient ? undefined : e.notes,
      notifiedAt: e.notifiedAt?.toISOString() ?? null,
      notifyCount: e.notifyCount,
      createdAt: e.createdAt.toISOString(),
      service: e.service,
      staff: e.staff ? { id: e.staff.id, name: e.staff.displayName } : null,
      client: forClient
        ? undefined
        : { id: e.client.id, name: `${e.client.firstName} ${e.client.lastName}`.trim(), phone: maskPhone(e.client.phoneE164), hasEmail: !!e.client.email },
    };
  }
}
