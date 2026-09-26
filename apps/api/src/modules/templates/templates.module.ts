import { Global, Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

@Global()
@Module({
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
