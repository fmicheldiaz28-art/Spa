import type { PrismaClient } from '../../src/generated/prisma/client.js';

/** Configuración por defecto de la organización (docs/04-base-de-datos.md §9.7). */
export const DEFAULT_SETTINGS = {
  booking: {
    enabled: true,
    slot_interval_min: 15,
    min_lead_time_min: 120,
    max_advance_days: 60,
    auto_confirm: true,
    max_active_bookings_per_client: 3,
    hold_ttl_sec: 600,
    require_otp_first_booking: true,
  },
  cancellation: {
    client_can_cancel_until_hours: 12,
    client_can_reschedule_until_hours: 12,
    max_reschedules_per_appointment: 2,
  },
  no_show: { grace_minutes: 15, flag_client_after_count: 2 },
  privacy: { staff_client_visibility_months: 12, mask_contact_for_admin: true },
  reminders: { enabled: false, hours_before: [24, 2], channels: ['EMAIL', 'WHATSAPP'] },
  security: { session_idle_hours_staff: 8, max_failed_logins: 5, lockout_minutes: 15, require_mfa_for_admin: false },
};

const CATEGORIES = [
  { slug: 'masajes', name: 'Masajes', color: '#A7D3B0', sortOrder: 1 },
  { slug: 'corporal', name: 'Corporal', color: '#9ED8D3', sortOrder: 2 },
  { slug: 'facial', name: 'Facial', color: '#CDB6E8', sortOrder: 3 },
  { slug: 'depilacion', name: 'Depilación', color: '#F3A9B8', sortOrder: 4 },
  { slug: 'unas', name: 'Uñas', color: '#F4C19C', sortOrder: 5 },
];

/**
 * Servicios actuales de NaturalSpa. ⚠️ Precios y duraciones son SUPUESTOS a validar con Natalia
 * (docs/01-negocio.md §2.3 y pregunta Q3).
 */
const SERVICES = [
  { slug: 'masaje-relajante', name: 'Masaje relajante', category: 'masajes', durationMin: 60, price: 180 },
  { slug: 'masaje-descontracturante', name: 'Masaje descontracturante', category: 'masajes', durationMin: 60, price: 200 },
  { slug: 'drenaje-linfatico', name: 'Drenaje linfático', category: 'corporal', durationMin: 60, price: 200 },
  { slug: 'limpieza-facial', name: 'Limpieza facial', category: 'facial', durationMin: 75, price: 220 },
  { slug: 'depilacion', name: 'Depilación', category: 'depilacion', durationMin: 30, price: 80 },
  { slug: 'manicure', name: 'Manicure', category: 'unas', durationMin: 45, price: 70 },
  { slug: 'pedicure', name: 'Pedicure', category: 'unas', durationMin: 60, price: 90 },
] as const;

export type ServiceSlug = (typeof SERVICES)[number]['slug'];

/** Hora local como valor para columnas `time` (Prisma usa la fecha 1970-01-01 UTC). */
export const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

export async function seedCatalog(prisma: PrismaClient) {
  const organization = await prisma.organization.upsert({
    where: { slug: 'naturalspa' },
    update: {},
    create: {
      name: 'NaturalSpa',
      slug: 'naturalspa',
      timezone: 'America/La_Paz',
      currency: 'BOB',
      locale: 'es-BO',
      settings: DEFAULT_SETTINGS,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: 'central' } },
    update: {},
    create: { organizationId: organization.id, name: 'NaturalSpa Central', slug: 'central' },
  });

  // Martes (2) a sábado (6), 09:00–19:00
  if ((await prisma.businessHours.count({ where: { branchId: branch.id } })) === 0) {
    await prisma.businessHours.createMany({
      data: [2, 3, 4, 5, 6].map((weekday) => ({
        branchId: branch.id,
        weekday,
        openTime: time('09:00'),
        closeTime: time('19:00'),
      })),
    });
  }

  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const category = await prisma.serviceCategory.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug: c.slug } },
      update: {},
      create: { organizationId: organization.id, ...c },
    });
    categoryIds.set(c.slug, category.id);
  }

  const services = {} as Record<ServiceSlug, string>;
  for (const s of SERVICES) {
    const service = await prisma.service.upsert({
      where: { organizationId_slug: { organizationId: organization.id, slug: s.slug } },
      update: {},
      create: {
        organizationId: organization.id,
        categoryId: categoryIds.get(s.category)!,
        slug: s.slug,
        name: s.name,
        durationMin: s.durationMin,
        bufferAfterMin: 10,
        price: s.price,
      },
    });
    services[s.slug] = service.id;
  }

  // Día de Novia — composición a validar con Natalia (pregunta Q10)
  const pkg = await prisma.package.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: 'dia-de-novia' } },
    update: {},
    create: {
      organizationId: organization.id,
      slug: 'dia-de-novia',
      name: 'Día de Novia',
      description: 'Limpieza facial, masaje relajante, manicure y pedicure en paralelo, y depilación.',
      price: 950,
      isOnlineBookable: false,
    },
  });
  if ((await prisma.packageItem.count({ where: { packageId: pkg.id } })) === 0) {
    await prisma.packageItem.createMany({
      data: [
        { packageId: pkg.id, serviceId: services['limpieza-facial'], sequence: 1, parallelGroup: 1 },
        { packageId: pkg.id, serviceId: services['masaje-relajante'], sequence: 2, parallelGroup: 2 },
        { packageId: pkg.id, serviceId: services.manicure, sequence: 3, parallelGroup: 3 },
        { packageId: pkg.id, serviceId: services.pedicure, sequence: 4, parallelGroup: 3 },
        { packageId: pkg.id, serviceId: services.depilacion, sequence: 5, parallelGroup: 4 },
      ],
    });
  }

  return { organization, branch, services };
}
