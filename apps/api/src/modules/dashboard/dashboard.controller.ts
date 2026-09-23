import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema } from '../../common/validation.js';
import { DashboardService } from './dashboard.service.js';

const periodSchema = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('dashboard.view_global')
  summary(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    return this.dashboard.summary(user, q);
  }

  @Get('charts')
  @RequirePermission('dashboard.view_global')
  charts(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    return this.dashboard.charts(user, q);
  }

  @Get('me')
  @RequirePermission('dashboard.view_own')
  me(@CurrentUser() user: AuthUser) {
    return this.dashboard.me(user);
  }
}
