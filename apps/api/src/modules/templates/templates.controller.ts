import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TEMPLATE_CODES, type TemplateCode } from './domain/templates.js';
import { TemplatesService } from './templates.service.js';

const codeSchema = z.enum(TEMPLATE_CODES as [TemplateCode, ...TemplateCode[]]);
const templateSchema = z.object({ subject: z.string().max(150).nullable().optional(), body: z.string().max(2000) });

/** Mensajes a clientas editables (Configuración → Mensajes). */
@Controller('settings/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermission('settings.manage')
  list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user);
  }

  @Post(':code/preview')
  @HttpCode(200)
  @RequirePermission('settings.manage')
  preview(@Param('code', new ZodValidationPipe(codeSchema)) code: TemplateCode, @Body(new ZodValidationPipe(templateSchema)) dto: z.infer<typeof templateSchema>) {
    return this.templates.preview(code, dto.subject ?? null, dto.body);
  }

  @Put(':code')
  @RequirePermission('settings.manage')
  save(@CurrentUser() user: AuthUser, @Param('code', new ZodValidationPipe(codeSchema)) code: TemplateCode, @Body(new ZodValidationPipe(templateSchema)) dto: z.infer<typeof templateSchema>) {
    return this.templates.save(user, code, dto.subject ?? null, dto.body);
  }

  @Delete(':code')
  @RequirePermission('settings.manage')
  reset(@CurrentUser() user: AuthUser, @Param('code', new ZodValidationPipe(codeSchema)) code: TemplateCode) {
    return this.templates.reset(user, code);
  }
}
