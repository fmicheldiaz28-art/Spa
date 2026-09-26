import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators.js';
import { IdempotencyStore } from '../../common/idempotency.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimiter } from '../../common/rate-limiter.js';
import { dateSchema, emailSchema, nameSchema, phoneSchema } from '../../common/validation.js';
import { waitlistEntrySchema } from '../waitlist/waitlist.controller.js';
import { BookingService } from './booking.service.js';

const staffParam = z
  .union([z.literal('any'), z.uuid()])
  .optional()
  .transform((v) => (v === 'any' ? undefined : v));
const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
// Token opaco del email de confirmación o enlace firmado (JWT) de los recordatorios.
const manageToken = z
  .string()
  .max(1000)
  .regex(/^[\w-]{20,64}$|^[\w-]+\.[\w-]+\.[\w-]+$/);

const holdSchema = z.object({ serviceId: z.uuid(), staffId: staffParam, startAt: instant });
const confirmSchema = z.object({
  holdId: z.uuid(),
  token: z.string().min(20).max(2000),
  firstName: nameSchema,
  lastName: z.string().trim().max(60).default(''),
  phone: phoneSchema,
  notes: z.string().trim().max(500).nullable().optional(),
  privacyConsent: z.boolean(),
  marketingOptIn: z.boolean().optional(),
});

const joinWaitlistSchema = waitlistEntrySchema.extend({
  firstName: nameSchema,
  lastName: z.string().trim().max(60).default(''),
  phone: phoneSchema,
  privacyConsent: z.boolean(),
  marketingOptIn: z.boolean().optional(),
});

const profileSchema = z
  .object({
    firstName: nameSchema,
    lastName: z.string().trim().max(60),
    phone: phoneSchema,
    birthDate: dateSchema.nullable(),
    marketingOptIn: z.boolean(),
    remindersOptIn: z.boolean(),
  })
  .partial();

const bearer = (auth?: string) => (auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);

/** API pública de reservas (docs/05-api.md §2.9). Sin sesión: todo con límites de uso. */
@Public()
@Controller('public')
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly limiter: RateLimiter,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('booking/info')
  info() {
    return this.booking.info();
  }

  @Get('booking/catalog')
  catalog() {
    return this.booking.catalog();
  }

  @Get('availability/days')
  days(@Req() req: Request, @Query(new ZodValidationPipe(z.object({ serviceId: z.uuid(), staffId: staffParam, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))) q: { serviceId: string; staffId?: string; month: string }) {
    this.limiter.hit(`pub-avail:${req.ip}`, 60, 60_000);
    return this.booking.days(q.serviceId, q.staffId, q.month);
  }

  @Get('availability/slots')
  slots(@Req() req: Request, @Query(new ZodValidationPipe(z.object({ serviceId: z.uuid(), staffId: staffParam, date: dateSchema }))) q: { serviceId: string; staffId?: string; date: string }) {
    this.limiter.hit(`pub-avail:${req.ip}`, 60, 60_000);
    return this.booking.slots(q.serviceId, q.staffId, q.date);
  }

  @Post('booking/holds')
  hold(@Req() req: Request, @Body(new ZodValidationPipe(holdSchema)) dto: z.infer<typeof holdSchema>) {
    this.limiter.hit(`pub-hold:${req.ip}`, 10, 3_600_000);
    return this.booking.createHold(dto);
  }

  @Delete('booking/holds/:id')
  @HttpCode(204)
  releaseHold(@Param('id', ParseUUIDPipe) id: string) {
    this.booking.releaseHold(id);
  }

  /** Variante POST para navigator.sendBeacon al cerrar la página. */
  @Post('booking/holds/:id/release')
  @HttpCode(204)
  releaseHoldBeacon(@Param('id', ParseUUIDPipe) id: string) {
    this.booking.releaseHold(id);
  }

  @Post('booking/verify/send')
  @HttpCode(202)
  async sendCode(@Req() req: Request, @Body(new ZodValidationPipe(z.object({ email: emailSchema }))) dto: { email: string }) {
    this.limiter.hit(`pub-otp:${dto.email}`, 3, 3_600_000);
    this.limiter.hit(`pub-otp-ip:${req.ip}`, 10, 3_600_000);
    await this.booking.sendCode(dto.email);
    return { message: 'Te enviamos un código de 6 dígitos a tu email.' };
  }

  @Post('booking/verify/check')
  @HttpCode(200)
  checkCode(@Req() req: Request, @Body(new ZodValidationPipe(z.object({ email: emailSchema, code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') }))) dto: { email: string; code: string }) {
    this.limiter.hit(`pub-otp-check:${req.ip}`, 20, 3_600_000);
    return this.booking.checkCode(dto.email, dto.code);
  }

  @Post('booking/confirm')
  confirm(@Headers('idempotency-key') key: string | undefined, @Body(new ZodValidationPipe(confirmSchema)) dto: z.infer<typeof confirmSchema>) {
    return this.idempotency.run(`booking:${dto.holdId}`, key, dto, () => this.booking.confirm(dto));
  }

  @Get('booking/manage/:token')
  manage(@Param('token', new ZodValidationPipe(manageToken)) token: string) {
    return this.booking.manage(token);
  }

  @Post('booking/manage/:token/confirm-attendance')
  @HttpCode(200)
  confirmAttendance(@Param('token', new ZodValidationPipe(manageToken)) token: string) {
    return this.booking.confirmAttendance({ manageToken: token });
  }

  @Post('booking/manage/:token/cancel')
  @HttpCode(200)
  cancelByLink(@Param('token', new ZodValidationPipe(manageToken)) token: string) {
    return this.booking.cancel({ manageToken: token });
  }

  @Post('booking/manage/:token/reschedule')
  @HttpCode(200)
  rescheduleByLink(@Param('token', new ZodValidationPipe(manageToken)) token: string, @Body(new ZodValidationPipe(z.object({ startAt: instant }))) dto: { startAt: Date }) {
    return this.booking.reschedule({ manageToken: token }, dto.startAt);
  }

  @Post('waitlist')
  joinWaitlist(@Req() req: Request, @Headers('authorization') auth: string | undefined, @Body(new ZodValidationPipe(joinWaitlistSchema)) dto: z.infer<typeof joinWaitlistSchema>) {
    this.limiter.hit(`waitlist:${req.ip}`, 10, 3_600_000);
    return this.booking.joinWaitlist(bearer(auth), dto);
  }

  @Get('me/profile')
  myProfile(@Headers('authorization') auth?: string) {
    return this.booking.myProfile(bearer(auth));
  }

  @Patch('me/profile')
  updateMyProfile(@Req() req: Request, @Headers('authorization') auth: string | undefined, @Body(new ZodValidationPipe(profileSchema)) dto: z.infer<typeof profileSchema>) {
    this.limiter.hit(`profile:${req.ip}`, 20, 3_600_000);
    return this.booking.updateMyProfile(bearer(auth), dto);
  }

  @Get('me/waitlist')
  myWaitlist(@Headers('authorization') auth?: string) {
    return this.booking.myWaitlist(bearer(auth));
  }

  @Post('me/waitlist/:id/cancel')
  @HttpCode(200)
  leaveWaitlist(@Headers('authorization') auth: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.leaveWaitlist(bearer(auth), id);
  }

  @Get('me/appointments')
  mine(@Headers('authorization') auth?: string) {
    return this.booking.myAppointments(bearer(auth));
  }

  @Post('me/appointments/:id/cancel')
  @HttpCode(200)
  cancelMine(@Headers('authorization') auth: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.cancel({ clientToken: bearer(auth), appointmentId: id });
  }

  @Post('me/appointments/:id/confirm-attendance')
  @HttpCode(200)
  confirmMine(@Headers('authorization') auth: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.confirmAttendance({ clientToken: bearer(auth), appointmentId: id });
  }

  @Post('me/appointments/:id/reschedule')
  @HttpCode(200)
  rescheduleMine(@Headers('authorization') auth: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ startAt: instant }))) dto: { startAt: Date }) {
    return this.booking.reschedule({ clientToken: bearer(auth), appointmentId: id }, dto.startAt);
  }
}
