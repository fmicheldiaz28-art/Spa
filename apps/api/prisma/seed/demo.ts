import type { SystemRole } from '@naturalspa/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { type ServiceSlug, time } from './catalog.js';

/** Contraseña de todas las cuentas demo (solo local/staging). */
export const DEMO_PASSWORD = 'Demo123*';

interface DemoContext {
  organization: { id: string };
  branch: { id: string };
  services: Record<ServiceSlug, string>;
  roleIds: Record<SystemRole, string>;
}

const STAFF: {
  email: string;
  firstName: string;
  color: string;
  services: ServiceSlug[];
  /** Tramos por día (ISO 2=martes … 6=sábado). */
  shifts: [string, string][];
}[] = [
  { email: 'andrea@naturalspa.local', firstName: 'Andrea', color: '#A7D3B0', services: ['masaje-relajante', 'masaje-descontracturante', 'drenaje-linfatico'], shifts: [['09:00', '13:00'], ['14:00', '19:00']] },
  { email: 'lucia@naturalspa.local', firstName: 'Lucía', color: '#A9C8EC', services: ['masaje-relajante', 'masaje-descontracturante', 'drenaje-linfatico'], shifts: [['09:00', '13:00'], ['14:00', '19:00']] },
  { email: 'katherine@naturalspa.local', firstName: 'Katherine', color: '#CDB6E8', services: ['limpieza-facial', 'depilacion'], shifts: [['09:00', '13:00'], ['14:00', '19:00']] },
  { email: 'unas1@naturalspa.local', firstName: 'Especialista Uñas 1', color: '#F4C19C', services: ['manicure', 'pedicure'], shifts: [['09:00', '13:00'], ['14:00', '19:00']] },
  { email: 'unas2@naturalspa.local', firstName: 'Especialista Uñas 2', color: '#F2DD8C', services: ['manicure', 'pedicure'], shifts: [['10:00', '14:00'], ['15:00', '19:00']] },
];

export async function seedDemo(prisma: PrismaClient, ctx: DemoContext) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const upsertUser = async (email: string, firstName: string, role: SystemRole) => {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, firstName, passwordHash, organizationId: ctx.organization.id },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: ctx.roleIds[role] } },
      update: {},
      create: { userId: user.id, roleId: ctx.roleIds[role] },
    });
    return user;
  };

  await upsertUser('natalia@naturalspa.local', 'Natalia', 'ADMIN');

  for (const [index, s] of STAFF.entries()) {
    const user = await upsertUser(s.email, s.firstName, 'EMPLEADA');
    const staff = await prisma.staffProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        organizationId: ctx.organization.id,
        branchId: ctx.branch.id,
        userId: user.id,
        displayName: s.firstName,
        color: s.color,
        sortOrder: index,
      },
    });

    await prisma.staffService.createMany({
      data: s.services.map((slug) => ({ staffId: staff.id, serviceId: ctx.services[slug] })),
      skipDuplicates: true,
    });

    if ((await prisma.workSchedule.count({ where: { staffId: staff.id } })) === 0) {
      await prisma.workSchedule.createMany({
        data: [2, 3, 4, 5, 6].flatMap((weekday) =>
          s.shifts.map(([start, end]) => ({ staffId: staff.id, weekday, startTime: time(start), endTime: time(end) })),
        ),
      });
    }
  }
}
