import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { resolveOrganizationId } from '../../common/org.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema } from '../../common/validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { WeeklyReportService } from './weekly-report.service.js';

@Controller('dashboard')
export class WeeklyReportController {
  constructor(
    private readonly weekly: WeeklyReportService,
    private readonly prisma: PrismaService,
  ) {}

  /** Vista previa del reporte semanal (la semana anterior a `date`, por defecto hoy). */
  @Get('weekly-summary')
  @RequirePermission('dashboard.view_global')
  async summary(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(z.object({ date: dateSchema.optional() }))) q: { date?: string }) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    return this.weekly.preview(organizationId, org.name, q.date);
  }
}
