import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { can } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { Errors } from '../../common/errors.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema, reasonSchema } from '../../common/validation.js';
import { type ReportType, ReportsService } from './reports.service.js';

const TYPES = ['sales', 'services', 'clients', 'staff', 'cancellations'] as const;
const typeSchema = z.enum(TYPES);
const periodSchema = z.object({ from: dateSchema, to: dateSchema, staffId: z.uuid().optional() }).refine((q) => q.to >= q.from, 'Rango inválido');

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':type')
  @RequirePermission('reports.view_global', 'reports.view_own')
  report(
    @CurrentUser() user: AuthUser,
    @Param('type', new ZodValidationPipe(typeSchema)) type: ReportType,
    @Query(new ZodValidationPipe(periodSchema)) q: z.infer<typeof periodSchema>,
  ) {
    // Sin permiso global, solo el reporte personal (RF-REP-08).
    if (!can(user, 'reports.view_global') && type !== 'staff') throw Errors.forbidden();
    return this.reports.build(user, type, q.from, q.to, q.staffId);
  }

  @Post(':type/export')
  @RequirePermission('reports.export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('type', new ZodValidationPipe(typeSchema)) type: ReportType,
    @Body(new ZodValidationPipe(z.object({ from: dateSchema, to: dateSchema, reason: reasonSchema }))) dto: { from: string; to: string; reason: string },
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.reports.export(user, type, dto.from, dto.to, dto.reason);
    res
      .status(200)
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      .setHeader('Cache-Control', 'no-store')
      .send(buffer);
  }
}
