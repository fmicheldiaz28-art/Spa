'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface SettingsData {
  organization: { name: string; phone: string | null; email: string | null; timezone: string; currency: string };
  branch: { id: string; name: string; address: string | null; city: string | null; phone: string | null };
  settings: {
    booking: { enabled: boolean; slot_interval_min: number; min_lead_time_min: number; max_advance_days: number; auto_confirm: boolean; max_active_bookings_per_client: number; hold_ttl_sec: number };
    cancellation: { client_can_cancel_until_hours: number; client_can_reschedule_until_hours: number; max_reschedules_per_appointment: number };
    no_show: { grace_minutes: number; flag_client_after_count: number };
    privacy: { staff_client_visibility_months: number };
    reminders: { enabled: boolean; hours_before: number[]; channels: string[] };
    weekly_report: { enabled: boolean; send_hour: number };
    security: { require_mfa_for_admin: boolean };
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Configuración del negocio y políticas (docs/06-modulos.md M14). */
export default function SettingsPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('settings.manage');
  const [data, setData] = useState<SettingsData | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  useEffect(() => {
    if (allowed) void api<SettingsData>('/settings').then(setData);
  }, [allowed]);

  if (!allowed || !data) return null;
  const s = data.settings;
  const setSetting = <K extends keyof SettingsData['settings']>(section: K, key: keyof SettingsData['settings'][K], value: unknown) =>
    setData((d) => d && { ...d, settings: { ...d.settings, [section]: { ...d.settings[section], [key]: value } } });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    setMessage(null);
    try {
      setData(
        await api<SettingsData>('/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            organization: { name: data.organization.name, phone: data.organization.phone || null, email: data.organization.email || null },
            branch: { address: data.branch.address || null, city: data.branch.city || null, phone: data.branch.phone || null },
            settings: data.settings,
          }),
        }),
      );
      setMessage({ tone: 'success', text: 'Configuración guardada.' });
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setMessage({ tone: 'danger', text: [p?.title, ...(p?.errors?.map((x) => `${x.field}: ${x.message}`) ?? [])].filter(Boolean).join(' · ') || 'No se pudo guardar' });
    } finally {
      setSaving(false);
    }
  }

  const num = (v: string) => (v === '' ? 0 : Number(v));
  const setReminderHours = (index: number, value: number) => {
    const hours = [s.reminders.hours_before[0] ?? 24, s.reminders.hours_before[1] ?? 0];
    hours[index] = value;
    setSetting('reminders', 'hours_before', hours.filter((h) => h > 0));
  };

  return (
    <form onSubmit={save} className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
          <p className="mt-1 text-sm text-muted">
            Cada cambio queda registrado en la auditoría.{' '}
            <Link href="/app/configuracion/mensajes" className="text-primary hover:underline">
              Editar mensajes a clientas →
            </Link>
          </p>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Section title="Datos del negocio" description="Aparecen en la página de reservas y en los emails.">
        <Field label="Nombre" htmlFor="oname">
          <Input id="oname" value={data.organization.name} onChange={(e) => setData({ ...data, organization: { ...data.organization, name: e.target.value } })} />
        </Field>
        <Field label="WhatsApp / teléfono" htmlFor="ophone" hint="Se ofrece a las clientas para consultas.">
          <Input id="ophone" type="tel" value={data.organization.phone ?? ''} onChange={(e) => setData({ ...data, organization: { ...data.organization, phone: e.target.value } })} />
        </Field>
        <Field label="Email" htmlFor="oemail">
          <Input id="oemail" type="email" value={data.organization.email ?? ''} onChange={(e) => setData({ ...data, organization: { ...data.organization, email: e.target.value } })} />
        </Field>
        <Field label="Dirección" htmlFor="baddr">
          <Input id="baddr" value={data.branch.address ?? ''} onChange={(e) => setData({ ...data, branch: { ...data.branch, address: e.target.value } })} />
        </Field>
        <Field label="Ciudad" htmlFor="bcity">
          <Input id="bcity" value={data.branch.city ?? ''} onChange={(e) => setData({ ...data, branch: { ...data.branch, city: e.target.value } })} />
        </Field>
        <Field label="Zona horaria y moneda" htmlFor="tz">
          <Input id="tz" value={`${data.organization.timezone} · ${data.organization.currency}`} disabled />
        </Field>
      </Section>

      <Section title="Reservas online" description="Reglas de la página pública de reservas.">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={s.booking.enabled} onChange={(e) => setSetting('booking', 'enabled', e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Reservas online activas
        </label>
        <Field label="Anticipación mínima (horas)" htmlFor="lead">
          <Input id="lead" type="number" min={0} max={48} value={s.booking.min_lead_time_min / 60} onChange={(e) => setSetting('booking', 'min_lead_time_min', Math.round(num(e.target.value) * 60))} />
        </Field>
        <Field label="Reservar hasta (días adelante)" htmlFor="adv">
          <Input id="adv" type="number" min={1} max={365} value={s.booking.max_advance_days} onChange={(e) => setSetting('booking', 'max_advance_days', num(e.target.value))} />
        </Field>
        <Field label="Intervalo de horarios" htmlFor="interval">
          <Select id="interval" value={s.booking.slot_interval_min} onChange={(e) => setSetting('booking', 'slot_interval_min', Number(e.target.value))}>
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                Cada {m} minutos
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Máx. reservas activas por clienta" htmlFor="maxact">
          <Input id="maxact" type="number" min={1} max={20} value={s.booking.max_active_bookings_per_client} onChange={(e) => setSetting('booking', 'max_active_bookings_per_client', num(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={s.booking.auto_confirm} onChange={(e) => setSetting('booking', 'auto_confirm', e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Confirmar automáticamente (si lo desactivas, quedan pendientes de tu aprobación)
        </label>
      </Section>

      <Section title="Cancelaciones y no-show">
        <Field label="La clienta puede cancelar hasta (horas antes)" htmlFor="cancel">
          <Input id="cancel" type="number" min={0} max={168} value={s.cancellation.client_can_cancel_until_hours} onChange={(e) => setSetting('cancellation', 'client_can_cancel_until_hours', num(e.target.value))} />
        </Field>
        <Field label="Puede reagendar hasta (horas antes)" htmlFor="resch">
          <Input id="resch" type="number" min={0} max={168} value={s.cancellation.client_can_reschedule_until_hours} onChange={(e) => setSetting('cancellation', 'client_can_reschedule_until_hours', num(e.target.value))} />
        </Field>
        <Field label="Máx. reagendamientos por cita" htmlFor="maxr">
          <Input id="maxr" type="number" min={0} max={10} value={s.cancellation.max_reschedules_per_appointment} onChange={(e) => setSetting('cancellation', 'max_reschedules_per_appointment', num(e.target.value))} />
        </Field>
        <Field label="Tolerancia para marcar no-show (minutos)" htmlFor="grace">
          <Input id="grace" type="number" min={0} max={120} value={s.no_show.grace_minutes} onChange={(e) => setSetting('no_show', 'grace_minutes', num(e.target.value))} />
        </Field>
        <Field label="Marcar clienta tras (no-shows)" htmlFor="flag" hint="La agenda te avisa que conviene confirmarle por teléfono.">
          <Input id="flag" type="number" min={1} max={20} value={s.no_show.flag_client_after_count} onChange={(e) => setSetting('no_show', 'flag_client_after_count', num(e.target.value))} />
        </Field>
      </Section>

      <Section title="Recordatorios automáticos" description="Email a la clienta antes de su cita, con botón para confirmar asistencia, reagendar o cancelar.">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={s.reminders.enabled} onChange={(e) => setSetting('reminders', 'enabled', e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Enviar recordatorios (solo a clientas con email)
        </label>
        <Field label="Primer aviso (horas antes)" htmlFor="rem1">
          <Input id="rem1" type="number" min={1} max={72} disabled={!s.reminders.enabled} value={s.reminders.hours_before[0] ?? 24} onChange={(e) => setReminderHours(0, num(e.target.value))} />
        </Field>
        <Field label="Segundo aviso (horas antes)" htmlFor="rem2" hint="0 = sin segundo aviso.">
          <Input id="rem2" type="number" min={0} max={12} disabled={!s.reminders.enabled} value={s.reminders.hours_before[1] ?? 0} onChange={(e) => setReminderHours(1, num(e.target.value))} />
        </Field>
      </Section>

      <Section title="Reporte semanal" description="Cada lunes llega por email a las administradoras el resumen de la semana anterior.">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={s.weekly_report.enabled} onChange={(e) => setSetting('weekly_report', 'enabled', e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Enviar el reporte semanal
        </label>
        <Field label="Hora de envío (lunes)" htmlFor="wrhour">
          <Select id="wrhour" disabled={!s.weekly_report.enabled} value={s.weekly_report.send_hour} onChange={(e) => setSetting('weekly_report', 'send_hour', Number(e.target.value))}>
            {[6, 7, 8, 9, 10, 12, 18, 20].map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section title="Seguridad" description="Protección de las cuentas con acceso a toda la información del spa.">
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={s.security.require_mfa_for_admin} onChange={(e) => setSetting('security', 'require_mfa_for_admin', e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
          <span>
            Exigir verificación en dos pasos a administración
            <span className="block text-muted">Al guardar, quien aún no la tenga (incluida tú) deberá configurarla con su celular antes de seguir usando el sistema.</span>
          </span>
        </label>
      </Section>

      <Section title="Privacidad" description="Qué ve cada especialista de sus clientas.">
        <Field label="Meses de historial visibles para la especialista" htmlFor="priv" hint="Una clienta es visible para la especialista si tuvo una cita con ella en este período o tiene una futura.">
          <Input id="priv" type="number" min={1} max={60} value={s.privacy.staff_client_visibility_months} onChange={(e) => setSetting('privacy', 'staff_client_visibility_months', num(e.target.value))} />
        </Field>
      </Section>
    </form>
  );
}
