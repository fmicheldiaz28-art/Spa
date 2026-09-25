import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES } from '@naturalspa/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { IdempotencyStore } from '../../common/idempotency.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema, reasonSchema } from '../../common/validation.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { AppointmentsService } from './appointments.service.js';
import type { StatusAction } from './domain/appointment-state.js';

const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const notes = z.string().trim().max(1000).nullable().optional();

const createSchema = z.object({
  clientId: z.uuid(),
  source: z.enum(APPOINTMENT_SOURCES).default('ADMIN'),
  items: z.array(z.object({ serviceId: z.uuid(), staffId: z.uuid(), startAt: instant })).min(1).max(10),
  clientNotes: notes,
  internalNotes: notes,
  overbookingReason: z.string().trim().min(3).max(300).nullable().optional(),
  packageId: z.uuid().nullable().optional(),
});

const rescheduleSchema = z.object({
  items: z.array(z.object({ itemId: z.uuid(), startAt: instant, staffId: z.uuid().optional() })).min(1).max(10),
  reason: z.string().trim().max(300).nullable().optional(),
});

const calendarSchema = z.object({ from: dateSchema, to: dateSchema, staffId: z.uuid().optional() }).refine((q) => q.to >= q.from, 'Rango inválido');

const listSchema = z.object({
  from: instant,
  to: instant,
  staffId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  status: z
    .string()
    .transform((v) => v.split(','))
    .pipe(z.array(z.enum(APPOINTMENT_STATUSES)))
    .optional(),
});

const cancelSchema = z.object({ reason: reasonSchema, cancelledByType: z.enum(['CLIENTE', 'SPA']).default('SPA') });
const revertSchema = z.object({ toStatus: z.enum(APPOINTMENT_STATUSES), reason: reasonSchema });

/** If-Match: "7" → 7 (docs/05-api.md §1, bloqueo optimista). */
function parseVersion(ifMatch?: string): number | undefined {
  const n = Number(ifMatch?.replace(/[W/"]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

@Controller()
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availability: AvailabilityService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('appointments/calendar')
  @RequirePermission('appointments.read_all', 'appointments.read_own')
  calendar(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(calendarSchema)) q: z.infer<typeof calendarSchema>) {
    return this.appointments.calendar(user, q.from, q.to, q.staffId);
  }

  @Get('appointments/deleted')
  @RequirePermission('appointments.delete')
  deleted(@CurrentUser() user: AuthUser) {
    return this.appointments.deleted(user);
  }

  @Get('appointments')
  @RequirePermission('appointments.read_all', 'appointments.read_own')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const { organizationId } = await this.availability.context(user);
    return this.appointments.list(user, organizationId, q);
  }

  @Post('appointments')
  @RequirePermission('appointments.create')
  create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>,
  ) {
    return this.idempotency.run(`appointments:${user.id}`, key, dto, () => this.appointments.create(user, dto));
  }

  @Get('appointments/:id')
  @RequirePermission('appointments.read_all', 'appointments.read_own')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.get(user, id);
  }

  @Get('appointments/:id/history')
  @RequirePermission('appointments.read_all', 'appointments.read_own')
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.history(user, id);
  }

  @Patch('appointments/:id')
  @RequirePermission('appointments.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(z.object({ clientNotes: notes, internalNotes: notes }))) dto: { clientNotes?: string | null; internalNotes?: string | null },
  ) {
    return this.appointments.updateNotes(user, id, parseVersion(ifMatch), dto);
  }

  @Post('appointments/:id/reschedule')
  @HttpCode(200)
  @RequirePermission('appointments.reschedule')
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(rescheduleSchema)) dto: z.infer<typeof rescheduleSchema>,
  ) {
    return this.appointments.reschedule(user, id, parseVersion(ifMatch), dto.items, dto.reason);
  }

  @Post('appointments/:id/confirm')
  @HttpCode(200)
  @RequirePermission('appointments.update')
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch?: string) {
    return this.status(user, id, 'confirm', ifMatch);
  }

  @Post('appointments/:id/check-in')
  @HttpCode(200)
  @RequirePermission('appointments.update_status_all', 'appointments.update_status_own')
  checkIn(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch?: string) {
    return this.status(user, id, 'check-in', ifMatch);
  }

  @Post('appointments/:id/complete')
  @HttpCode(200)
  @RequirePermission('appointments.update_status_all', 'appointments.update_status_own')
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch?: string) {
    return this.status(user, id, 'complete', ifMatch);
  }

  @Post('appointments/:id/no-show')
  @HttpCode(200)
  @RequirePermission('appointments.update_status_all', 'appointments.update_status_own')
  noShow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch?: string) {
    return this.status(user, id, 'no-show', ifMatch);
  }

  /** Enlace de WhatsApp con el recordatorio escrito (usa el contacto de la clienta: requiere ese permiso). */
  @Post('appointments/:id/whatsapp-reminder')
  @HttpCode(200)
  @RequirePermission('clients.view_contact')
  whatsappReminder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.whatsappReminder(user, id);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  @RequirePermission('appointments.cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(cancelSchema)) dto: z.infer<typeof cancelSchema>,
  ) {
    return this.appointments.changeStatus(user, id, 'cancel', parseVersion(ifMatch), dto);
  }

  @Post('appointments/:id/revert-status')
  @HttpCode(200)
  @RequirePermission('appointments.revert_status')
  revert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(revertSchema)) dto: z.infer<typeof revertSchema>,
  ) {
    return this.appointments.revertStatus(user, id, parseVersion(ifMatch), dto.toStatus, dto.reason);
  }

  @Delete('appointments/:id')
  @HttpCode(204)
  @RequirePermission('appointments.delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ reason: reasonSchema }))) dto: { reason: string }) {
    await this.appointments.remove(user, id, dto.reason);
  }

  @Post('appointments/:id/restore')
  @HttpCode(200)
  @RequirePermission('appointments.delete')
  restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.restore(user, id);
  }

  private status(user: AuthUser, id: string, action: StatusAction, ifMatch?: string) {
    return this.appointments.changeStatus(user, id, action, parseVersion(ifMatch));
  }
}
