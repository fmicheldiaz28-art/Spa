import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth-user.js';
import { resolveBranch, resolveOrganizationId } from '../../common/org.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { diff } from '../audit/audit-diff.js';
import { AuditService } from '../audit/audit.service.js';

/** Valores por defecto de las políticas (docs/04-base-de-datos.md §9.7). */
export const SETTINGS_DEFAULTS = {
  booking: { enabled: true, slot_interval_min: 15, min_lead_time_min: 120, max_advance_days: 60, auto_confirm: true, max_active_bookings_per_client: 3, hold_ttl_sec: 600 },
  cancellation: { client_can_cancel_until_hours: 12, client_can_reschedule_until_hours: 12, max_reschedules_per_appointment: 2 },
  no_show: { grace_minutes: 15 },
  privacy: { staff_client_visibility_months: 12 },
  // Recordatorios: función de la Fase 2, se activa en Configuración (feature flag, docs/12 §4).
  reminders: { enabled: false, hours_before: [24, 2], channels: ['EMAIL'] as string[] },
};

type Settings = typeof SETTINGS_DEFAULTS;

export interface SettingsPatch {
  organization?: { name?: string; phone?: string | null; email?: string | null };
  branch?: { address?: string | null; city?: string | null; phone?: string | null };
  settings?: { [K in keyof Settings]?: Partial<Settings[K]> };
}

/** Políticas vigentes: valores guardados sobre los valores por defecto. */
export function resolveSettings(stored: unknown): Settings {
  return merge(SETTINGS_DEFAULTS, (stored ?? {}) as Record<string, unknown>);
}

function merge(base: Settings, stored: Record<string, unknown>): Settings {
  const out = structuredClone(base) as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(stored ?? {})) {
    if (out[section] && values && typeof values === 'object') Object.assign(out[section], values);
  }
  return out as unknown as Settings;
}

/** Configuración del negocio (docs/06-modulos.md M14). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(user: AuthUser) {
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const [org, branch] = await Promise.all([this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }), resolveBranch(this.prisma, organizationId)]);
    return {
      organization: { name: org.name, phone: org.phone, email: org.email, timezone: org.timezone, currency: org.currency },
      branch: { id: branch.id, name: branch.name, address: branch.address, city: branch.city, phone: branch.phone },
      settings: merge(SETTINGS_DEFAULTS, org.settings as Record<string, unknown>),
    };
  }

  async update(user: AuthUser, patch: SettingsPatch) {
    const before = await this.get(user);
    const organizationId = await resolveOrganizationId(this.prisma, user);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const storedSettings = (org.settings ?? {}) as Record<string, Record<string, unknown>>;
    const nextSettings = structuredClone(storedSettings);
    for (const [section, values] of Object.entries(patch.settings ?? {})) {
      nextSettings[section] = { ...(nextSettings[section] ?? {}), ...values };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { name: patch.organization?.name, phone: patch.organization?.phone, email: patch.organization?.email, settings: nextSettings as Prisma.InputJsonValue },
      });
      if (patch.branch) {
        await tx.branch.update({ where: { id: before.branch.id }, data: { address: patch.branch.address, city: patch.branch.city, phone: patch.branch.phone } });
      }
      const flatten = (s: typeof before) => ({
        nombre: s.organization.name,
        telefono: s.organization.phone,
        email: s.organization.email,
        direccion: s.branch.address,
        ciudad: s.branch.city,
        ...Object.fromEntries(Object.entries(s.settings).flatMap(([sec, vals]) => Object.entries(vals).map(([k, v]) => [`${sec}.${k}`, v]))),
      });
      const after = {
        ...before,
        organization: { ...before.organization, ...Object.fromEntries(Object.entries(patch.organization ?? {}).filter(([, v]) => v !== undefined)) },
        branch: { ...before.branch, ...Object.fromEntries(Object.entries(patch.branch ?? {}).filter(([, v]) => v !== undefined)) },
        settings: merge(SETTINGS_DEFAULTS, nextSettings),
      };
      const changes = diff(flatten(before), flatten(after));
      if (changes) await this.audit.record({ action: 'SETTINGS_UPDATED', module: 'settings', entity: { type: 'Organization', id: organizationId, label: org.name }, ...changes }, tx);
    });
    return this.get(user);
  }
}
