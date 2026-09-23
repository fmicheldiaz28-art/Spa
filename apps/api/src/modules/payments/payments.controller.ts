import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PAYMENT_METHODS } from '@naturalspa/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { IdempotencyStore } from '../../common/idempotency.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema, reasonSchema } from '../../common/validation.js';
import { PaymentsService } from './payments.service.js';

const createSchema = z.object({
  appointmentId: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  amount: z.coerce.number().positive('El monto debe ser mayor a 0').max(100_000),
  reference: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

const listSchema = z.object({ from: dateSchema, to: dateSchema, method: z.enum(PAYMENT_METHODS).optional() });

const closeSchema = z.object({
  date: dateSchema,
  counted: z.partialRecord(z.enum(PAYMENT_METHODS), z.coerce.number().min(0).max(1_000_000)),
  notes: z.string().trim().max(300).nullable().optional(),
});

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('payments')
  @RequirePermission('payments.read_all')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.payments.list(user, q);
  }

  @Post('payments')
  @RequirePermission('payments.create')
  create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.idempotency.run(`payments:${user.id}`, key, dto, () => this.payments.create(user, dto));
  }

  @Post('payments/:id/void')
  @HttpCode(200)
  @RequirePermission('payments.void')
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ reason: reasonSchema }))) dto: { reason: string }) {
    return this.payments.void(user, id, dto.reason);
  }

  @Get('appointments/:id/payments')
  @RequirePermission('payments.read_all')
  balance(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.balance(user, id);
  }

  @Get('cash-closures/preview')
  @RequirePermission('payments.close_cash')
  preview(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.payments.closurePreview(user, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined);
  }

  @Post('cash-closures')
  @RequirePermission('payments.close_cash')
  close(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(closeSchema)) dto: z.infer<typeof closeSchema>) {
    return this.payments.closeCash(user, dto.date, dto.counted as Record<string, number>, dto.notes);
  }
}
