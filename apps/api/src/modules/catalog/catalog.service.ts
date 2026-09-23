import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth-user.js';
import { AppException, Errors } from '../../common/errors.js';
import { resolveOrganizationId } from '../../common/org.js';
import { uniqueSlug } from '../../common/slug.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { diff } from '../audit/audit-diff.js';
import { AuditService } from '../audit/audit.service.js';

export interface CategoryInput {
  name: string;
  color?: string | null;
}

export interface ServiceInput {
  categoryId: string;
  name: string;
  description?: string | null;
  durationMin: number;
  bufferAfterMin: number;
  price: number;
  isOnlineBookable: boolean;
  staffIds?: string[];
}

const serviceInclude = {
  category: { select: { id: true, name: true, color: true } },
  staffServices: { select: { staff: { select: { id: true, displayName: true, color: true, isActive: true } } } },
} satisfies Prisma.ServiceInclude;

type ServiceRecord = Prisma.ServiceGetPayload<{ include: typeof serviceInclude }>;

function toDto(s: ServiceRecord) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    category: s.category,
    durationMin: s.durationMin,
    bufferAfterMin: s.bufferAfterMin,
    price: s.price.toFixed(2),
    currency: s.currency,
    isActive: s.isActive,
    isOnlineBookable: s.isOnlineBookable,
    staff: s.staffServices.map((ss) => ss.staff).sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

function snapshot(s: ServiceRecord) {
  return {
    name: s.name,
    category: s.category.name,
    description: s.description,
    durationMin: s.durationMin,
    bufferAfterMin: s.bufferAfterMin,
    price: s.price.toFixed(2),
    isActive: s.isActive,
    isOnlineBookable: s.isOnlineBookable,
    staff: s.staffServices.map((ss) => ss.staff.displayName).sort().join(', '),
  };
}

/** Catálogo de servicios y categorías (docs/06-modulos.md M5). */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async categories(user: AuthUser) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const categories = await this.prisma.serviceCategory.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { services: { where: { deletedAt: null } } } } },
    });
    return categories.map((c) => ({ id: c.id, name: c.name, color: c.color, isActive: c.isActive, services: c._count.services }));
  }

  async createCategory(user: AuthUser, input: CategoryInput) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const taken = new Set((await this.prisma.serviceCategory.findMany({ where: { organizationId }, select: { slug: true } })).map((c) => c.slug));
    const last = await this.prisma.serviceCategory.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.serviceCategory.create({
        data: {
          organizationId,
          name: input.name,
          slug: uniqueSlug(input.name, taken),
          color: input.color ?? null,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
        },
      });
      await this.audit.record(
        { action: 'CREATE', module: 'services', entity: { type: 'ServiceCategory', id: category.id, label: category.name }, newValues: { name: category.name, color: category.color } },
        tx,
      );
      return { id: category.id, name: category.name, color: category.color, isActive: category.isActive, services: 0 };
    });
  }

  async updateCategory(user: AuthUser, id: string, input: Partial<CategoryInput> & { isActive?: boolean }) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const before = await this.prisma.serviceCategory.findFirst({ where: { id, organizationId } });
    if (!before) throw Errors.notFound();
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.serviceCategory.update({ where: { id }, data: { name: input.name, color: input.color, isActive: input.isActive } });
      const changes = diff(
        { name: before.name, color: before.color, isActive: before.isActive },
        { name: after.name, color: after.color, isActive: after.isActive },
      );
      if (changes) await this.audit.record({ action: 'UPDATE', module: 'services', entity: { type: 'ServiceCategory', id, label: after.name }, ...changes }, tx);
      return { id: after.id, name: after.name, color: after.color, isActive: after.isActive };
    });
  }

  async list(user: AuthUser, query: { categoryId?: string; active?: boolean }) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const where: Prisma.ServiceWhereInput = {
      organizationId,
      deletedAt: null,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.active !== undefined && { isActive: query.active }),
      // La empleada solo ve los servicios que ella realiza.
      ...(!user.permissions.has('services.manage') && user.staffId && { staffServices: { some: { staffId: user.staffId } } }),
    };
    const services = await this.prisma.service.findMany({
      where,
      include: serviceInclude,
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return services.map(toDto);
  }

  async get(user: AuthUser, id: string) {
    return toDto(await this.find(user, id));
  }

  async create(user: AuthUser, input: ServiceInput) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    await this.assertCategory(organizationId, input.categoryId);
    await this.assertStaff(organizationId, input.staffIds ?? []);
    if (input.isOnlineBookable && !input.staffIds?.length) {
      throw new AppException(422, 'SERVICE_WITHOUT_STAFF', 'Un servicio reservable online necesita al menos una colaboradora');
    }
    const taken = new Set((await this.prisma.service.findMany({ where: { organizationId }, select: { slug: true } })).map((s) => s.slug));

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: {
          organizationId,
          categoryId: input.categoryId,
          name: input.name,
          slug: uniqueSlug(input.name, taken),
          description: input.description ?? null,
          durationMin: input.durationMin,
          bufferAfterMin: input.bufferAfterMin,
          price: input.price,
          isOnlineBookable: input.isOnlineBookable,
          createdBy: user.id,
          updatedBy: user.id,
          staffServices: { create: (input.staffIds ?? []).map((staffId) => ({ staffId })) },
        },
        include: serviceInclude,
      });
      await this.audit.record(
        { action: 'CREATE', module: 'services', entity: { type: 'Service', id: created.id, label: created.name }, newValues: snapshot(created) },
        tx,
      );
      return toDto(created);
    });
  }

  /**
   * RF-SRV-07: cambiar precio o duración no altera las citas ya creadas (tienen su propia copia).
   */
  async update(user: AuthUser, id: string, input: Partial<ServiceInput> & { isActive?: boolean }) {
    const before = await this.find(user, id);
    const organizationId = await resolveOrganizationId(this.prisma, user);
    if (input.categoryId) await this.assertCategory(organizationId, input.categoryId);
    if (input.staffIds) await this.assertStaff(organizationId, input.staffIds);
    const onlineAfter = input.isOnlineBookable ?? before.isOnlineBookable;
    const staffAfter = input.staffIds ?? before.staffServices.map((s) => s.staff.id);
    if (onlineAfter && (input.isActive ?? before.isActive) && staffAfter.length === 0) {
      throw new AppException(422, 'SERVICE_WITHOUT_STAFF', 'Un servicio reservable online necesita al menos una colaboradora');
    }

    return this.prisma.$transaction(async (tx) => {
      if (input.staffIds) {
        await tx.staffService.deleteMany({ where: { serviceId: id, staffId: { notIn: input.staffIds } } });
        await tx.staffService.createMany({ data: input.staffIds.map((staffId) => ({ staffId, serviceId: id })), skipDuplicates: true });
      }
      const after = await tx.service.update({
        where: { id },
        data: {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          durationMin: input.durationMin,
          bufferAfterMin: input.bufferAfterMin,
          price: input.price,
          isOnlineBookable: input.isOnlineBookable,
          isActive: input.isActive,
          updatedBy: user.id,
        },
        include: serviceInclude,
      });
      const changes = diff(snapshot(before), snapshot(after));
      if (changes) {
        const action = input.isActive === false && before.isActive ? 'DEACTIVATE' : input.isActive && !before.isActive ? 'ACTIVATE' : 'UPDATE';
        await this.audit.record({ action, module: 'services', entity: { type: 'Service', id, label: after.name }, ...changes }, tx);
      }
      return toDto(after);
    });
  }

  // ------------------------------------------------------------------ paquetes (docs/06-modulos.md M6)

  async packages(user: AuthUser) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const rows = await this.prisma.package.findMany({
      where: { organizationId, deletedAt: null },
      include: { items: { include: { service: { select: { id: true, name: true, durationMin: true, price: true } } }, orderBy: { sequence: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => this.packageDto(p));
  }

  private packageDto(p: Prisma.PackageGetPayload<{ include: { items: { include: { service: { select: { id: true; name: true; durationMin: true; price: true } } } } } }>) {
    const groups = [...new Set(p.items.map((i) => i.parallelGroup))];
    const totalMin = groups.reduce((sum, g) => sum + Math.max(...p.items.filter((i) => i.parallelGroup === g).map((i) => i.service.durationMin)), 0);
    const listPrice = p.items.reduce((sum, i) => sum + Number(i.service.price), 0);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price.toFixed(2),
      listPrice: listPrice.toFixed(2),
      totalMin,
      isActive: p.isActive,
      isOnlineBookable: p.isOnlineBookable,
      items: p.items.map((i) => ({ serviceId: i.serviceId, serviceName: i.service.name, durationMin: i.service.durationMin, sequence: i.sequence, parallelGroup: i.parallelGroup })),
    };
  }

  async savePackage(user: AuthUser, id: string | null, input: { name: string; description?: string | null; price: number; isActive?: boolean; items: { serviceId: string; parallelGroup: number }[] }) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const services = await this.prisma.service.count({ where: { id: { in: input.items.map((i) => i.serviceId) }, organizationId, deletedAt: null } });
    if (services !== new Set(input.items.map((i) => i.serviceId)).size) {
      throw Errors.validation([{ field: 'items', code: 'NOT_FOUND', message: 'Algún servicio no existe' }]);
    }
    // Normaliza los grupos a 1, 2, 3… respetando el orden recibido.
    const groupOrder = [...new Set(input.items.map((i) => i.parallelGroup))];
    const items = input.items.map((i, index) => ({ serviceId: i.serviceId, sequence: index + 1, parallelGroup: groupOrder.indexOf(i.parallelGroup) + 1 }));
    const include = { items: { include: { service: { select: { id: true, name: true, durationMin: true, price: true } } }, orderBy: { sequence: 'asc' as const } } };

    const before = id ? await this.prisma.package.findFirst({ where: { id, organizationId, deletedAt: null }, include }) : null;
    if (id && !before) throw Errors.notFound();
    const taken = new Set((await this.prisma.package.findMany({ where: { organizationId }, select: { slug: true } })).map((p) => p.slug));

    return this.prisma.$transaction(async (tx) => {
      let saved;
      if (before) {
        await tx.packageItem.deleteMany({ where: { packageId: before.id } });
        saved = await tx.package.update({
          where: { id: before.id },
          data: { name: input.name, description: input.description ?? null, price: input.price, isActive: input.isActive ?? before.isActive, updatedBy: user.id, items: { create: items } },
          include,
        });
      } else {
        saved = await tx.package.create({
          data: { organizationId, name: input.name, slug: uniqueSlug(input.name, taken), description: input.description ?? null, price: input.price, createdBy: user.id, updatedBy: user.id, items: { create: items } },
          include,
        });
      }
      const describe = (p: typeof saved) => ({
        nombre: p.name,
        precio: p.price.toFixed(2),
        activo: p.isActive,
        servicios: p.items.map((i) => `${i.parallelGroup}. ${i.service.name}`).join(' | '),
      });
      const changes = before ? diff(describe(before), describe(saved)) : { oldValues: null, newValues: describe(saved) };
      if (changes) {
        await this.audit.record({ action: before ? 'UPDATE' : 'CREATE', module: 'services', entity: { type: 'Package', id: saved.id, label: saved.name }, ...changes }, tx);
      }
      return this.packageDto(saved);
    });
  }

  private async find(user: AuthUser, id: string): Promise<ServiceRecord> {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const service = await this.prisma.service.findFirst({ where: { id, organizationId, deletedAt: null }, include: serviceInclude });
    if (!service) throw Errors.notFound();
    return service;
  }

  private async assertCategory(organizationId: string, categoryId: string) {
    if (!(await this.prisma.serviceCategory.findFirst({ where: { id: categoryId, organizationId } }))) {
      throw Errors.validation([{ field: 'categoryId', code: 'NOT_FOUND', message: 'Categoría inexistente' }]);
    }
  }

  private async assertStaff(organizationId: string, staffIds: string[]) {
    if (!staffIds.length) return;
    const count = await this.prisma.staffProfile.count({ where: { id: { in: staffIds }, organizationId } });
    if (count !== new Set(staffIds).size) {
      throw Errors.validation([{ field: 'staffIds', code: 'NOT_FOUND', message: 'Alguna colaboradora no existe' }]);
    }
  }
}
