import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AppointmentStatus } from '@naturalspa/shared';
import type { AuthUser } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import { buildIcs } from '../../common/ics.js';
import { lastNameInitial, maskEmail, maskPhone } from '../../common/mask.js';
import { env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { type Mail, MailService } from '../../infrastructure/mail/mail.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { nextStatus } from '../appointments/domain/appointment-state.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { pickLeastBusy } from '../availability/domain/availability.engine.js';
import { addDays, localDate, utcToLocalMinutes } from '../availability/domain/time.js';
import { HoldStore } from '../availability/hold-store.js';
import { EventsService } from '../events/events.service.js';
import { WaitlistService } from '../waitlist/waitlist.service.js';
import { ClientTokenService } from './client-token.service.js';

interface Settings {
  booking?: {
    enabled?: boolean;
    min_lead_time_min?: number;
    max_advance_days?: number;
    auto_confirm?: boolean;
    max_active_bookings_per_client?: number;
    hold_ttl_sec?: number;
  };
  cancellation?: { client_can_cancel_until_hours?: number; client_can_reschedule_until_hours?: number; max_reschedules_per_appointment?: number };
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  phone?: string;
  birthDate?: string | null;
  marketingOptIn?: boolean;
  remindersOptIn?: boolean;
}

export interface JoinWaitlistInput {
  serviceId: string;
  staffId?: string | null;
  date: string;
  timeFrom?: number | null;
  timeTo?: number | null;
  firstName: string;
  lastName: string;
  phone: string;
  privacyConsent: boolean;
  marketingOptIn?: boolean;
}

export interface ConfirmInput {
  holdId: string;
  token: string;
  firstName: string;
  lastName: string;
  phone: string;
  notes?: string | null;
  privacyConsent: boolean;
  marketingOptIn?: boolean;
}

/** Identidad para las lecturas públicas: resuelve la única organización (F1). */
const PUBLIC_ACTOR: AuthUser = {
  id: '',
  email: '',
  firstName: 'Reserva',
  lastName: 'online',
  organizationId: null,
  roles: [],
  permissions: new Set(),
  staffId: null,
  clientId: null,
  sessionId: '',
  mustChangePassword: false,
  mfaSetupRequired: false,
};

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const include = {
  client: { select: { id: true, firstName: true, lastName: true, email: true } },
  items: { include: { staff: { select: { id: true, displayName: true } } }, orderBy: { startAt: 'asc' } },
} satisfies Prisma.AppointmentInclude;
type AppointmentRecord = Prisma.AppointmentGetPayload<{ include: typeof include }>;

function isOverlapViolation(err: unknown): boolean {
  const text = `${String(err)} ${JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}))}`;
  return text.includes('23P01') || text.includes('ex_staff_no_overlap');
}

/** Reservas online sin intervención de administración (docs/06-modulos.md M9, CU-13/CU-14). */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly holds: HoldStore,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly tokens: ClientTokenService,
    private readonly events: EventsService,
    private readonly waitlist: WaitlistService,
  ) {}

  /** `requireBooking = false` para la gestión de citas ya existentes (siguen funcionando con reservas desactivadas). */
  private async ctx(requireBooking = true) {
    const c = await this.availability.context(PUBLIC_ACTOR);
    const settings = c.settings as Settings;
    if (requireBooking && settings.booking?.enabled === false) throw new AppException(503, 'BOOKING_DISABLED', 'Las reservas online están desactivadas temporalmente');
    return { ...c, settings };
  }

  // ------------------------------------------------------------------ catálogo

  async info() {
    const { organizationId, branch, settings } = await this.ctx();
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return {
      name: org.name,
      phone: org.phone ?? branch.phone,
      address: branch.address,
      city: branch.city,
      timezone: branch.timezone,
      policy: {
        minLeadTimeMin: settings.booking?.min_lead_time_min ?? 120,
        maxAdvanceDays: settings.booking?.max_advance_days ?? 60,
        cancelUntilHours: settings.cancellation?.client_can_cancel_until_hours ?? 12,
        rescheduleUntilHours: settings.cancellation?.client_can_reschedule_until_hours ?? 12,
        holdMinutes: Math.round((settings.booking?.hold_ttl_sec ?? 600) / 60),
      },
    };
  }

  async catalog() {
    const { organizationId, branch } = await this.ctx();
    const services = await this.prisma.service.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isActive: true,
        isOnlineBookable: true,
        staffServices: { some: { staff: { isActive: true, isBookableOnline: true, branchId: branch.id, user: { status: 'ACTIVE' } } } },
      },
      include: {
        category: { select: { id: true, name: true, color: true, sortOrder: true } },
        staffServices: {
          where: { staff: { isActive: true, isBookableOnline: true, branchId: branch.id, user: { status: 'ACTIVE' } } },
          select: { staff: { select: { id: true, displayName: true, color: true, photoUrl: true } } },
        },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      price: s.price.toFixed(2),
      imageUrl: s.imageUrl,
      category: { id: s.category.id, name: s.category.name, color: s.category.color },
      staff: s.staffServices.map((x) => ({ id: x.staff.id, name: x.staff.displayName, color: x.staff.color, photoUrl: x.staff.photoUrl })),
    }));
  }

  async days(serviceId: string, staffId: string | undefined, month: string) {
    const { settings } = await this.ctx();
    return this.availability.days(PUBLIC_ACTOR, serviceId, staffId, month, { onlineOnly: true, leadTimeMin: settings.booking?.min_lead_time_min ?? 120 });
  }

  async slots(serviceId: string, staffId: string | undefined, date: string) {
    const { settings } = await this.ctx();
    const r = await this.availability.slots(PUBLIC_ACTOR, { serviceId, staffId, date }, { onlineOnly: true, leadTimeMin: settings.booking?.min_lead_time_min ?? 120 });
    // Público: solo hora y nombres de pila (RF-RES-12).
    return { date: r.date, service: r.service, slots: r.slots.map((s) => ({ time: s.time, startAt: s.startAt, staff: s.staff.map((x) => ({ id: x.id, name: x.name })) })) };
  }

  // ------------------------------------------------------------------ retención

  async createHold(input: { serviceId: string; staffId?: string; startAt: Date }) {
    const { organizationId, branch, settings } = await this.ctx();
    const service = await this.availability.serviceWithStaff(organizationId, branch.id, input.serviceId, input.staffId, true);
    if (!service.staffServices.length) throw new AppException(422, 'NO_STAFF', 'Ese servicio no está disponible online');
    this.assertBookableWindow(input.startAt, branch.timezone, settings);

    const date = localDate(input.startAt, branch.timezone);
    const candidates = [];
    for (const s of service.staffServices) {
      const problem = await this.availability.checkSlot(branch, s.staffId, input.startAt, service.durationMin, service.bufferAfterMin);
      if (!problem) candidates.push(s.staffId);
    }
    if (!candidates.length) throw new AppException(409, 'SLOT_TAKEN', 'Ese horario ya no está disponible', 'Elige otro horario.');

    // "Sin preferencia": la colaboradora con menos carga ese día (reparto justo, docs §7.7).
    const day = (await this.availability.loadDays(branch, candidates, date, date)).get(date)!;
    const staffId = input.staffId ?? pickLeastBusy(candidates, candidates.map((id) => day.staff.get(id)!))!;
    const staff = service.staffServices.find((s) => s.staffId === staffId)!;
    const blockedUntil = new Date(input.startAt.getTime() + (service.durationMin + service.bufferAfterMin) * 60_000);
    const hold = this.holds.create({ serviceId: service.id, staffId, startAt: input.startAt, blockedUntil }, (settings.booking?.hold_ttl_sec ?? 600) * 1000);

    return {
      holdId: hold.id,
      expiresAt: new Date(hold.expiresAt).toISOString(),
      startAt: input.startAt.toISOString(),
      service: { id: service.id, name: service.name, durationMin: service.durationMin, price: Number(staff.customPrice ?? service.price).toFixed(2) },
      staff: { id: staffId, name: staff.staff.displayName },
    };
  }

  releaseHold(id: string) {
    this.holds.release(id);
  }

  // ------------------------------------------------------------------ verificación por código

  async sendCode(email: string) {
    const { organizationId } = await this.ctx();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.verificationCode.updateMany({ where: { target: email, purpose: 'BOOKING_VERIFY', consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.verificationCode.create({
      data: { target: email, purpose: 'BOOKING_VERIFY', codeHash: sha(`${organizationId}:${code}`), expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    await this.mail.send({
      to: email,
      subject: `Tu código de NaturalSpa: ${code}`,
      text: `Tu código para reservar en NaturalSpa es ${code}. Vence en 10 minutos.\n\nSi no lo pediste, ignora este mensaje.`,
    });
  }

  async checkCode(email: string, code: string) {
    const { organizationId } = await this.ctx();
    const record = await this.prisma.verificationCode.findFirst({
      where: { target: email, purpose: 'BOOKING_VERIFY', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.attempts >= 5) throw new AppException(422, 'INVALID_CODE', 'El código venció o ya no es válido', 'Pide uno nuevo.');
    if (record.codeHash !== sha(`${organizationId}:${code}`)) {
      await this.prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new AppException(422, 'INVALID_CODE', 'El código no es correcto');
    }
    await this.prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    const client = await this.prisma.client.findFirst({ where: { organizationId, email, deletedAt: null, mergedIntoId: null } });
    return {
      token: await this.tokens.sign(email, organizationId),
      // Prellenado para clientas que ya existen (datos propios, verificados por su email).
      client: client ? { firstName: client.firstName, lastName: client.lastName, hasPhone: !!client.phoneE164 } : null,
    };
  }

  // ------------------------------------------------------------------ confirmación

  async confirm(input: ConfirmInput) {
    const { organizationId, branch, settings } = await this.ctx();
    const identity = await this.tokens.verify(input.token);
    if (!identity || identity.organizationId !== organizationId) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    if (!input.privacyConsent) throw Errors.validation([{ field: 'privacyConsent', code: 'REQUIRED', message: 'Debes aceptar la política de privacidad' }]);
    const hold = this.holds.get(input.holdId);
    if (!hold) throw new AppException(410, 'HOLD_EXPIRED', 'El horario se liberó', 'Elige nuevamente.');

    const email = identity.email;
    const client = await this.findOrCreateClient(organizationId, email, input);

    const maxActive = settings.booking?.max_active_bookings_per_client ?? 3;
    const active = await this.prisma.appointment.count({
      where: { clientId: client.id, deletedAt: null, status: { in: ['PENDIENTE', 'CONFIRMADA'] }, startAt: { gt: new Date() } },
    });
    if (active >= maxActive) throw new AppException(422, 'TOO_MANY_BOOKINGS', `Ya tienes ${active} reservas activas`, 'Cancela o espera a que pase alguna para reservar otra.');

    const service = await this.prisma.service.findUniqueOrThrow({ where: { id: hold.serviceId } });
    const staffService = await this.prisma.staffService.findUniqueOrThrow({
      where: { staffId_serviceId: { staffId: hold.staffId, serviceId: hold.serviceId } },
      include: { staff: { select: { displayName: true } } },
    });
    const problem = await this.availability.checkSlot(branch, hold.staffId, hold.startAt, service.durationMin, service.bufferAfterMin, undefined, hold.id);
    if (problem) {
      this.holds.release(hold.id);
      throw new AppException(409, 'SLOT_TAKEN', 'Ese horario ya no está disponible', 'Elige otro horario.');
    }

    const price = Number(staffService.customPrice ?? service.price);
    const endAt = new Date(hold.startAt.getTime() + service.durationMin * 60_000);
    const manageToken = randomBytes(24).toString('base64url');
    const status: AppointmentStatus = settings.booking?.auto_confirm === false ? 'PENDIENTE' : 'CONFIRMADA';
    const clientName = `${client.firstName} ${client.lastName}`.trim();

    let appointment: AppointmentRecord;
    try {
      appointment = await this.prisma.$transaction(async (tx) => {
        const a = await tx.appointment.create({
          data: {
            organizationId,
            branchId: branch.id,
            clientId: client.id,
            status,
            source: 'ONLINE',
            startAt: hold.startAt,
            endAt,
            subtotal: price,
            total: price,
            clientNotes: input.notes ?? null,
            confirmedAt: status === 'CONFIRMADA' ? new Date() : null,
            manageTokenHash: sha(manageToken),
            items: {
              create: {
                organizationId,
                serviceId: service.id,
                staffId: hold.staffId,
                startAt: hold.startAt,
                endAt,
                blockedUntil: hold.blockedUntil,
                serviceName: service.name,
                durationMin: service.durationMin,
                price,
              },
            },
            statusHistory: { create: { toStatus: status, actorType: 'CLIENT' } },
          },
          include,
        });
        await this.audit.record(
          {
            action: 'CREATE',
            module: 'appointments',
            actor: { type: 'CLIENT', name: clientName },
            organizationId,
            entity: { type: 'Appointment', id: a.id, label: a.code },
            newValues: { clienta: clientName, servicios: `${service.name} · ${staffService.staff.displayName} · ${hold.startAt.toISOString()}`, origen: 'ONLINE', total: price.toFixed(2) },
          },
          tx,
        );
        return a;
      });
    } catch (err) {
      if (isOverlapViolation(err)) throw new AppException(409, 'SLOT_TAKEN', 'Ese horario acaba de ser tomado', 'Elige otro horario.');
      throw err;
    } finally {
      this.holds.release(hold.id);
    }

    this.events.appointmentChanged(organizationId, appointment.id, [hold.staffId]);
    const manageUrl = `${env.WEB_ORIGIN}/reservar/gestionar/${manageToken}`;
    this.notify(email, `Reserva ${status === 'CONFIRMADA' ? 'confirmada' : 'recibida'} · ${appointment.code}`, [
      `Hola ${client.firstName}:`,
      '',
      status === 'CONFIRMADA' ? 'Tu reserva en NaturalSpa está confirmada.' : 'Recibimos tu reserva; te confirmaremos pronto.',
      `${service.name} con ${staffService.staff.displayName}`,
      `${this.formatLocal(hold.startAt, branch.timezone)}`,
      `Total: Bs ${price.toFixed(2)} (pago en el spa)`,
      '',
      `Para ver, reagendar o cancelar tu reserva: ${manageUrl}`,
    ], [
      {
        filename: 'reserva-naturalspa.ics',
        contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
        content: buildIcs({
          uid: `${appointment.id}@naturalspa`,
          start: hold.startAt,
          end: endAt,
          summary: `${service.name} · NaturalSpa`,
          description: `Con ${staffService.staff.displayName}. Código ${appointment.code}.`,
          location: [branch.address, branch.city].filter(Boolean).join(', ') || undefined,
          url: manageUrl,
        }),
      },
    ]);

    return { ...this.publicDto(appointment, branch.timezone, settings), manageToken };
  }

  // ------------------------------------------------------------------ perfil de la clienta

  private async ownClient(clientToken: string | undefined) {
    const identity = await this.tokens.verify(clientToken);
    if (!identity) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    const client = await this.prisma.client.findFirst({
      where: { organizationId: identity.organizationId, email: identity.email, deletedAt: null, mergedIntoId: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!client) throw new AppException(404, 'NO_PROFILE', 'Aún no tienes datos guardados', 'Se crean con tu primera reserva.');
    return client;
  }

  private profileDto(c: { firstName: string; lastName: string; email: string | null; phoneE164: string | null; birthDate: Date | null; marketingOptIn: boolean; remindersOptIn: boolean }) {
    return {
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phoneE164,
      birthDate: c.birthDate?.toISOString().slice(0, 10) ?? null,
      marketingOptIn: c.marketingOptIn,
      remindersOptIn: c.remindersOptIn,
    };
  }

  /** Sus propios datos (email verificado). Es su información: se muestra completa. */
  async myProfile(clientToken: string | undefined) {
    return this.profileDto(await this.ownClient(clientToken));
  }

  async updateMyProfile(clientToken: string | undefined, patch: ProfilePatch) {
    const c = await this.ownClient(clientToken);
    const data = Object.fromEntries(
      Object.entries({
        firstName: patch.firstName,
        lastName: patch.lastName,
        phoneE164: patch.phone,
        birthDate: patch.birthDate === undefined ? undefined : patch.birthDate ? new Date(`${patch.birthDate}T00:00:00Z`) : null,
        marketingOptIn: patch.marketingOptIn,
        remindersOptIn: patch.remindersOptIn,
      }).filter(([, v]) => v !== undefined),
    );
    const before = this.profileDto(c);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.client.update({ where: { id: c.id }, data });
      if (patch.marketingOptIn !== undefined && patch.marketingOptIn !== c.marketingOptIn) {
        await tx.clientConsent.create({ data: { clientId: c.id, consentType: 'MARKETING', granted: patch.marketingOptIn, channel: 'ONLINE' } });
      }
      const after = this.profileDto(u);
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => after[k] !== before[k]);
      if (changed.length) {
        await this.audit.record(
          {
            action: 'UPDATE',
            module: 'clients',
            actor: { type: 'CLIENT', name: `${u.firstName} ${u.lastName}`.trim() },
            organizationId: c.organizationId,
            entity: { type: 'Client', id: c.id, label: `${u.firstName} ${u.lastName}`.trim() },
            oldValues: Object.fromEntries(changed.map((k) => [k, k === 'phone' ? maskPhone(before.phone) : before[k]])),
            newValues: Object.fromEntries(changed.map((k) => [k, k === 'phone' ? maskPhone(after.phone) : after[k]])),
            reason: 'Actualizado por la clienta desde Mis reservas',
          },
          tx,
        );
      }
      return u;
    });
    return this.profileDto(updated);
  }

  // ------------------------------------------------------------------ lista de espera

  /** La clienta (email verificado) se anota para un día sin horarios que le sirvan. */
  async joinWaitlist(clientToken: string | undefined, input: JoinWaitlistInput) {
    const identity = await this.tokens.verify(clientToken);
    if (!identity) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    if (!input.privacyConsent) throw Errors.validation([{ field: 'privacyConsent', code: 'REQUIRED', message: 'Debes aceptar la política de privacidad' }]);
    const { organizationId, branch, settings } = await this.ctx();
    this.assertWaitlistDate(input.date, branch.timezone, settings);
    const service = await this.availability.serviceWithStaff(organizationId, branch.id, input.serviceId, input.staffId ?? undefined, true);
    if (!service.staffServices.length) throw new AppException(422, 'NO_STAFF', 'Ese servicio no está disponible online');
    const client = await this.findOrCreateClient(organizationId, identity.email, input);
    return this.waitlist.create(null, organizationId, { ...input, clientId: client.id, notes: null }, 'ONLINE');
  }

  async myWaitlist(clientToken: string | undefined) {
    const identity = await this.tokens.verify(clientToken);
    if (!identity) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    return this.waitlist.forClientEmail(identity.organizationId, identity.email);
  }

  async leaveWaitlist(clientToken: string | undefined, id: string) {
    const identity = await this.tokens.verify(clientToken);
    if (!identity) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    return this.waitlist.cancelForClientEmail(identity.organizationId, identity.email, id);
  }

  private assertWaitlistDate(date: string, tz: string, settings: Settings) {
    const today = localDate(new Date(), tz);
    const maxDays = settings.booking?.max_advance_days ?? 60;
    if (date < today) throw new AppException(422, 'PAST_DATE', 'Elige un día de hoy en adelante');
    if (date > addDays(today, maxDays)) throw new AppException(422, 'TOO_FAR', `Puedes anotarte hasta ${maxDays} días adelante`);
  }

  // ------------------------------------------------------------------ autogestión

  /** Acepta el enlace del email de confirmación (token opaco) o el firmado de los recordatorios (JWT). */
  private async byManageToken(token: string) {
    const { organizationId } = await this.ctx(false);
    const link = token.includes('.') ? await this.tokens.verifyAppointmentLink(token) : null;
    if (token.includes('.') && (!link || link.organizationId !== organizationId)) throw Errors.notFound();
    const a = await this.prisma.appointment.findFirst({
      where: { organizationId, deletedAt: null, ...(link ? { id: link.appointmentId } : { manageTokenHash: sha(token) }) },
      include,
    });
    if (!a) throw Errors.notFound();
    return a;
  }

  private async byClient(clientToken: string | undefined, appointmentId: string) {
    const identity = await this.tokens.verify(clientToken);
    if (!identity) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    const a = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId: identity.organizationId, deletedAt: null, client: { email: identity.email } },
      include,
    });
    if (!a) throw Errors.notFound();
    return a;
  }

  async manage(token: string) {
    const { branch, settings } = await this.ctx(false);
    return this.publicDto(await this.byManageToken(token), branch.timezone, settings);
  }

  /** "Confirmo mi asistencia" desde el recordatorio (CU-21). Idempotente; no cambia el estado de la cita. */
  async confirmAttendance(ref: { manageToken?: string; clientToken?: string; appointmentId?: string }) {
    const a = ref.manageToken ? await this.byManageToken(ref.manageToken) : await this.byClient(ref.clientToken, ref.appointmentId!);
    const { branch, settings } = await this.ctx(false);
    if (a.clientConfirmedAt) return this.publicDto(a, branch.timezone, settings);
    if (!this.policy(a, settings).canConfirm) throw new AppException(422, 'CONFIRMATION_NOT_ALLOWED', 'Esta reserva ya no se puede confirmar');
    const clientName = `${a.client.firstName} ${a.client.lastName}`.trim();
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({ where: { id: a.id }, data: { clientConfirmedAt: new Date(), version: { increment: 1 } }, include });
      await tx.appointmentStatusHistory.create({ data: { appointmentId: a.id, fromStatus: a.status, toStatus: a.status, actorType: 'CLIENT', reason: 'Asistencia confirmada por la clienta' } });
      await this.audit.record(
        {
          action: 'CONFIRM_ATTENDANCE',
          module: 'appointments',
          actor: { type: 'CLIENT', name: clientName },
          organizationId: a.organizationId,
          entity: { type: 'Appointment', id: a.id, label: a.code },
          newValues: { asistenciaConfirmada: true },
        },
        tx,
      );
      return u;
    });
    this.events.appointmentChanged(a.organizationId, a.id, a.items.map((i) => i.staffId));
    return this.publicDto(updated, branch.timezone, settings);
  }

  /** Mis reservas (portal con email verificado). */
  async myAppointments(clientToken: string | undefined) {
    const identity = await this.tokens.verify(clientToken);
    if (!identity) throw new AppException(401, 'UNVERIFIED', 'Verifica tu email para continuar');
    const { branch, settings } = await this.ctx();
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: identity.organizationId, deletedAt: null, client: { email: identity.email } },
      include,
      orderBy: { startAt: 'desc' },
      take: 50,
    });
    return rows.map((a) => this.publicDto(a, branch.timezone, settings));
  }

  async cancel(ref: { manageToken?: string; clientToken?: string; appointmentId?: string }) {
    const a = ref.manageToken ? await this.byManageToken(ref.manageToken) : await this.byClient(ref.clientToken, ref.appointmentId!);
    const { branch, settings } = await this.ctx();
    const policy = this.policy(a, settings);
    if (!policy.canCancel) {
      throw new AppException(422, 'CANCELLATION_WINDOW_EXPIRED', `Solo puedes cancelar hasta ${policy.cancelUntilHours} horas antes`, 'Escríbenos por WhatsApp para ayudarte.');
    }
    const to = nextStatus(a.status as AppointmentStatus, 'cancel')!;
    const clientName = `${a.client.firstName} ${a.client.lastName}`.trim();
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({
        where: { id: a.id },
        data: { status: to, cancelledAt: new Date(), cancelledByType: 'CLIENTE', cancelReason: 'Cancelada por la clienta (online)', version: { increment: 1 } },
        include,
      });
      await tx.appointmentStatusHistory.create({ data: { appointmentId: a.id, fromStatus: a.status, toStatus: to, actorType: 'CLIENT', reason: 'Cancelada online' } });
      await this.audit.record(
        {
          action: 'CANCEL',
          module: 'appointments',
          actor: { type: 'CLIENT', name: clientName },
          organizationId: a.organizationId,
          entity: { type: 'Appointment', id: a.id, label: a.code },
          oldValues: { status: a.status },
          newValues: { status: to, canceladaPor: 'CLIENTE' },
          reason: 'Cancelada por la clienta (online)',
        },
        tx,
      );
      return u;
    });
    this.events.appointmentChanged(a.organizationId, a.id, a.items.map((i) => i.staffId));
    if (a.client.email) this.notify(a.client.email, `Reserva cancelada · ${a.code}`, [`Hola ${a.client.firstName}:`, '', `Cancelamos tu reserva del ${this.formatLocal(a.startAt, branch.timezone)}.`, 'Te esperamos cuando quieras volver.']);
    return this.publicDto(updated, branch.timezone, settings);
  }

  async reschedule(ref: { manageToken?: string; clientToken?: string; appointmentId?: string }, startAt: Date) {
    const a = ref.manageToken ? await this.byManageToken(ref.manageToken) : await this.byClient(ref.clientToken, ref.appointmentId!);
    const { branch, settings } = await this.ctx();
    const policy = this.policy(a, settings);
    if (!policy.canReschedule) {
      throw new AppException(422, 'RESCHEDULE_NOT_ALLOWED', 'Esta reserva ya no se puede reagendar online', 'Escríbenos por WhatsApp para ayudarte.');
    }
    this.assertBookableWindow(startAt, branch.timezone, settings);
    const item = a.items[0]!;
    const service = await this.prisma.service.findUniqueOrThrow({ where: { id: item.serviceId } });
    const problem = await this.availability.checkSlot(branch, item.staffId, startAt, item.durationMin, service.bufferAfterMin, a.id);
    if (problem) throw new AppException(409, 'SLOT_TAKEN', 'Ese horario no está disponible', 'Elige otro horario.');

    const endAt = new Date(startAt.getTime() + item.durationMin * 60_000);
    const clientName = `${a.client.firstName} ${a.client.lastName}`.trim();
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.appointmentItem.update({ where: { id: item.id }, data: { startAt, endAt, blockedUntil: new Date(endAt.getTime() + service.bufferAfterMin * 60_000) } });
        const u = await tx.appointment.update({ where: { id: a.id }, data: { startAt, endAt, clientConfirmedAt: null, rescheduleCount: { increment: 1 }, version: { increment: 1 } }, include });
        await tx.appointmentStatusHistory.create({
          data: { appointmentId: a.id, fromStatus: a.status, toStatus: a.status, actorType: 'CLIENT', reason: 'Reagendada online', metadata: { antes: a.startAt.toISOString(), despues: startAt.toISOString() } },
        });
        await this.audit.record(
          {
            action: 'RESCHEDULE',
            module: 'appointments',
            actor: { type: 'CLIENT', name: clientName },
            organizationId: a.organizationId,
            entity: { type: 'Appointment', id: a.id, label: a.code },
            oldValues: { inicio: a.startAt.toISOString() },
            newValues: { inicio: startAt.toISOString() },
            reason: 'Reagendada por la clienta (online)',
          },
          tx,
        );
        return u;
      });
      this.events.appointmentChanged(a.organizationId, a.id, [item.staffId]);
      if (a.client.email) this.notify(a.client.email, `Reserva reagendada · ${a.code}`, [`Hola ${a.client.firstName}:`, '', `Tu reserva quedó para el ${this.formatLocal(startAt, branch.timezone)}.`]);
      return this.publicDto(updated, branch.timezone, settings);
    } catch (err) {
      if (isOverlapViolation(err)) throw new AppException(409, 'SLOT_TAKEN', 'Ese horario acaba de ser tomado', 'Elige otro horario.');
      throw err;
    }
  }

  // ------------------------------------------------------------------ apoyo

  private policy(a: { status: string; startAt: Date; rescheduleCount: number }, settings: Settings) {
    // canConfirm: la clienta puede confirmar asistencia mientras la cita esté activa y no haya empezado.
    const cancelUntilHours = settings.cancellation?.client_can_cancel_until_hours ?? 12;
    const rescheduleUntilHours = settings.cancellation?.client_can_reschedule_until_hours ?? 12;
    const maxReschedules = settings.cancellation?.max_reschedules_per_appointment ?? 2;
    const hoursLeft = (a.startAt.getTime() - Date.now()) / 3_600_000;
    const open = a.status === 'CONFIRMADA' || a.status === 'PENDIENTE';
    return {
      canConfirm: open && hoursLeft > 0,
      canCancel: open && hoursLeft >= cancelUntilHours,
      canReschedule: open && hoursLeft >= rescheduleUntilHours && a.rescheduleCount < maxReschedules,
      cancelUntilHours,
      rescheduleUntilHours,
    };
  }

  private publicDto(a: AppointmentRecord, tz: string, settings: Settings) {
    const item = a.items[0]!;
    return {
      id: a.id,
      code: a.code,
      status: a.status,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      localDate: localDate(a.startAt, tz),
      localTime: `${String(Math.floor(utcToLocalMinutes(a.startAt, localDate(a.startAt, tz), tz) / 60)).padStart(2, '0')}:${String(utcToLocalMinutes(a.startAt, localDate(a.startAt, tz), tz) % 60).padStart(2, '0')}`,
      service: { id: item.serviceId, name: item.serviceName, durationMin: item.durationMin },
      staff: { id: item.staff.id, name: item.staff.displayName },
      total: a.total.toFixed(2),
      clientConfirmedAt: a.clientConfirmedAt?.toISOString() ?? null,
      client: { firstName: a.client.firstName, lastName: lastNameInitial(a.client.lastName), email: maskEmail(a.client.email) },
      ...this.policy(a, settings),
    };
  }

  private assertBookableWindow(startAt: Date, tz: string, settings: Settings) {
    const lead = settings.booking?.min_lead_time_min ?? 120;
    const maxDays = settings.booking?.max_advance_days ?? 60;
    if (startAt.getTime() < Date.now() + lead * 60_000) {
      throw new AppException(422, 'TOO_SOON', `Reserva con al menos ${Math.round(lead / 60)} horas de anticipación`);
    }
    if (localDate(startAt, tz) > addDays(localDate(new Date(), tz), maxDays)) {
      throw new AppException(422, 'TOO_FAR', `Puedes reservar hasta ${maxDays} días adelante`);
    }
  }

  /** Busca la ficha por email (o teléfono); si existe no pisa sus datos, solo completa vacíos. */
  private async findOrCreateClient(organizationId: string, email: string, input: Pick<ConfirmInput, 'firstName' | 'lastName' | 'phone' | 'marketingOptIn'>) {
    const existing =
      (await this.prisma.client.findFirst({ where: { organizationId, email, deletedAt: null, mergedIntoId: null } })) ??
      (await this.prisma.client.findFirst({ where: { organizationId, phoneE164: input.phone, deletedAt: null, mergedIntoId: null } }));
    if (existing) {
      const fill: Prisma.ClientUpdateInput = {};
      if (!existing.email) fill.email = email;
      if (!existing.phoneE164) fill.phoneE164 = input.phone;
      if (Object.keys(fill).length) await this.prisma.client.update({ where: { id: existing.id }, data: fill });
      await this.prisma.clientConsent.create({ data: { clientId: existing.id, consentType: 'PRIVACY_POLICY', granted: true, policyVersion: '1.0', channel: 'ONLINE' } });
      return existing;
    }
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.client.create({
        data: {
          organizationId,
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phoneE164: input.phone,
          source: 'ONLINE',
          marketingOptIn: input.marketingOptIn ?? false,
          consents: {
            create: [
              { consentType: 'PRIVACY_POLICY', granted: true, policyVersion: '1.0', channel: 'ONLINE' },
              ...(input.marketingOptIn ? [{ consentType: 'MARKETING', granted: true, channel: 'ONLINE' }] : []),
            ],
          },
        },
      });
      await this.audit.record(
        {
          action: 'CREATE',
          module: 'clients',
          actor: { type: 'CLIENT', name: `${c.firstName} ${c.lastName}`.trim() },
          organizationId,
          entity: { type: 'Client', id: c.id, label: `${c.firstName} ${c.lastName}`.trim() },
          newValues: { firstName: c.firstName, lastName: c.lastName, origen: 'ONLINE' },
        },
        tx,
      );
      return c;
    });
  }

  private formatLocal(instant: Date, tz: string) {
    return new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(instant);
  }

  /** Emails de la clienta en segundo plano: un fallo de correo no deshace la reserva. */
  private notify(to: string, subject: string, lines: string[], attachments?: Mail['attachments']) {
    void this.mail.send({ to, subject, text: lines.join('\n'), attachments }).catch((err: unknown) => this.logger.error(err));
  }
}
