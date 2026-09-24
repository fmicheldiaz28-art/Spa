import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { emailSchema, phoneSchema } from '../../common/validation.js';
import { type SettingsPatch, SettingsService } from './settings.service.js';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const patchSchema = z.object({
  organization: z.object({ name: z.string().trim().min(2).max(80).optional(), phone: phoneSchema.nullable().optional(), email: emailSchema.nullable().optional() }).optional(),
  branch: z.object({ address: z.string().trim().max(200).nullable().optional(), city: z.string().trim().max(80).nullable().optional(), phone: phoneSchema.nullable().optional() }).optional(),
  settings: z
    .object({
      booking: z
        .object({
          enabled: z.boolean(),
          slot_interval_min: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
          min_lead_time_min: int(0, 2880),
          max_advance_days: int(1, 365),
          auto_confirm: z.boolean(),
          max_active_bookings_per_client: int(1, 20),
          hold_ttl_sec: int(120, 1800),
        })
        .partial()
        .optional(),
      cancellation: z
        .object({ client_can_cancel_until_hours: int(0, 168), client_can_reschedule_until_hours: int(0, 168), max_reschedules_per_appointment: int(0, 10) })
        .partial()
        .optional(),
      no_show: z.object({ grace_minutes: int(0, 120) }).partial().optional(),
      privacy: z.object({ staff_client_visibility_months: int(1, 60) }).partial().optional(),
      // Horas antes de la cita en que sale cada aviso (hasta 3). WhatsApp llega con la plantilla aprobada por Meta.
      reminders: z
        .object({ enabled: z.boolean(), hours_before: z.array(int(1, 72)).max(3), channels: z.array(z.enum(['EMAIL', 'WHATSAPP'])).min(1) })
        .partial()
        .optional(),
    })
    .optional(),
});

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('settings.manage')
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user);
  }

  @Patch()
  @RequirePermission('settings.manage')
  update(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(patchSchema)) dto: z.infer<typeof patchSchema>) {
    return this.settings.update(user, dto as SettingsPatch);
  }
}
