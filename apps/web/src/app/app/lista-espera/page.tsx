'use client';

import { BellRing, CalendarCheck, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ClientPicker } from '@/components/agenda/new-appointment-sheet';
import { Alert, Badge, type BadgeTone, Button, EmptyState, Field, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { formatLongDay } from '@/lib/appointments';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLiveUpdates } from '@/lib/live';
import { todayLocal } from '@/lib/schedule';
import type { ClientFull, Service } from '@/lib/types';

interface Entry {
  id: string;
  date: string;
  timeFrom: string | null;
  timeTo: string | null;
  status: 'ACTIVA' | 'NOTIFICADA' | 'CONVERTIDA' | 'VENCIDA' | 'CANCELADA';
  source: 'ONLINE' | 'ADMIN';
  notes: string | null;
  notifiedAt: string | null;
  notifyCount: number;
  createdAt: string;
  service: { id: string; name: string; durationMin: number };
  staff: { id: string; name: string } | null;
  client: { id: string; name: string; phone: string | null; hasEmail: boolean };
  freeSlots: string[];
}

const STATUS: Record<Entry['status'], { label: string; tone: BadgeTone }> = {
  ACTIVA: { label: 'Esperando', tone: 'info' },
  NOTIFICADA: { label: 'Avisada por email', tone: 'success' },
  CONVERTIDA: { label: 'Agendada', tone: 'primary' },
  VENCIDA: { label: 'Venció', tone: 'neutral' },
  CANCELADA: { label: 'Cancelada', tone: 'neutral' },
};

const windowLabel = (e: Pick<Entry, 'timeFrom' | 'timeTo'>) => {
  if (!e.timeFrom && !e.timeTo) return 'Cualquier hora';
  if (e.timeFrom === '00:00' && e.timeTo === '13:00') return 'Mañana';
  if (e.timeFrom === '13:00') return 'Tarde';
  return `${e.timeFrom ?? '…'}–${e.timeTo ?? '…'}`;
};

/** Lista de espera (Fase 2): quién espera un horario y si ya hay lugar para llamarla. */
export default function WaitlistPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('waitlist.manage');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  const load = useCallback(async () => {
    try {
      setEntries(await api<Entry[]>(`/waitlist?status=${showAll ? 'all' : 'open'}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar la lista');
    }
  }, [showAll]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  // Una cancelación en la agenda puede liberar lugar: se recalcula al instante.
  useLiveUpdates(() => void load(), allowed);

  async function setStatus(e: Entry, status: 'CANCELADA' | 'CONVERTIDA') {
    setError(null);
    try {
      await api(`/waitlist/${e.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(status === 'CONVERTIDA' ? `${e.client.name} quedó como agendada.` : `Se quitó a ${e.client.name} de la lista.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo actualizar');
    }
  }

  if (!allowed) return null;

  const byDate = new Map<string, Entry[]>();
  for (const e of entries ?? []) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const withSpace = (entries ?? []).filter((e) => e.freeSlots.length > 0).length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lista de espera</h1>
          <p className="mt-1 text-sm text-muted">
            Clientas que esperan un horario. Si se libera uno, el sistema avisa por email a quien lo tiene; a las demás, llámalas tú.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Anotar clienta
        </Button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {withSpace > 0 && (
          <Badge tone="success">
            <BellRing className="size-3" /> {withSpace} {withSpace === 1 ? 'espera tiene' : 'esperas tienen'} lugar ahora
          </Badge>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Mostrar también cerradas
        </label>
      </div>

      <div className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {entries?.length === 0 && <EmptyState title="Nadie en lista de espera" description="Las clientas pueden anotarse desde la página de reservas cuando un día está lleno." />}
        {[...byDate.entries()].map(([date, list]) => (
          <section key={date} className="overflow-hidden rounded-xl border border-border bg-surface">
            <h2 className="border-b border-border bg-bg/60 px-4 py-2 text-sm font-semibold first-letter:uppercase">{formatLongDay(date)}</h2>
            <ul className="divide-y divide-border">
              {list.map((e) => {
                const open = e.status === 'ACTIVA' || e.status === 'NOTIFICADA';
                return (
                  <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <Link href={`/app/clientes/${e.client.id}`} className="hover:underline">
                          {e.client.name}
                        </Link>{' '}
                        <span className="font-normal text-muted">{e.client.phone ?? 'sin teléfono'}</span>
                        {!e.client.hasEmail && <span className="ml-1 text-xs text-warning">· sin email: avisar por teléfono</span>}
                      </p>
                      <p className="text-muted">
                        {e.service.name}
                        {e.staff ? ` · con ${e.staff.name}` : ' · cualquier especialista'} · {windowLabel(e)}
                      </p>
                      {e.notes && <p className="text-muted">📝 {e.notes}</p>}
                      <p className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
                        {e.source === 'ONLINE' && <Badge tone="info">Online</Badge>}
                        {e.notifiedAt && <span className="text-xs text-muted">Último aviso {formatDateTime(e.notifiedAt)}</span>}
                      </p>
                      {open && e.freeSlots.length > 0 && (
                        <p className="mt-2 rounded-lg bg-success/10 px-2 py-1 text-success">
                          <BellRing className="mr-1 inline size-3.5" />
                          Hay lugar: {e.freeSlots.slice(0, 8).join(', ')}
                          {e.freeSlots.length > 8 ? '…' : ''}
                        </p>
                      )}
                    </div>
                    {open && (
                      <div className="flex gap-2">
                        <Link
                          href={`/app/agenda?view=day&date=${e.date}`}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-bg"
                          title="Abrir la agenda de ese día"
                        >
                          <CalendarCheck className="size-4" /> Agenda
                        </Link>
                        <Button size="sm" variant="secondary" onClick={() => void setStatus(e, 'CONVERTIDA')}>
                          Agendada
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Quitar a ${e.client.name}`} onClick={() => void setStatus(e, 'CANCELADA')}>
                          <X className="size-4" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <AddSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(name) => {
          setAdding(false);
          setNotice(`${name} quedó en la lista de espera.`);
          void load();
        }}
      />
    </div>
  );
}

function AddSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (name: string) => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [client, setClient] = useState<ClientFull | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [range, setRange] = useState<'any' | 'morning' | 'afternoon' | 'custom'>('any');
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('12:00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClient(null);
    setServiceId('');
    setStaffId('');
    setDate(todayLocal());
    setRange('any');
    setNotes('');
    setError(null);
    void api<Service[]>('/services?active=true').then(setServices);
  }, [open]);

  const service = services.find((s) => s.id === serviceId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    const window = { any: [null, null], morning: ['00:00', '13:00'], afternoon: ['13:00', '23:59'], custom: [from, to] }[range];
    setBusy(true);
    setError(null);
    try {
      await api('/waitlist', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id, serviceId, staffId: staffId || null, date, timeFrom: window[0], timeTo: window[1], notes: notes || null }),
      });
      onAdded(client.name);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError([p?.title, p?.detail, ...(p?.errors?.map((x) => x.message) ?? [])].filter(Boolean).join('. ') || 'No se pudo anotar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Anotar en lista de espera"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="waitlist-form" disabled={busy || !client || !serviceId || !date}>
            {busy ? 'Guardando…' : 'Anotar'}
          </Button>
        </>
      }
    >
      <form id="waitlist-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <ClientPicker value={client} onChange={setClient} />
        <Field label="Servicio *" htmlFor="wl-service">
          <Select
            id="wl-service"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setStaffId('');
            }}
          >
            <option value="">Elige un servicio</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Especialista" htmlFor="wl-staff">
          <Select id="wl-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!service}>
            <option value="">Cualquiera</option>
            {service?.staff
              .filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Día *" htmlFor="wl-day">
          <Input id="wl-day" type="date" min={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Horario que le sirve" htmlFor="wl-range">
          <Select id="wl-range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            <option value="any">Cualquier hora</option>
            <option value="morning">Mañana (hasta las 13:00)</option>
            <option value="afternoon">Tarde (desde las 13:00)</option>
            <option value="custom">Rango específico</option>
          </Select>
        </Field>
        {range === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde" htmlFor="wl-from">
              <Input id="wl-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Hasta" htmlFor="wl-to">
              <Input id="wl-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Nota" htmlFor="wl-notes">
          <Input id="wl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: llamarla después de las 18:00" />
        </Field>
      </form>
    </Sheet>
  );
}
