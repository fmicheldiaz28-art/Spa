import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth-user.js';
import { Errors } from '../../common/errors.js';
import { resolveOrganizationId } from '../../common/org.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { render, SAMPLE_VARS, TEMPLATE_CODES, TEMPLATES, type TemplateCode, validate } from './domain/templates.js';

const LOCALE = 'es-BO';

/** Plantillas de mensajes por organización; sin personalizar se usa el texto predeterminado. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private stored(organizationId: string, code: TemplateCode) {
    return this.prisma.notificationTemplate.findFirst({ where: { organizationId, code, channel: TEMPLATES[code].channel, locale: LOCALE, isActive: true } });
  }

  async get(organizationId: string, code: TemplateCode): Promise<{ subject: string | null; body: string }> {
    const s = await this.stored(organizationId, code);
    return s ? { subject: s.subject, body: s.body } : { subject: TEMPLATES[code].subject, body: TEMPLATES[code].body };
  }

  /** Mensaje listo para enviar. */
  async render(organizationId: string, code: TemplateCode, vars: Record<string, string | null | undefined>) {
    const t = await this.get(organizationId, code);
    return { subject: t.subject ? render(t.subject, vars) : null, text: render(t.body, vars) };
  }

  async list(user: AuthUser) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    return Promise.all(
      TEMPLATE_CODES.map(async (code) => {
        const def = TEMPLATES[code];
        const s = await this.stored(organizationId, code);
        return {
          code,
          channel: def.channel,
          label: def.label,
          description: def.description,
          variables: def.variables,
          required: def.required,
          subject: s ? s.subject : def.subject,
          body: s ? s.body : def.body,
          default: { subject: def.subject, body: def.body },
          custom: !!s,
          updatedAt: s?.updatedAt.toISOString() ?? null,
        };
      }),
    );
  }

  preview(code: TemplateCode, subject: string | null, body: string) {
    return { subject: subject ? render(subject, SAMPLE_VARS) : null, text: render(body, SAMPLE_VARS), errors: validate(code, subject, body) };
  }

  async save(user: AuthUser, code: TemplateCode, subject: string | null, body: string) {
    const def = TEMPLATES[code];
    const subj = def.channel === 'EMAIL' ? (subject?.trim() ?? '') : null;
    const errors = validate(code, subj, body);
    if (errors.length) throw Errors.validation(errors.map((message) => ({ field: 'body', code: 'TEMPLATE', message })));
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const before = await this.get(organizationId, code);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.notificationTemplate.findFirst({ where: { organizationId, code, channel: def.channel, locale: LOCALE } });
      if (existing) {
        await tx.notificationTemplate.update({ where: { id: existing.id }, data: { subject: subj, body, isActive: true, version: { increment: 1 }, updatedAt: new Date() } });
      } else {
        await tx.notificationTemplate.create({ data: { organizationId, code, channel: def.channel, locale: LOCALE, subject: subj, body } });
      }
      await this.audit.record(
        { action: 'UPDATE', module: 'settings', organizationId, entity: { type: 'NotificationTemplate', label: def.label }, oldValues: { asunto: before.subject, mensaje: before.body }, newValues: { asunto: subj, mensaje: body } },
        tx,
      );
    });
    return (await this.list(user)).find((t) => t.code === code)!;
  }

  async reset(user: AuthUser, code: TemplateCode) {
    const def = TEMPLATES[code];
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const existing = await this.stored(organizationId, code);
    if (existing) {
      await this.prisma.$transaction(async (tx) => {
        await tx.notificationTemplate.delete({ where: { id: existing.id } });
        await this.audit.record(
          { action: 'UPDATE', module: 'settings', organizationId, entity: { type: 'NotificationTemplate', label: def.label }, oldValues: { asunto: existing.subject, mensaje: existing.body }, newValues: { mensaje: '(texto predeterminado)' }, reason: 'Restaurado al texto predeterminado' },
          tx,
        );
      });
    }
    return (await this.list(user)).find((t) => t.code === code)!;
  }
}
