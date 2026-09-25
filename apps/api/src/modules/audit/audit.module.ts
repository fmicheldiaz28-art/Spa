import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditSealService } from './audit-seal.service.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, AuditSealService],
  exports: [AuditService],
})
export class AuditModule {}
