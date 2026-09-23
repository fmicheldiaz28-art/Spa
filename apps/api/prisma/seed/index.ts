/**
 * Seed idempotente (docs/04-base-de-datos.md §9.8). Se puede ejecutar varias veces:
 * crea lo que falta y no pisa datos cambiados por los usuarios (ej. contraseñas).
 */
import 'dotenv/config';
import { PERMISSION_CATALOG, ROLE_NAMES, ROLE_PERMISSIONS, SYSTEM_ROLES, type SystemRole } from '@naturalspa/shared';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaAdapter } from '../../src/infrastructure/prisma/create-adapter.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { seedCatalog } from './catalog.js';
import { seedDemo } from './demo.js';

export const SUPER_ADMIN = {
  firstName: 'Super',
  lastName: 'Admin',
  email: 'admin@datly.local',
  password: 'Admin123*',
} as const;

const prisma = new PrismaClient({
  adapter: createPrismaAdapter(process.env.DATABASE_URL!, Number(process.env.DATABASE_POOL_MAX ?? 10)),
});
const isProduction = process.env.NODE_ENV === 'production';

async function seedPermissionsAndRoles() {
  for (const def of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: def.code },
      update: { module: def.module, description: def.description, isSensitive: def.sensitive },
      create: { code: def.code, module: def.module, description: def.description, isSensitive: def.sensitive },
    });
  }
  const permissionIds = new Map(
    (await prisma.permission.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]),
  );

  const roleIds = {} as Record<SystemRole, string>;
  for (const code of SYSTEM_ROLES) {
    const role =
      (await prisma.role.findFirst({ where: { code, organizationId: null } })) ??
      (await prisma.role.create({ data: { code, name: ROLE_NAMES[code], isSystem: true } }));
    roleIds[code] = role.id;

    // Los roles de sistema reflejan exactamente la matriz del código.
    const wanted = ROLE_PERMISSIONS[code].map((c) => permissionIds.get(c)!);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } });
    await prisma.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
  return roleIds;
}

async function seedSuperAdmin(roleId: string) {
  const user = await prisma.user.upsert({
    where: { email: SUPER_ADMIN.email },
    update: {}, // no pisa cambios posteriores (contraseña, nombre)
    create: {
      email: SUPER_ADMIN.email,
      firstName: SUPER_ADMIN.firstName,
      lastName: SUPER_ADMIN.lastName,
      passwordHash: await hashPassword(SUPER_ADMIN.password),
      status: 'ACTIVE',
      organizationId: null, // usuario de plataforma
      mustChangePassword: isProduction, // docs/11-seguridad-auditoria.md §19.9
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId } },
    update: {},
    create: { userId: user.id, roleId },
  });
  return user;
}

async function main() {
  const roleIds = await seedPermissionsAndRoles();
  const admin = await seedSuperAdmin(roleIds.SUPER_ADMIN);
  const { organization, branch, services } = await seedCatalog(prisma);

  const demo = process.env.SEED_DEMO === 'true' && !isProduction;
  if (demo) await seedDemo(prisma, { organization, branch, services, roleIds });

  await prisma.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      actorName: 'seed',
      action: 'SEED',
      module: 'system',
      organizationId: organization.id,
      newValues: { permissions: PERMISSION_CATALOG.length, roles: SYSTEM_ROLES.length, demo },
    },
  });

  console.log(`✔ Seed completado
  Permisos:  ${PERMISSION_CATALOG.length}
  Roles:     ${SYSTEM_ROLES.join(', ')}
  Super Admin: ${admin.email} / ${SUPER_ADMIN.password}${isProduction ? ' (cambio obligatorio al ingresar)' : ''}
  Organización: ${organization.name} · Sede: ${branch.name}
  Datos demo: ${demo ? 'sí' : 'no'}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
