import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema, timeSchema } from '../../common/validation.js';
import { SchedulingService } from './scheduling.service.js';

const blocksSchema = z
  .array(z.object({ weekday: z.number().int().min(1).max(7), start: timeSchema, end: timeSchema }))
  .max(28);

const workScheduleSchema = z.object({ validFrom: dateSchema, blocks: blocksSchema });

const exceptionBase = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  allDay: z.boolean(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  reason: z.string().trim().max(300).nullable().optional(),
});
const exceptionSchema = exceptionBase.extend({
  staffId: z.uuid().nullable(),
  type: z.enum(['VACACIONES', 'PERMISO', 'BLOQUEO', 'EXTRA']),
});
const requestSchema = exceptionBase.extend({ type: z.enum(['VACACIONES', 'PERMISO']) });

const listExceptionsSchema = z.object({
  staffId: z.uuid().optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z.enum(['SOLICITADA', 'APROBADA', 'RECHAZADA', 'CANCELADA']).optional(),
});

const decisionSchema = z.object({ reason: z.string().trim().max(300).optional() }).default({});

const holidaySchema = z.object({
  date: dateSchema,
  name: z.string().trim().min(2).max(80),
  isClosed: z.boolean().default(true),
  openTime: timeSchema.optional(),
  closeTime: timeSchema.optional(),
});

@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('staff')
  @RequirePermission('staff.read_all', 'schedules.read_own')
  staff(@CurrentUser() user: AuthUser) {
    return this.scheduling.listStaff(user);
  }

  @Get('staff/:id/work-schedule')
  @RequirePermission('schedules.read_all', 'schedules.read_own')
  workSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.workSchedule(user, id);
  }

  @Put('staff/:id/work-schedule')
  @RequirePermission('schedules.manage')
  setWorkSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workScheduleSchema)) dto: z.infer<typeof workScheduleSchema>,
  ) {
    return this.scheduling.setWorkSchedule(user, id, dto.validFrom, dto.blocks);
  }

  @Get('business-hours')
  @RequirePermission('schedules.read_all', 'schedules.read_own')
  businessHours(@CurrentUser() user: AuthUser) {
    return this.scheduling.businessHours(user);
  }

  @Put('business-hours')
  @RequirePermission('settings.manage')
  setBusinessHours(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(z.object({ blocks: blocksSchema }))) dto: { blocks: z.infer<typeof blocksSchema> }) {
    return this.scheduling.setBusinessHours(user, dto.blocks);
  }

  @Get('schedule-exceptions')
  @RequirePermission('schedules.read_all', 'schedules.read_own')
  exceptions(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listExceptionsSchema)) query: z.infer<typeof listExceptionsSchema>) {
    return this.scheduling.listExceptions(user, query);
  }

  @Post('schedule-exceptions')
  @RequirePermission('schedules.manage')
  createException(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(exceptionSchema)) dto: z.infer<typeof exceptionSchema>) {
    return this.scheduling.createException(user, dto);
  }

  @Post('schedule-exceptions/requests')
  @RequirePermission('schedules.request')
  requestException(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(requestSchema)) dto: z.infer<typeof requestSchema>) {
    return this.scheduling.requestException(user, dto);
  }

  @Post('schedule-exceptions/:id/approve')
  @HttpCode(200)
  @RequirePermission('schedules.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.decideException(user, id, true);
  }

  @Post('schedule-exceptions/:id/reject')
  @HttpCode(200)
  @RequirePermission('schedules.approve')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decisionSchema)) dto: z.infer<typeof decisionSchema>,
  ) {
    return this.scheduling.decideException(user, id, false, dto.reason);
  }

  @Delete('schedule-exceptions/:id')
  @HttpCode(204)
  @RequirePermission('schedules.manage', 'schedules.request')
  async removeException(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.scheduling.removeException(user, id);
  }

  @Get('holidays')
  @RequirePermission('schedules.read_all', 'schedules.read_own')
  holidays(@CurrentUser() user: AuthUser, @Query('year') year?: string) {
    return this.scheduling.holidays(user, year && /^\d{4}$/.test(year) ? Number(year) : undefined);
  }

  @Post('holidays')
  @RequirePermission('schedules.manage')
  createHoliday(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(holidaySchema)) dto: z.infer<typeof holidaySchema>) {
    return this.scheduling.createHoliday(user, dto);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermission('schedules.manage')
  async deleteHoliday(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.scheduling.deleteHoliday(user, id);
  }
}
