import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import type { PaymentMethod, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { addDays, localDate, localToUtc } from '../availability/domain/time.js';

export interface PaymentInput {
  appointmentId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  notes?: string | null;
}

const include = {
  appointment: { select: { code: true, client: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.PaymentInclude;

type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof include }>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cobros (docs/06-modulos.md M10): se registran y se anulan, nunca se editan. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
  ) {}

  private async receivers(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private dto(p: PaymentRecord, names: Map<string, string>) {
    return {
      id: p.id,
      appointmentId: p.appointmentId,
      appointmentCode: p.appointment?.code ?? null,
      client: p.appointment ? `${p.appointment.client.firstName} ${p.appointment.client.lastName}`.trim() : null,
      type: p.type,
      method: p.method,
      amount: p.amount.toFixed(2),
      reference: p.reference,
      notes: p.notes,
      status: p.status,
      receivedBy: names.get(p.receivedBy) ?? '—',
      paidAt: p.paidAt.toISOString(),
      voidReason: p.voidReason,
    };
  }

  /** Saldo de una cita: total − cobros registrados (docs §9.4 payments). */
  async balance(user: AuthUser, appointmentId: string) {
    const { organizationId } = await this.availability.context(user);
    const a = await this.prisma.appointment.findFirst({ where: { id: appointmentId, organizationId, deletedAt: null } });
    if (!a) throw Errors.notFound();
    const payments = await this.prisma.payment.findMany({ where: { appointmentId }, include, orderBy: { paidAt: 'asc' } });
    const paid = payments.filter((p) => p.status === 'REGISTRADO').reduce((s, p) => s + (p.type === 'REEMBOLSO' ? -1 : 1) * Number(p.amount), 0);
    const names = await this.receivers(payments.flatMap((p) => [p.receivedBy]));
    return {
      total: a.total.toFixed(2),
      paid: round2(paid).toFixed(2),
      balance: round2(Number(a.total) - paid).toFixed(2),
      payments: payments.map((p) => this.dto(p, names)),
    };
  }

  async create(user: AuthUser, input: PaymentInput) {
    const { organizationId } = await this.availability.context(user);
    const a = await this.prisma.appointment.findFirst({ where: { id: input.appointmentId, organizationId, deletedAt: null }, include: { client: true } });
    if (!a) throw Errors.validation([{ field: 'appointmentId', code: 'NOT_FOUND', message: 'La cita no existe' }]);
    if (a.status === 'CANCELADA') throw new AppException(422, 'APPOINTMENT_CANCELLED', 'No se puede cobrar una cita cancelada');
    const { balance } = await this.balance(user, a.id);
    if (round2(input.amount) > Number(balance)) {
      throw new AppException(422, 'AMOUNT_EXCEEDS_BALANCE', `El monto supera el saldo pendiente (Bs ${balance})`);
    }

    const names = await this.receivers([user.id]); // fuera de la transacción: no retiene una segunda conexión
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          organizationId,
          branchId: a.branchId,
          appointmentId: a.id,
          clientId: a.clientId,
          type: 'COBRO',
          method: input.method,
          amount: round2(input.amount),
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          receivedBy: user.id,
        },
        include,
      });
      await this.audit.record(
        {
          action: 'PAYMENT_REGISTERED',
          module: 'payments',
          entity: { type: 'Payment', id: p.id, label: `${a.code} · Bs ${p.amount.toFixed(2)}` },
          newValues: { cita: a.code, metodo: p.method, monto: p.amount.toFixed(2), referencia: p.reference },
        },
        tx,
      );
      await this.refreshClientSpent(tx, a.clientId);
      return this.dto(p, names);
    });
  }

  async void(user: AuthUser, id: string, reason: string) {
    const { organizationId } = await this.availability.context(user);
    const p = await this.prisma.payment.findFirst({ where: { id, organizationId }, include });
    if (!p) throw Errors.notFound();
    if (p.status === 'ANULADO') throw new AppException(422, 'ALREADY_VOIDED', 'El cobro ya está anulado');
    const names = await this.receivers([p.receivedBy]);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.payment.update({ where: { id }, data: { status: 'ANULADO', voidedAt: new Date(), voidedBy: user.id, voidReason: reason }, include });
      await this.audit.record(
        {
          action: 'PAYMENT_VOIDED',
          module: 'payments',
          entity: { type: 'Payment', id, label: `${p.appointment?.code ?? ''} · Bs ${p.amount.toFixed(2)}` },
          oldValues: { status: 'REGISTRADO', monto: p.amount.toFixed(2), metodo: p.method },
          newValues: { status: 'ANULADO' },
          reason,
        },
        tx,
      );
      if (p.clientId) await this.refreshClientSpent(tx, p.clientId);
      return this.dto(after, names);
    });
  }

  async list(user: AuthUser, query: { from: string; to: string; method?: PaymentMethod }) {
    const { organizationId, branch } = await this.availability.context(user);
    const rows = await this.prisma.payment.findMany({
      where: {
        organizationId,
        paidAt: { gte: localToUtc(query.from, 0, branch.timezone), lt: localToUtc(addDays(query.to, 1), 0, branch.timezone) },
        ...(query.method && { method: query.method }),
      },
      include,
      orderBy: { paidAt: 'desc' },
      take: 1000,
    });
    const names = await this.receivers(rows.map((r) => r.receivedBy));
    const data = rows.map((r) => this.dto(r, names));
    const registered = rows.filter((r) => r.status === 'REGISTRADO');
    const byMethod: Record<string, string> = {};
    for (const r of registered) byMethod[r.method] = round2(Number(byMethod[r.method] ?? 0) + (r.type === 'REEMBOLSO' ? -1 : 1) * Number(r.amount)).toFixed(2);
    const total = registered.reduce((s, r) => s + (r.type === 'REEMBOLSO' ? -1 : 1) * Number(r.amount), 0);
    return { data, summary: { total: round2(total).toFixed(2), count: registered.length, byMethod } };
  }

  /** Cierre de caja diario (RF-PAY-04): esperado por método vs. contado. */
  async closurePreview(user: AuthUser, date?: string) {
    const { branch } = await this.availability.context(user);
    const day = date ?? localDate(new Date(), branch.timezone);
    const { summary } = await this.list(user, { from: day, to: day });
    const closure = await this.prisma.cashClosure.findUnique({ where: { branchId_businessDate: { branchId: branch.id, businessDate: new Date(day) } } });
    return {
      date: day,
      expected: summary.byMethod,
      expectedTotal: summary.total,
      closed: closure
        ? { counted: closure.countedTotals, difference: closure.difference.toFixed(2), closedAt: closure.closedAt.toISOString(), notes: closure.notes }
        : null,
    };
  }

  async closeCash(user: AuthUser, date: string, counted: Record<string, number>, notes?: string | null) {
    const { branch } = await this.availability.context(user);
    const preview = await this.closurePreview(user, date);
    if (preview.closed) throw new AppException(409, 'ALREADY_CLOSED', 'La caja de ese día ya fue cerrada');
    const countedTotal = Object.values(counted).reduce((s, v) => s + v, 0);
    const difference = round2(countedTotal - Number(preview.expectedTotal));
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.cashClosure.create({
        data: { branchId: branch.id, businessDate: new Date(date), expectedTotals: preview.expected, countedTotals: counted, difference, notes: notes ?? null, closedBy: user.id },
      });
      await this.audit.record(
        {
          action: 'CASH_CLOSED',
          module: 'payments',
          entity: { type: 'CashClosure', id: c.id, label: `Caja ${date}` },
          newValues: { esperado: preview.expectedTotal, contado: round2(countedTotal).toFixed(2), diferencia: difference.toFixed(2) },
          reason: notes ?? null,
        },
        tx,
      );
    });
    return this.closurePreview(user, date);
  }

  private async refreshClientSpent(tx: Prisma.TransactionClient, clientId: string) {
    const rows = await tx.payment.findMany({ where: { clientId, status: 'REGISTRADO' }, select: { amount: true, type: true } });
    const total = rows.reduce((s, r) => s + (r.type === 'REEMBOLSO' ? -1 : 1) * Number(r.amount), 0);
    await tx.client.update({ where: { id: clientId }, data: { totalSpent: round2(total) } });
  }
}
