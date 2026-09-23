import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { SYSTEM_ROLES } from '@naturalspa/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

const role = z.enum(SYSTEM_ROLES);
const name = z.string().trim().min(2, 'Mínimo 2 caracteres').max(60);
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, 'Teléfono inválido'))
  .transform((v) => (v.startsWith('+') ? v : `+591${v}`)); // RNF-LOC-04: +591 por defecto
const staff = z
  .object({
    displayName: z.string().trim().min(2).max(40).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido').optional(),
    isBookableOnline: z.boolean().optional(),
  })
  .optional();

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: role.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const createSchema = z.object({
  firstName: name,
  lastName: z.string().trim().max(60).default(''),
  email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')),
  phone: phone.optional(),
  role,
  password: z.string().max(128).optional(),
  staff,
});

const updateSchema = z.object({
  firstName: name.optional(),
  lastName: z.string().trim().max(60).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')).optional(),
  phone: phone.nullable().optional(),
  role: role.optional(),
  staff,
});

const deactivateSchema = z.object({ reason: z.string().trim().max(300).optional() }).default({});

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.users.list(user, query);
  }

  @Post()
  @RequirePermission('users.create')
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.users.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('users.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(user, id);
  }

  @Patch(':id')
  @RequirePermission('users.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) dto: z.infer<typeof updateSchema>,
  ) {
    return this.users.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users.deactivate')
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deactivateSchema)) dto: z.infer<typeof deactivateSchema>,
  ) {
    return this.users.deactivate(user, id, dto.reason);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('users.deactivate')
  activate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.activate(user, id);
  }

  @Post(':id/force-password-reset')
  @HttpCode(200)
  @RequirePermission('users.reset_password')
  resetPassword(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.resetPassword(user, id);
  }

  @Get(':id/sessions')
  @RequirePermission('users.read')
  sessions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.sessions(user, id);
  }

  @Delete(':id/sessions')
  @HttpCode(204)
  @RequirePermission('users.deactivate')
  async revokeSessions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.revokeSessions(user, id);
  }
}
