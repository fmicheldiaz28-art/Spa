import { Injectable } from '@nestjs/common';
import { type AuthUser, can } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import { lastNameInitial, maskEmail, maskPhone } from '../../common/mask.js';
import { resolveOrganizationId } from '../../common/org.js';
import { RateLimiter } from '../../common/rate-limiter.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { diff } from '../audit/audit-diff.js';
import { AuditService } from '../audit/audit.service.js';
import { type ImportRow, nameKey, validateImport } from './clients-import.js';

export interface ClientInput {
  firstName: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
  preferences?: string | null;
  allergies?: string | null;
  contraindications?: string | null;
  internalNotes?: string | null;
  source?: string | null;
  marketingOptIn?: boolean;
  privacyConsent?: boolean;
}

type ClientRecord = Prisma.ClientGetPayload<object>;

const NONE = '00000000-0000-0000-0000-000000000000';

/** Instantánea auditable: el contacto se guarda enmascarado (docs/11 §20.3). */
function snapshot(c: ClientRecord) {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    phone: maskPhone(c.phoneE164),
    email: maskEmail(c.email),
    birthDate: c.birthDate?.toISOString().slice(0, 10) ?? null,
    preferences: c.preferences,
    allergies: c.allergies,
    contraindications: c.contraindications,
    internalNotes: c.internalNotes,
    marketingOptIn: c.marketingOptIn,
  };
}

/** Ficha de clientas con privacidad por rol (docs/06-modulos.md M4, docs/07 §11.5–11.6). */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Clientas visibles: todas (ADMIN) o solo las que tienen citas con la especialista. */
  private async scope(user: AuthUser): Promise<Prisma.ClientWhereInput> {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const base = { organizationId, deletedAt: null, mergedIntoId: null };
    if (can(user, 'clients.read_all')) return base;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const months = (org.settings as { privacy?: { staff_client_visibility_months?: number } }).privacy?.staff_client_visibility_months ?? 12;
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    return {
      ...base,
      appointments: {
        some: { deletedAt: null, items: { some: { staffId: user.staffId ?? NONE, startAt: { gte: since } } } },
      },
    };
  }

  private dto(user: AuthUser, c: ClientRecord) {
    if (!can(user, 'clients.read_all')) {
      // La especialista: lo necesario para atender, nunca el contacto (RF-CLI-05).
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: lastNameInitial(c.lastName),
        name: `${c.firstName} ${lastNameInitial(c.lastName)}`.trim(),
        preferences: c.preferences,
        allergies: c.allergies,
        contraindications: c.contraindications,
        restricted: true as const,
      };
    }
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      name: `${c.firstName} ${c.lastName}`.trim(),
      phone: maskPhone(c.phoneE164),
      email: maskEmail(c.email),
      hasPhone: !!c.phoneE164,
      hasEmail: !!c.email,
      birthDate: c.birthDate?.toISOString().slice(0, 10) ?? null,
      preferences: c.preferences,
      allergies: c.allergies,
      contraindications: c.contraindications,
      internalNotes: can(user, 'clients.view_internal_notes') ? c.internalNotes : undefined,
      source: c.source,
      tags: c.tags,
      marketingOptIn: c.marketingOptIn,
      stats: {
        visits: c.visitsCount,
        noShows: c.noShowCount,
        totalSpent: c.totalSpent.toFixed(2),
        firstVisitAt: c.firstVisitAt?.toISOString() ?? null,
        lastVisitAt: c.lastVisitAt?.toISOString() ?? null,
      },
      createdAt: c.createdAt.toISOString(),
      restricted: false as const,
    };
  }

  async list(user: AuthUser, query: { q?: string; page: number; pageSize: number }) {
    const restricted = !can(user, 'clients.read_all');
    // Anti-extracción: la especialista busca solo entre sus clientas, pocas veces y con pocos resultados.
    if (restricted) this.limiter.hit(`clients-search:${user.id}`, 30, 3_600_000);
    const q = query.q?.trim();
    const digits = q?.replace(/\D/g, '');
    const where: Prisma.ClientWhereInput = {
      AND: [
        await this.scope(user),
        q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                ...(!restricted && digits && digits.length >= 4 ? [{ phoneE164: { contains: digits } }] : []),
                ...(!restricted && q.includes('@') ? [{ email: { contains: q, mode: 'insensitive' as const } }] : []),
              ],
            }
          : {},
      ],
    };
    const pageSize = restricted ? Math.min(query.pageSize, 20) : query.pageSize;
    const page = restricted ? 1 : query.page;
    const [total, rows] = await Promise.all([
      this.prisma.client.count({ where }),
      this.prisma.client.findMany({ where, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { data: rows.map((c) => this.dto(user, c)), total: restricted ? rows.length : total, page, pageSize };
  }

  async get(user: AuthUser, id: string) {
    return this.dto(user, await this.find(user, id));
  }

  async create(user: AuthUser, input: ClientInput) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    await this.assertNoDuplicate(organizationId, input.phone ?? null, input.email ?? null);

    return this.prisma.$transaction(async (tx) => {
      const c = await tx.client.create({
        data: {
          organizationId,
          firstName: input.firstName,
          lastName: input.lastName ?? '',
          phoneE164: input.phone ?? null,
          email: input.email ?? null,
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          preferences: input.preferences ?? null,
          allergies: input.allergies ?? null,
          contraindications: input.contraindications ?? null,
          internalNotes: input.internalNotes ?? null,
          source: input.source ?? 'PRESENCIAL',
          marketingOptIn: input.marketingOptIn ?? false,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      if (input.privacyConsent) {
        await tx.clientConsent.create({
          data: { clientId: c.id, consentType: 'PRIVACY_POLICY', granted: true, policyVersion: '1.0', channel: 'PRESENCIAL', createdBy: user.id },
        });
      }
      if (input.marketingOptIn) {
        await tx.clientConsent.create({ data: { clientId: c.id, consentType: 'MARKETING', granted: true, channel: 'PRESENCIAL', createdBy: user.id } });
      }
      await this.audit.record(
        { action: 'CREATE', module: 'clients', entity: { type: 'Client', id: c.id, label: `${c.firstName} ${c.lastName}`.trim() }, newValues: snapshot(c) },
        tx,
      );
      return this.dto(user, c);
    });
  }

  async update(user: AuthUser, id: string, input: Partial<ClientInput>) {
    const before = await this.find(user, id);
    await this.assertNoDuplicate(before.organizationId, input.phone ?? null, input.email ?? null, id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.client.update({
        where: { id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phoneE164: input.phone,
          email: input.email,
          birthDate: input.birthDate === undefined ? undefined : input.birthDate ? new Date(input.birthDate) : null,
          preferences: input.preferences,
          allergies: input.allergies,
          contraindications: input.contraindications,
          internalNotes: input.internalNotes,
          marketingOptIn: input.marketingOptIn,
          updatedBy: user.id,
        },
      });
      if (input.marketingOptIn !== undefined && input.marketingOptIn !== before.marketingOptIn) {
        await tx.clientConsent.create({ data: { clientId: id, consentType: 'MARKETING', granted: input.marketingOptIn, channel: 'PRESENCIAL', createdBy: user.id } });
      }
      const changes = diff(snapshot(before), snapshot(after));
      if (changes) await this.audit.record({ action: 'UPDATE', module: 'clients', entity: { type: 'Client', id, label: `${after.firstName} ${after.lastName}`.trim() }, ...changes }, tx);
      return this.dto(user, after);
    });
  }

  /** La especialista actualiza solo las preferencias de servicio de sus clientas (RF-CLI, HU-35). */
  async updateServiceNotes(user: AuthUser, id: string, preferences: string | null) {
    const before = await this.find(user, id);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.client.update({ where: { id }, data: { preferences, updatedBy: user.id } });
      if (before.preferences !== after.preferences) {
        await this.audit.record(
          {
            action: 'UPDATE',
            module: 'clients',
            entity: { type: 'Client', id, label: `${after.firstName} ${after.lastName}`.trim() },
            oldValues: { preferences: before.preferences },
            newValues: { preferences: after.preferences },
          },
          tx,
        );
      }
      return this.dto(user, after);
    });
  }

  /** Revela el contacto completo por 60 s en pantalla; cada revelación queda auditada (CU-18). */
  async revealContact(user: AuthUser, id: string) {
    const c = await this.find(user, id);
    this.limiter.hit(`reveal:${user.id}`, 50, 86_400_000);
    await this.audit.record({
      action: 'VIEW_SENSITIVE',
      module: 'clients',
      entity: { type: 'Client', id, label: `${c.firstName} ${c.lastName}`.trim() },
      newValues: { campos: 'teléfono, email' },
    });
    return { phone: c.phoneE164, email: c.email };
  }

  async remove(user: AuthUser, id: string, reason: string) {
    const c = await this.find(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.id, deleteReason: reason } });
      await this.audit.record(
        { action: 'DELETE', module: 'clients', entity: { type: 'Client', id, label: `${c.firstName} ${c.lastName}`.trim() }, oldValues: snapshot(c), reason },
        tx,
      );
    });
  }

  /**
   * Importación inicial desde Google Sheets (RF-CLI-10). Con `dryRun` solo devuelve la vista
   * previa; si no, crea las válidas que no existan (por teléfono o email) con origen MIGRACION.
   */
  async import(user: AuthUser, rows: ImportRow[], dryRun: boolean) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const { valid, errors, duplicatesInFile } = validateImport(rows);
    const phones = valid.map((v) => v.phoneE164).filter((p): p is string => !!p);
    const emails = valid.map((v) => v.email).filter((e): e is string => !!e);
    const existing = await this.prisma.client.findMany({
      where: { organizationId, deletedAt: null, mergedIntoId: null, OR: [{ phoneE164: { in: phones } }, { email: { in: emails } }] },
      select: { firstName: true, lastName: true, phoneE164: true, email: true },
    });
    const existingKeys = new Set(existing.flatMap((c) => [c.phoneE164 && `p:${c.phoneE164}`, c.email && `e:${c.email}`].filter(Boolean) as string[]));
    // Filas sin contacto: se comparan por nombre completo con las fichas existentes.
    const contactless = valid.filter((v) => !v.phoneE164 && !v.email);
    if (contactless.length) {
      const sameName = await this.prisma.client.findMany({
        where: { organizationId, deletedAt: null, mergedIntoId: null, firstName: { in: contactless.map((v) => v.firstName), mode: 'insensitive' } },
        select: { firstName: true, lastName: true },
      });
      for (const c of sameName) existingKeys.add(`n:${nameKey(c.firstName, c.lastName)}`);
    }
    const alreadyInDb = valid.filter(
      (v) =>
        (v.phoneE164 && existingKeys.has(`p:${v.phoneE164}`)) ||
        (v.email && existingKeys.has(`e:${v.email}`)) ||
        (!v.phoneE164 && !v.email && existingKeys.has(`n:${nameKey(v.firstName, v.lastName)}`)),
    );
    const toCreate = valid.filter((v) => !alreadyInDb.includes(v));

    const report = {
      total: rows.length,
      toImport: toCreate.length,
      errors,
      duplicatesInFile,
      alreadyInDb: alreadyInDb.map((v) => ({ line: v.line, name: `${v.firstName} ${v.lastName}`.trim(), problem: 'Ya existe una ficha con ese teléfono o email' })),
      preview: toCreate.slice(0, 10).map((v) => ({ line: v.line, name: `${v.firstName} ${v.lastName}`.trim(), phone: maskPhone(v.phoneE164), email: maskEmail(v.email) })),
    };
    if (dryRun) return { ...report, imported: 0 };

    await this.prisma.$transaction(async (tx) => {
      await tx.client.createMany({
        data: toCreate.map((v) => ({
          organizationId,
          firstName: v.firstName,
          lastName: v.lastName,
          phoneE164: v.phoneE164,
          email: v.email,
          allergies: v.allergies,
          preferences: v.preferences,
          internalNotes: v.internalNotes,
          source: 'MIGRACION',
          createdBy: user.id,
          updatedBy: user.id,
        })),
      });
      await tx.importJob.create({
        data: {
          organizationId,
          requestedBy: user.id,
          importType: 'CLIENTS',
          status: 'COMPLETADO',
          totalRows: rows.length,
          importedRows: toCreate.length,
          duplicateRows: duplicatesInFile.length + alreadyInDb.length,
          errorRows: errors.length,
          report: { errors, duplicatesInFile, alreadyInDb: report.alreadyInDb } as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: 'IMPORT',
          module: 'clients',
          entity: { type: 'Client', label: 'Importación de clientas' },
          newValues: { filas: rows.length, importadas: toCreate.length, duplicadas: duplicatesInFile.length + alreadyInDb.length, conError: errors.length },
        },
        tx,
      );
    });
    return { ...report, imported: toCreate.length };
  }

  private async find(user: AuthUser, id: string): Promise<ClientRecord> {
    const client = await this.prisma.client.findFirst({ where: { AND: [await this.scope(user), { id }] } });
    if (!client) throw Errors.notFound(); // 404 también si no es su clienta
    return client;
  }

  /** RF-CLI-03: sin duplicados por teléfono ni email; se ofrece la ficha existente. */
  private async assertNoDuplicate(organizationId: string, phone: string | null, email: string | null, exceptId?: string) {
    if (!phone && !email) return;
    const existing = await this.prisma.client.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        ...(exceptId && { id: { not: exceptId } }),
        OR: [...(phone ? [{ phoneE164: phone }] : []), ...(email ? [{ email }] : [])],
      },
    });
    if (existing) {
      throw new AppException(
        409,
        'DUPLICATE_CLIENT',
        'Ya existe una clienta con ese teléfono o email',
        `${existing.firstName} ${existing.lastName}`.trim() + (existing.phoneE164 ? ` · ${maskPhone(existing.phoneE164)}` : ''),
        [{ field: existing.phoneE164 === phone ? 'phone' : 'email', code: 'DUPLICATE', message: existing.id }],
      );
    }
  }
}
