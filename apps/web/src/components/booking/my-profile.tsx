'use client';

import { ChevronDown, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { publicApi } from '@/lib/public-api';

interface Profile {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  marketingOptIn: boolean;
  remindersOptIn: boolean;
}

/** "Mis datos" del portal: la clienta actualiza sus datos y cómo quiere que le escribamos (Fase 2). */
export function MyProfile({ clientToken }: { clientToken: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void publicApi<Profile>('/me/profile', { clientToken })
      .then((p) => {
        setProfile(p);
        setForm(p);
      })
      .catch(() => setProfile(null)); // sin reservas previas todavía no hay ficha
  }, [clientToken]);

  if (!profile || !form) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await publicApi<Profile>('/me/profile', {
        method: 'PATCH',
        clientToken,
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          ...(form.phone ? { phone: form.phone } : {}),
          birthDate: form.birthDate || null,
          marketingOptIn: form.marketingOptIn,
          remindersOptIn: form.remindersOptIn,
        }),
      });
      setProfile(updated);
      setForm(updated);
      setMessage({ tone: 'success', text: 'Tus datos se guardaron.' });
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setMessage({ tone: 'danger', text: [p?.title, ...(p?.errors?.map((x) => x.message) ?? [])].filter(Boolean).join('. ') || 'No se pudo guardar' });
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm((f) => f && { ...f, [k]: v });

  return (
    <section className="rounded-2xl border border-border bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <UserRound className="size-5 text-primary" />
        <span className="flex-1">
          <span className="block font-medium">Mis datos y avisos</span>
          <span className="text-sm text-muted">
            {profile.firstName} {profile.lastName} · {profile.remindersOptIn ? 'recibes recordatorios' : 'sin recordatorios'}
          </span>
        </span>
        <ChevronDown className={`size-4 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <form onSubmit={save} className="space-y-4 border-t border-border p-4">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" htmlFor="p-first">
              <Input id="p-first" autoComplete="given-name" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            </Field>
            <Field label="Apellido" htmlFor="p-last">
              <Input id="p-last" autoComplete="family-name" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </Field>
          </div>
          <Field label="Celular" htmlFor="p-phone">
            <Input id="p-phone" type="tel" autoComplete="tel" placeholder="+591 7…" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Fecha de nacimiento (opcional)" htmlFor="p-birth" hint="Para saludarte en tu cumpleaños.">
            <Input id="p-birth" type="date" value={form.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value || null)} />
          </Field>
          <p className="text-sm text-muted">Email: {profile.email} (es con el que ingresas; no se puede cambiar aquí).</p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">¿Cómo quieres que te escribamos?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form.remindersOptIn} onChange={(e) => set('remindersOptIn', e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
              <span>Recordatorios de mis citas por email (te recomendamos dejarlos activos)</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={form.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
              <span>Promociones y novedades</span>
            </label>
          </fieldset>
          <Button type="submit" disabled={busy || !form.firstName.trim()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      )}
    </section>
  );
}
