import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuditQueryService } from './audit-query.service.js';

const listSchema = z.object({
  actorId: z.uuid().optional(),
  module: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Solo lectura: no hay PUT, PATCH ni DELETE sobre auditoría (docs/05-api.md §2.12). */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.audit.list(user, query);
  }

  @Get('facets')
  @RequirePermission('audit.read')
  facets(@CurrentUser() user: AuthUser) {
    return this.audit.facets(user);
  }

  @Get(':id')
  @RequirePermission('audit.read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.audit.get(user, id);
  }
}
