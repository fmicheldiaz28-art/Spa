import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema } from '../../common/validation.js';
import { AvailabilityService } from './availability.service.js';

const staffParam = z
  .union([z.literal('any'), z.uuid()])
  .optional()
  .transform((v) => (v === 'any' ? undefined : v));

const slotsSchema = z.object({ serviceId: z.uuid(), staffId: staffParam, date: dateSchema });
const daysSchema = z.object({ serviceId: z.uuid(), staffId: staffParam, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get('slots')
  @RequirePermission('appointments.create')
  slots(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(slotsSchema)) q: z.infer<typeof slotsSchema>) {
    return this.availability.slots(user, q);
  }

  @Get('package-plans')
  @RequirePermission('appointments.create')
  packagePlans(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(z.object({ packageId: z.uuid(), date: dateSchema }))) q: { packageId: string; date: string }) {
    return this.availability.packagePlans(user, q.packageId, q.date);
  }

  @Get('days')
  @RequirePermission('appointments.create')
  days(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(daysSchema)) q: z.infer<typeof daysSchema>) {
    return this.availability.days(user, q.serviceId, q.staffId, q.month);
  }
}
