'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type { ClientFull } from '@/lib/types';

const area = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

export function ClientFormSheet({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: ClientFull | null;
  onClose: () => void;
  onSaved: (c: ClientFull) => void;
}) {
  const [f, setF] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    birthDate: '',
    allergies: '',
    contraindications: '',
    preferences: '',
    internalNotes: '',
    marketingOptIn: false,
    privacyConsent: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (!open) return;
    setF({
      firstName: client?.firstName ?? '',
      lastName: client?.lastName ?? '',
      phone: '',
      email: '',
      birthDate: client?.birthDate ?? '',
      allergies: client?.allergies ?? '',
      contraindications: client?.contraindications ?? '',
      preferences: client?.preferences ?? '',
      internalNotes: client?.internalNotes ?? '',
      marketingOptIn: client?.marketingOptIn ?? false,
      privacyConsent: true,
    });
    setError(null);
    setDuplicateId(null);
  }, [open, client]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setDuplicateId(null);
    const nullable = (v: string) => (v.trim() ? v.trim() : null);
    const body: Record<string, unknown> = {
      firstName: f.firstName,
      lastName: f.lastName,
      birthDate: nullable(f.birthDate),
      allergies: nullable(f.allergies),
      contraindications: nullable(f.contraindications),
      preferences: nullable(f.preferences),
      internalNotes: nullable(f.internalNotes),
      marketingOptIn: f.marketingOptIn,
    };
    // El contacto está enmascarado: al editar solo se envía si se escribe uno nuevo.
    if (f.phone.trim()) body.phone = f.phone;
    if (f.email.trim()) body.email = f.email;
    if (!client) body.privacyConsent = f.privacyConsent;
    try {
      const saved = await api<ClientFull>(client ? `/clients/${client.id}` : '/clients', { method: client ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onSaved(saved);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      if (p?.code === 'DUPLICATE_CLIENT') setDuplicateId(p.errors?.[0]?.message ?? null);
      setError([p?.title, p?.detail, ...(p?.code === 'DUPLICATE_CLIENT' ? [] : (p?.errors?.map((x) => x.message) ?? []))].filter(Boolean).join(': ') || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={client ? 'Editar clienta' : 'Nueva clienta'}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="client-form" disabled={saving || f.firstName.trim().length < 2}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={onSubmit} className="space-y-5">
        {error && (
          <Alert>
            {error}
            {duplicateId && (
              <Link href={`/app/clientes/${duplicateId}`} className="mt-1 block underline" onClick={onClose}>
                Abrir la ficha existente
              </Link>
            )}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre *" htmlFor="cfn">
            <Input id="cfn" value={f.firstName} onChange={set('firstName')} autoFocus />
          </Field>
          <Field label="Apellido" htmlFor="cln">
            <Input id="cln" value={f.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Teléfono" htmlFor="cph" hint={client?.hasPhone ? `Actual: ${client.phone}. Escribe uno nuevo para cambiarlo.` : 'Sin prefijo se asume +591.'}>
            <Input id="cph" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="70012345" />
          </Field>
          <Field label="Email" htmlFor="cem" hint={client?.hasEmail ? `Actual: ${client.email}` : undefined}>
            <Input id="cem" type="email" value={f.email} onChange={set('email')} />
          </Field>
        </div>
        <Field label="Fecha de nacimiento" htmlFor="cbd">
          <Input id="cbd" type="date" value={f.birthDate} onChange={set('birthDate')} />
        </Field>
        <Field label="Alergias" htmlFor="cal" hint="Se muestran como alerta a la especialista en cada cita.">
          <textarea id="cal" rows={2} value={f.allergies} onChange={set('allergies')} className={area} placeholder="Ej.: aceite de almendras" />
        </Field>
        <Field label="Contraindicaciones" htmlFor="cci">
          <textarea id="cci" rows={2} value={f.contraindications} onChange={set('contraindications')} className={area} placeholder="Ej.: embarazo, hipertensión" />
        </Field>
        <Field label="Preferencias de servicio" htmlFor="cpr" hint="Visibles para la especialista que la atiende.">
          <textarea id="cpr" rows={2} value={f.preferences} onChange={set('preferences')} className={area} placeholder="Ej.: presión media, sin música" />
        </Field>
        <Field label="Observaciones internas" htmlFor="cin" hint="Solo para administración.">
          <textarea id="cin" rows={2} value={f.internalNotes} onChange={set('internalNotes')} className={area} />
        </Field>
        {!client && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={f.privacyConsent} onChange={(e) => setF((x) => ({ ...x, privacyConsent: e.target.checked }))} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
            La clienta aceptó la política de privacidad (registro presencial)
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={f.marketingOptIn} onChange={(e) => setF((x) => ({ ...x, marketingOptIn: e.target.checked }))} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
          Acepta recibir promociones
        </label>
      </form>
    </Sheet>
  );
}
