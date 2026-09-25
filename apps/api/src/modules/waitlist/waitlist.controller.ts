import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { Errors } from '../../common/errors.js';
import { resolveOrganizationId } from '../../common/org.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema } from '../../common/validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { WaitlistService } from './waitlist.service.js';

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)')
  .transform((v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)));

export const waitlistEntrySchema = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid().nullable().optional(),
  date: dateSchema,
  timeFrom: hhmm.nullable().optional(),
  timeTo: hhmm.nullable().optional(),
});

const createSchema = waitlistEntrySchema.extend({
  clientId: z.uuid(),
  notes: z.string().trim().max(300).nullable().optional(),
});

/** Lista de espera en el backoffice (Fase 2). */
@Controller('waitlist')
export class WaitlistController {
  constructor(
    private readonly waitlist: WaitlistService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('waitlist.manage')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(z.object({ from: dateSchema.optional(), status: z.enum(['open', 'all']).default('open') }))) q: { from?: string; status: 'open' | 'all' }) {
    return this.waitlist.list(user, q);
  }

  @Post()
  @RequirePermission('waitlist.manage')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.waitlist.create(user, await resolveOrganizationId(this.prisma, user), dto, 'ADMIN');
  }

  @Post(':id/whatsapp')
  @HttpCode(200)
  @RequirePermission('waitlist.manage')
  async whatsapp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!user.permissions.has('clients.view_contact')) throw Errors.forbidden(); // usa el teléfono de la clienta
    return this.waitlist.whatsapp(user, await resolveOrganizationId(this.prisma, user), id);
  }

  @Patch(':id')
  @RequirePermission('waitlist.manage')
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['CANCELADA', 'CONVERTIDA', 'ACTIVA']) }))) dto: { status: 'CANCELADA' | 'CONVERTIDA' | 'ACTIVA' },
  ) {
    return this.waitlist.setStatus(user, await resolveOrganizationId(this.prisma, user), id, dto.status);
  }
}
