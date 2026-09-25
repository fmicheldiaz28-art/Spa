import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditSealService } from './audit-seal.service.js';

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

// Sello guardado fuera del sistema: número y al menos los primeros 16 caracteres del hash.
const anchorSchema = z.object({ seq: z.coerce.number().int().positive().optional(), hash: z.string().regex(/^[0-9a-fA-F]{16,64}$/).optional() });

/** Solo lectura: no hay PUT, PATCH ni DELETE sobre auditoría (docs/05-api.md §2.12). */
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditQueryService,
    private readonly seals: AuditSealService,
  ) {}

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

  /** Recalcula la cadena de hashes de toda la auditoría (docs/11 §195). */
  @Get('integrity')
  @RequirePermission('audit.read')
  integrity(@Query(new ZodValidationPipe(anchorSchema)) q: z.infer<typeof anchorSchema>) {
    return this.seals.verify(q.seq && q.hash ? { seq: q.seq, hash: q.hash } : undefined);
  }

  @Get(':id')
  @RequirePermission('audit.read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.audit.get(user, id);
  }
}
