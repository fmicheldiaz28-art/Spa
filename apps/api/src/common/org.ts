import { type AuthUser } from './auth-user.js';
import { AppException } from './errors.js';
import type { PrismaService } from '../infrastructure/prisma/prisma.service.js';

/**
 * Organización sobre la que actúa el usuario. El SUPER_ADMIN (sin organización) opera sobre la
 * única existente; con varias organizaciones (SaaS) deberá elegirla explícitamente.
 */
export async function resolveOrganizationId(prisma: PrismaService, user: AuthUser): Promise<string> {
  if (user.organizationId) return user.organizationId;
  const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2 });
  if (orgs.length !== 1) throw new AppException(422, 'ORGANIZATION_REQUIRED', 'Indica la organización');
  return orgs[0]!.id;
}

/** Sede principal de la organización (F1 tiene una sola; multisede en F3). */
export async function resolveBranch(prisma: PrismaService, organizationId: string) {
  const branch = await prisma.branch.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) throw new AppException(422, 'BRANCH_REQUIRED', 'La organización no tiene sedes activas');
  return branch;
}
