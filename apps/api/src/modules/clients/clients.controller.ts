import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { dateSchema, emailSchema, nameSchema, phoneSchema, reasonSchema } from '../../common/validation.js';
import { ClientsService } from './clients.service.js';

const text = (max: number) => z.string().trim().max(max).nullable().optional();

const clientSchema = z.object({
  firstName: nameSchema,
  lastName: z.string().trim().max(60).optional(),
  phone: phoneSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  birthDate: dateSchema.nullable().optional(),
  preferences: text(1000),
  allergies: text(1000),
  contraindications: text(1000),
  internalNotes: text(2000),
  source: z.enum(['PRESENCIAL', 'WHATSAPP', 'INSTAGRAM', 'REFERIDO', 'GOOGLE', 'WALK_IN', 'OTRO']).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
  privacyConsent: z.boolean().optional(),
});
const updateSchema = clientSchema.omit({ privacyConsent: true, source: true }).partial();

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const cell = z.string().max(500).optional();
const importSchema = z.object({
  dryRun: z.boolean().default(true),
  rows: z
    .array(z.object({ firstName: cell, lastName: cell, phone: cell, email: cell, allergies: cell, preferences: cell, notes: cell }))
    .min(1)
    .max(5000, 'Máximo 5000 filas por importación'),
});

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission('clients.read_all', 'clients.read_assigned')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.clients.list(user, query);
  }

  @Post()
  @RequirePermission('clients.create')
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(clientSchema)) dto: z.infer<typeof clientSchema>) {
    return this.clients.create(user, dto);
  }

  @Post('import')
  @RequirePermission('clients.import')
  import(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(importSchema)) dto: z.infer<typeof importSchema>) {
    return this.clients.import(user, dto.rows, dto.dryRun);
  }

  @Get(':id')
  @RequirePermission('clients.read_all', 'clients.read_assigned')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('clients.update')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSchema)) dto: z.infer<typeof updateSchema>) {
    return this.clients.update(user, id, dto);
  }

  @Patch(':id/service-notes')
  @RequirePermission('clients.update_service_notes')
  serviceNotes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ preferences: text(1000) }))) dto: { preferences?: string | null },
  ) {
    return this.clients.updateServiceNotes(user, id, dto.preferences ?? null);
  }

  @Post(':id/reveal-contact')
  @HttpCode(200)
  @RequirePermission('clients.view_contact')
  reveal(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.revealContact(user, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('clients.delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(z.object({ reason: reasonSchema }))) dto: { reason: string }) {
    await this.clients.remove(user, id, dto.reason);
  }
}
