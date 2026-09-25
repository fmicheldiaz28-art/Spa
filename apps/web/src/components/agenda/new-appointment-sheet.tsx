'use client';

import { AlertTriangle, Search, UserPlus } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { type Appointment, problemSuggestions, type Slot, toInstant } from '@/lib/appointments';
import { useAuth } from '@/lib/auth';
import { type ClientFull, formatMoney, type Service, type ServicePackage } from '@/lib/types';
import { SlotPicker } from './appointment-sheet';

export interface NewAppointmentPreset {
  date: string;
  time?: string;
  staffId?: string;
}

interface PackagePlan {
  time: string;
  endTime: string;
  items: { serviceId: string; serviceName: string; staffId: string; staffName: string; startAt: string; time: string }[];
}

/** Opciones de horario para un paquete, con la colaboradora de cada servicio. */
function PlanPicker({ plans, value, onChange }: { plans: PackagePlan[] | null; value: PackagePlan | null; onChange: (p: PackagePlan) => void }) {
  if (!plans) return <p className="text-xs text-muted">Buscando combinaciones…</p>;
  if (!plans.length) return <p className="text-sm text-muted">No hay una combinación de colaboradoras libre ese día. Prueba otra fecha.</p>;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">Horario *</p>
      <div className="space-y-2">
        {plans.map((p) => (
          <button
            key={p.time}
            type="button"
            onClick={() => onChange(p)}
            className={`w-full rounded-lg border p-3 text-left text-sm ${value?.time === p.time ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
          >
            <span className="font-medium tabular-nums">
              {p.time}–{p.endTime}
            </span>
            <span className="mt-1 block text-xs text-muted">{p.items.map((i) => `${i.time} ${i.serviceName} (${i.staffName})`).join(' · ')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const SOURCES = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'TELEFONO', label: 'Teléfono' },
  { value: 'WALK_IN', label: 'Presencial' },
] as const;

/** Nueva cita en ≤ 4 pasos (docs/06-modulos.md M7, RNF-USA-01). */
export function NewAppointmentSheet({
  preset,
  onClose,
  onCreated,
}: {
  preset: NewAppointmentPreset | null;
  onClose: () => void;
  onCreated: (a: Appointment) => void;
}) {
  const { can } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [client, setClient] = useState<ClientFull | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState<string>('any');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [source, setSource] = useState<(typeof SOURCES)[number]['value']>('WHATSAPP');
  const [notes, setNotes] = useState('');
  const [overbooking, setOverbooking] = useState(false);
  const [forcedTime, setForcedTime] = useState('');
  const [overReason, setOverReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef('');
  // Modo paquete (docs/06-modulos.md M6): el sistema propone colaboradoras y horarios de cada servicio.
  const [mode, setMode] = useState<'service' | 'package'>('service');
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [packageId, setPackageId] = useState('');
  const [plans, setPlans] = useState<PackagePlan[] | null>(null);
  const [plan, setPlan] = useState<PackagePlan | null>(null);

  useEffect(() => {
    if (!preset) return;
    idempotencyKey.current = crypto.randomUUID();
    setClient(null);
    setDate(preset.date);
    setStaffId(preset.staffId ?? 'any');
    setForcedTime(preset.time ?? '');
    setSlot(null);
    setNotes('');
    setOverbooking(false);
    setOverReason('');
    setError(null);
    setMode('service');
    setPlan(null);
    if (can('packages.read')) {
      void api<ServicePackage[]>('/packages').then((p) => {
        const active = p.filter((x) => x.isActive);
        setPackages(active);
        setPackageId(active[0]?.id ?? '');
      });
    }
    void api<Service[]>('/services?active=true').then((s) => {
      setServices(s);
      const firstForStaff = s.find((x) => !preset.staffId || x.staff.some((st) => st.id === preset.staffId));
      setServiceId(firstForStaff?.id ?? '');
    });
  }, [preset, can]);

  useEffect(() => {
    if (!preset || mode !== 'package' || !packageId || !date) return;
    setPlans(null);
    setPlan(null);
    void api<{ plans: PackagePlan[] }>(`/availability/package-plans?packageId=${packageId}&date=${date}`)
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, [preset, mode, packageId, date]);

  const service = services.find((s) => s.id === serviceId);
  const selectedPackage = packages.find((p) => p.id === packageId);
  const staffOptions = service?.staff.filter((s) => s.isActive) ?? [];

  useEffect(() => {
    if (staffId !== 'any' && service && !staffOptions.some((s) => s.id === staffId)) setStaffId('any');
  }, [service, staffId, staffOptions]);

  useEffect(() => {
    if (!preset || !serviceId || !date) return;
    setSlots(null);
    setSlot(null);
    void api<{ slots: Slot[] }>(`/availability/slots?serviceId=${serviceId}&staffId=${staffId}&date=${date}`)
      .then((r) => {
        setSlots(r.slots);
        // Si se hizo clic en un hueco de la agenda, se preselecciona esa hora si está libre.
        if (preset.time) setSlot(r.slots.find((s) => s.time === preset.time) ?? null);
      })
      .catch(() => setSlots([]));
  }, [preset, serviceId, staffId, date]);

  async function submitPackage() {
    if (!client || !plan) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api<Appointment>('/appointments', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({
          clientId: client.id,
          source,
          packageId,
          items: plan.items.map((i) => ({ serviceId: i.serviceId, staffId: i.staffId, startAt: i.startAt })),
          internalNotes: notes || null,
        }),
      });
      onCreated(created);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError([p?.title, p?.detail].filter(Boolean).join('. ') || 'No se pudo crear');
      idempotencyKey.current = crypto.randomUUID();
      setPlan(null);
      void api<{ plans: PackagePlan[] }>(`/availability/package-plans?packageId=${packageId}&date=${date}`).then((r) => setPlans(r.plans));
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'package') return submitPackage();
    if (!client || !service) return;
    setSaving(true);
    setError(null);
    const chosenStaff = staffId !== 'any' ? staffId : slot?.staff[0]?.id;
    const startAt = overbooking ? toInstant(date, forcedTime) : slot?.startAt;
    try {
      const created = await api<Appointment>('/appointments', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({
          clientId: client.id,
          source,
          items: [{ serviceId, staffId: chosenStaff, startAt }],
          internalNotes: notes || null,
          overbookingReason: overbooking ? overReason : null,
        }),
      });
      onCreated(created);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      const sug = problemSuggestions(p?.errors);
      setError([p?.title, sug.length ? `Horarios cercanos: ${sug.map((s) => `${s.time} (${s.staff.map((x) => x.name).join('/')})`).join(', ')}` : null].filter(Boolean).join('. ') || 'No se pudo crear');
      idempotencyKey.current = crypto.randomUUID();
      // Refresca los horarios: puede que otra persona haya tomado el elegido.
      setSlot(null);
      void api<{ slots: Slot[] }>(`/availability/slots?serviceId=${serviceId}&staffId=${staffId}&date=${date}`).then((r) => setSlots(r.slots));
    } finally {
      setSaving(false);
    }
  }

  const ready =
    mode === 'package'
      ? !!client && !!plan
      : !!client && !!service && (overbooking ? !!forcedTime && overReason.trim().length >= 3 && staffId !== 'any' : !!slot);
  const total = mode === 'package' ? selectedPackage?.price : service?.price;

  return (
    <Sheet
      open={!!preset}
      onClose={onClose}
      title="Nueva cita"
      footer={
        <>
          <span className="mr-auto self-center text-sm">{total && <>Total: <strong>{formatMoney(total)}</strong></>}</span>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="new-appointment" disabled={!ready || saving}>
            {saving ? 'Creando…' : 'Crear cita'}
          </Button>
        </>
      }
    >
      <form id="new-appointment" onSubmit={onSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <ClientPicker value={client} onChange={setClient} />

        {packages.length > 0 && (
          <div className="flex rounded-lg bg-bg p-0.5" role="tablist">
            {(['service', 'package'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-md px-3 py-1.5 text-sm ${mode === m ? 'bg-surface font-medium shadow-sm' : 'text-muted'}`}>
                {m === 'service' ? 'Servicio' : 'Paquete'}
              </button>
            ))}
          </div>
        )}

        {mode === 'service' && (<>
        <Field label="Servicio *" htmlFor="nservice">
          <Select id="nservice" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.durationMin} min · {formatMoney(s.price)}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Colaboradora</legend>
          <div className="flex flex-wrap gap-2">
            {[{ id: 'any', displayName: 'Cualquiera', color: '#E4E8E3' }, ...staffOptions].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStaffId(s.id)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${staffId === s.id ? 'border-primary bg-primary/10 font-medium' : 'border-border'}`}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.displayName}
              </button>
            ))}
          </div>
        </fieldset>
        </>)}

        {mode === 'package' && (
          <Field label="Paquete *" htmlFor="npackage">
            <Select id="npackage" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {Math.floor(p.totalMin / 60)} h {p.totalMin % 60} min · {formatMoney(p.price)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Fecha" htmlFor="ndate">
          <Input id="ndate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {mode === 'package' && <PlanPicker plans={plans} value={plan} onChange={setPlan} />}

        {mode === 'service' && !overbooking && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Hora *</p>
            <SlotPicker slots={slots} value={slot} onChange={setSlot} />
            {slot && staffId === 'any' && <p className="mt-2 text-xs text-muted">Se asignará a {slot.staff[0]?.name}.</p>}
          </div>
        )}

        {mode === 'service' && can('appointments.overbook') && (
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overbooking} onChange={(e) => setOverbooking(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              Sobre-turno (forzar fuera de disponibilidad)
            </label>
            {overbooking && (
              <div className="mt-3 space-y-3">
                <Alert tone="warning">
                  <span className="flex gap-2">
                    <AlertTriangle className="size-4 shrink-0" /> Queda resaltado en la agenda y registrado en la auditoría. Elige una colaboradora concreta.
                  </span>
                </Alert>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Hora" htmlFor="ftime">
                    <Input id="ftime" type="time" step={900} value={forcedTime} onChange={(e) => setForcedTime(e.target.value)} />
                  </Field>
                  <Field label="Motivo *" htmlFor="freason">
                    <Input id="freason" value={overReason} onChange={(e) => setOverReason(e.target.value)} />
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Origen</legend>
          <div className="flex gap-4 text-sm">
            {SOURCES.map((s) => (
              <label key={s.value} className="flex items-center gap-2">
                <input type="radio" checked={source === s.value} onChange={() => setSource(s.value)} className="accent-[var(--color-primary)]" />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Notas internas" htmlFor="nnotes">
          <Input id="nnotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Field>
      </form>
    </Sheet>
  );
}

/** Buscador de clientas con alta rápida (nombre + teléfono). */
export function ClientPicker({ value, onChange }: { value: ClientFull | null; onChange: (c: ClientFull | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClientFull[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value || q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      void api<{ data: ClientFull[] }>(`/clients?q=${encodeURIComponent(q.trim())}&pageSize=6`).then((r) => setResults(r.data));
    }, 250);
    return () => clearTimeout(t);
  }, [q, value]);

  const [firstName, ...rest] = useMemo(() => name.trim().split(/\s+/), [name]);

  async function quickCreate() {
    setError(null);
    try {
      const c = await api<ClientFull>('/clients', {
        method: 'POST',
        body: JSON.stringify({ firstName, lastName: rest.join(' '), phone: phone || undefined, source: 'WHATSAPP', privacyConsent: false }),
      });
      onChange(c);
      setCreating(false);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError([p?.title, p?.detail].filter(Boolean).join(': ') || 'No se pudo crear');
    }
  }

  if (value) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-medium">Clienta *</p>
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <strong>{value.name}</strong> <span className="text-muted">{value.phone}</span>
            {value.allergies && <span className="ml-2 text-danger">⚠ {value.allergies}</span>}
          </span>
          <button type="button" className="text-xs text-primary underline" onClick={() => onChange(null)}>
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">Clienta *</p>
      {creating ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          {error && <Alert>{error}</Alert>}
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" aria-label="Nombre" autoFocus />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono" type="tel" inputMode="tel" aria-label="Teléfono" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" type="button" onClick={() => setCreating(false)}>
              Volver
            </Button>
            <Button size="sm" type="button" disabled={!firstName || firstName.length < 2} onClick={() => void quickCreate()}>
              Crear y usar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o teléfono" className="pl-9" aria-label="Buscar clienta" />
            </div>
            <Button type="button" variant="secondary" onClick={() => { setCreating(true); setName(q); }} aria-label="Nueva clienta">
              <UserPlus className="size-4" />
            </Button>
          </div>
          {results.length > 0 && (
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onChange(c)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-bg">
                    <span>{c.name}</span>
                    <span className="text-xs text-muted">
                      {c.phone} · {c.stats.visits} visitas
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
