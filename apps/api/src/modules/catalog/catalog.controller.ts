import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { moneySchema } from '../../common/validation.js';
import { CatalogService } from './catalog.service.js';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido');

const categorySchema = z.object({ name: z.string().trim().min(2).max(40), color: color.nullable().optional() });
const categoryUpdateSchema = categorySchema.partial().extend({ isActive: z.boolean().optional() });

const serviceSchema = z.object({
  categoryId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  durationMin: z.coerce.number().int().min(5).max(600).multipleOf(5, 'La duración debe ser múltiplo de 5'),
  bufferAfterMin: z.coerce.number().int().min(0).max(120).default(10),
  price: moneySchema,
  isOnlineBookable: z.boolean().default(true),
  staffIds: z.array(z.uuid()).max(50).optional(),
});
const serviceUpdateSchema = serviceSchema.partial().extend({ isActive: z.boolean().optional() });

const listSchema = z.object({
  categoryId: z.uuid().optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const packageSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  price: moneySchema,
  isActive: z.boolean().optional(),
  items: z.array(z.object({ serviceId: z.uuid(), parallelGroup: z.number().int().min(1).max(20) })).min(2, 'Un paquete tiene al menos 2 servicios').max(12),
});

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('packages')
  @RequirePermission('packages.read')
  packages(@CurrentUser() user: AuthUser) {
    return this.catalog.packages(user);
  }

  @Post('packages')
  @RequirePermission('packages.manage')
  createPackage(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(packageSchema)) dto: z.infer<typeof packageSchema>) {
    return this.catalog.savePackage(user, null, dto);
  }

  @Patch('packages/:id')
  @RequirePermission('packages.manage')
  updatePackage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(packageSchema)) dto: z.infer<typeof packageSchema>) {
    return this.catalog.savePackage(user, id, dto);
  }

  @Get('service-categories')
  @RequirePermission('services.read')
  categories(@CurrentUser() user: AuthUser) {
    return this.catalog.categories(user);
  }

  @Post('service-categories')
  @RequirePermission('services.manage')
  createCategory(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(categorySchema)) dto: z.infer<typeof categorySchema>) {
    return this.catalog.createCategory(user, dto);
  }

  @Patch('service-categories/:id')
  @RequirePermission('services.manage')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(categoryUpdateSchema)) dto: z.infer<typeof categoryUpdateSchema>,
  ) {
    return this.catalog.updateCategory(user, id, dto);
  }

  @Get('services')
  @RequirePermission('services.read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.catalog.list(user, query);
  }

  @Post('services')
  @RequirePermission('services.manage')
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(serviceSchema)) dto: z.infer<typeof serviceSchema>) {
    return this.catalog.create(user, dto);
  }

  @Get('services/:id')
  @RequirePermission('services.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(user, id);
  }

  @Patch('services/:id')
  @RequirePermission('services.manage')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(serviceUpdateSchema)) dto: z.infer<typeof serviceUpdateSchema>,
  ) {
    return this.catalog.update(user, id, dto);
  }
}
