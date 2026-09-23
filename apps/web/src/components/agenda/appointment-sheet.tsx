'use client';

import { AlertTriangle, Clock, Globe, User } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import {
  ACTION_LABELS,
  type Action,
  type Appointment,
  CANCEL_REASONS,
  formatLongDay,
  localDateOf,
  type Slot,
  SOURCE_LABELS,
  STATUS,
  timeOf,
} from '@/lib/appointments';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/types';
import { PaymentPanel } from './payment-panel';

interface HistoryEvent {
  id: string;
  occurredAt: string;
  action: string;
  actor: string;
  reason: string | null;
}

const HISTORY_LABELS: Record<string, string> = {
  CREATE: 'Creada',
  OVERBOOKING: 'Creada como sobre-turno',
  RESCHEDULE: 'Reagendada',
  STATUS_CHANGE: 'Cambio de estado',
  CANCEL: 'Cancelada',
  REVERT_STATUS: 'Estado corregido',
  UPDATE: 'Notas editadas',
  DELETE: 'Eliminada',
  RESTORE: 'Restaurada',
};

type Mode = 'view' | 'reschedule' | 'cancel' | 'delete';

/** Panel lateral de una cita (docs/09-ux-ui.md §15.5). */
export function AppointmentSheet({ appointment, onClose, onChanged }: { appointment: Appointment | null; onClose: () => void; onChanged: () => void }) {
  const { can, user } = useAuth();
  const [current, setCurrent] = useState<Appointment | null>(appointment);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [mode, setMode] = useState<Mode>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCurrent(appointment);
    setMode('view');
    setError(null);
    if (appointment) void api<HistoryEvent[]>(`/appointments/${appointment.id}/history`).then(setHistory).catch(() => setHistory([]));
  }, [appointment]);

  if (!current) return null;
  const a = current;
  const mine = a.items.some((i) => i.staff.id === user?.staffId);
  const canStatus = can('appointments.update_status_all') || (can('appointments.update_status_own') && mine);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Appointment>(path, {
        method: 'POST',
        headers: { 'If-Match': `"${a.version}"` },
        body: body ? JSON.stringify(body) : undefined,
      });
      setCurrent(updated);
      setMode('view');
      onChanged();
      void api<HistoryEvent[]>(`/appointments/${a.id}/history`).then(setHistory);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError([p?.title, p?.detail].filter(Boolean).join('. ') || 'No se pudo completar la acción');
    } finally {
      setBusy(false);
    }
  }

  const actionAllowed = (action: Action) => {
    if (action === 'cancel') return false; // tiene su propio formulario
    if (action === 'confirm') return can('appointments.update');
    return canStatus;
  };

  return (
    <Sheet open onClose={onClose} title={a.code}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS[a.status].tone}>
            {STATUS[a.status].icon} {STATUS[a.status].label}
          </Badge>
          <Badge tone={a.source === 'ONLINE' ? 'info' : 'neutral'}>
            {a.source === 'ONLINE' && <Globe className="size-3" />} {SOURCE_LABELS[a.source]}
          </Badge>
          {a.isOverbooking && <Badge tone="warning">Sobre-turno</Badge>}
          {a.rescheduleCount > 0 && <Badge>Reagendada ×{a.rescheduleCount}</Badge>}
        </div>

        <div className="flex items-start gap-3">
          <User className="mt-0.5 size-4 text-muted" />
          <div className="flex-1">
            <p className="font-medium">{a.client.name}</p>
            {(can('clients.read_all') || can('clients.read_assigned')) && (
              <Link href={`/app/clientes/${a.client.id}`} className="text-xs text-primary hover:underline">
                Ver ficha
              </Link>
            )}
          </div>
        </div>

        {(a.client.allergies || a.client.contraindications) && (
          <div className="flex gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-danger" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              {a.client.allergies && <p>Alergia: {a.client.allergies}</p>}
              {a.client.contraindications && <p>Contraindicación: {a.client.contraindications}</p>}
            </div>
          </div>
        )}
        {a.client.preferences && <p className="rounded-lg bg-bg px-3 py-2 text-muted">💬 {a.client.preferences}</p>}

        <ul className="space-y-2">
          {a.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className="size-3 rounded-full" style={{ backgroundColor: i.staff.color }} />
              <div className="flex-1">
                <p className="font-medium">{i.serviceName}</p>
                <p className="text-xs text-muted">
                  {i.staff.displayName} · {timeOf(i.startAt)}–{timeOf(i.endAt)}
                </p>
              </div>
              {i.price && <span className="tabular">{formatMoney(i.price)}</span>}
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 text-muted">
          <Clock className="size-4" /> <span className="first-letter:uppercase">{formatLongDay(localDateOf(a.startAt))}</span> · {timeOf(a.startAt)}–{timeOf(a.endAt)}
        </p>
        {a.total && <p className="text-right font-semibold">Total {formatMoney(a.total)}</p>}
        {a.clientNotes && <p className="text-muted">📝 {a.clientNotes}</p>}
        {a.internalNotes && <p className="text-muted">🔒 {a.internalNotes}</p>}
        {a.status === 'CANCELADA' && a.cancelReason && (
          <Alert tone="warning">
            Cancelada por {a.cancelledByType === 'CLIENTE' ? 'la clienta' : 'el spa'}: {a.cancelReason}
          </Alert>
        )}

        {error && <Alert>{error}</Alert>}

        {mode === 'view' && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {a.actions.filter(actionAllowed).map((action) => (
              <Button key={action} size="sm" variant={action === 'no-show' ? 'secondary' : 'primary'} disabled={busy} onClick={() => void run(`/appointments/${a.id}/${action}`)}>
                {ACTION_LABELS[action]}
              </Button>
            ))}
            {can('appointments.reschedule') && (a.status === 'CONFIRMADA' || a.status === 'PENDIENTE') && (
              <Button size="sm" variant="secondary" onClick={() => setMode('reschedule')}>
                Reagendar
              </Button>
            )}
            {can('appointments.cancel') && a.actions.includes('cancel') && (
              <Button size="sm" variant="secondary" onClick={() => setMode('cancel')}>
                Cancelar
              </Button>
            )}
            {can('appointments.revert_status') && ['NO_SHOW', 'COMPLETADA', 'CANCELADA'].includes(a.status) && (
              <Button size="sm" variant="ghost" onClick={() => {
                const reason = window.prompt('Motivo de la corrección (se vuelve a "Confirmada")');
                if (reason && reason.trim().length >= 3) void run(`/appointments/${a.id}/revert-status`, { toStatus: 'CONFIRMADA', reason });
              }}>
                Corregir estado
              </Button>
            )}
            {can('appointments.delete') && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setMode('delete')}>
                Eliminar
              </Button>
            )}
          </div>
        )}

        {mode === 'view' && can('payments.read_all') && a.status !== 'PENDIENTE' && (
          <PaymentPanel appointmentId={a.id} cancelled={a.status === 'CANCELADA'} onChanged={onChanged} />
        )}

        {mode === 'reschedule' && <RescheduleForm appointment={a} busy={busy} onCancel={() => setMode('view')} onSubmit={(body) => void run(`/appointments/${a.id}/reschedule`, body)} />}
        {mode === 'cancel' && (
          <CancelForm busy={busy} onCancel={() => setMode('view')} onSubmit={(body) => void run(`/appointments/${a.id}/cancel`, body)} />
        )}
        {mode === 'delete' && (
          <DeleteForm
            busy={busy}
            onCancel={() => setMode('view')}
            onSubmit={async (reason) => {
              setBusy(true);
              try {
                await api(`/appointments/${a.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
                onChanged();
                onClose();
              } catch (err) {
                setError(err instanceof ApiError ? err.problem.title : 'No se pudo eliminar');
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {history.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 font-medium">Historial</p>
            <ol className="space-y-2 border-l border-border pl-4">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary" />
                  <p>
                    {HISTORY_LABELS[h.action] ?? h.action} <span className="text-muted">por {h.actor}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateTime(h.occurredAt)}
                    {h.reason && ` · ${h.reason}`}
                  </p>
                </li>
              ))}
            </ol>
            {can('audit.read') && (
              <Link href={`/app/auditoria?entityId=${a.id}`} className="mt-2 inline-block text-xs text-primary hover:underline">
                Ver auditoría completa →
              </Link>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function RescheduleForm({ appointment, busy, onCancel, onSubmit }: { appointment: Appointment; busy: boolean; onCancel: () => void; onSubmit: (body: unknown) => void }) {
  const item = appointment.items[0]!;
  const [date, setDate] = useState(localDateOf(appointment.startAt));
  const [anyStaff, setAnyStaff] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setSlots(null);
    setSlot(null);
    const staff = anyStaff ? 'any' : item.staff.id;
    void api<{ slots: Slot[] }>(`/availability/slots?serviceId=${item.serviceId}&staffId=${staff}&date=${date}`)
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  }, [date, anyStaff, item.serviceId, item.staff.id]);

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="font-medium">Reagendar {item.serviceName}</p>
      <Field label="Fecha" htmlFor="rdate">
        <Input id="rdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={anyStaff} onChange={(e) => setAnyStaff(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
        Permitir otra colaboradora
      </label>
      <SlotPicker slots={slots} value={slot} onChange={setSlot} />
      <Field label="Motivo (opcional)" htmlFor="rreason">
        <Input id="rreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: la clienta pidió otro horario" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Volver
        </Button>
        <Button
          size="sm"
          disabled={!slot || busy}
          onClick={() =>
            slot &&
            onSubmit({
              items: [{ itemId: item.id, startAt: slot.startAt, staffId: slot.staff.some((s) => s.id === item.staff.id) ? item.staff.id : slot.staff[0]!.id }],
              reason: reason || null,
            })
          }
        >
          Mover cita
        </Button>
      </div>
    </div>
  );
}

export function SlotPicker({ slots, value, onChange }: { slots: Slot[] | null; value: Slot | null; onChange: (s: Slot) => void }) {
  if (!slots) return <p className="text-xs text-muted">Buscando horarios…</p>;
  if (!slots.length) return <p className="text-xs text-muted">No hay horarios disponibles ese día.</p>;
  const groups = [
    { label: 'Mañana', items: slots.filter((s) => s.time < '13:00') },
    { label: 'Tarde', items: slots.filter((s) => s.time >= '13:00') },
  ].filter((g) => g.items.length);
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 text-xs text-muted">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((s) => (
              <button
                key={s.startAt}
                type="button"
                onClick={() => onChange(s)}
                title={s.staff.map((x) => x.name).join(', ')}
                className={`rounded-md border px-2.5 py-1 text-xs tabular-nums transition ${value?.startAt === s.startAt ? 'border-primary bg-primary text-white' : 'border-border hover:border-primary'}`}
              >
                {s.time}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CancelForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (body: unknown) => void }) {
  const [preset, setPreset] = useState(CANCEL_REASONS[0]!);
  const [other, setOther] = useState('');
  const [by, setBy] = useState<'CLIENTE' | 'SPA'>('CLIENTE');
  const reason = preset === 'Otro' ? other : preset;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="font-medium">Cancelar cita</p>
      <Field label="Motivo *" htmlFor="creason">
        <Select id="creason" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {[...CANCEL_REASONS, 'Otro'].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </Field>
      {preset === 'Otro' && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Describe el motivo" aria-label="Otro motivo" />}
      <div className="flex gap-4">
        {(['CLIENTE', 'SPA'] as const).map((v) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" checked={by === v} onChange={() => setBy(v)} className="accent-[var(--color-primary)]" />
            {v === 'CLIENTE' ? 'La clienta canceló' : 'El spa canceló'}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Volver
        </Button>
        <Button size="sm" variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit({ reason, cancelledByType: by })}>
          Cancelar cita
        </Button>
      </div>
    </div>
  );
}

function DeleteForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3 rounded-lg border border-danger/30 p-3">
      <p className="font-medium">Eliminar cita</p>
      <p className="text-muted">Úsalo solo para citas creadas por error. Quedará registrada en la auditoría y se puede restaurar.</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo obligatorio" aria-label="Motivo" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Volver
        </Button>
        <Button size="sm" variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(reason)}>
          Eliminar
        </Button>
      </div>
    </div>
  );
}

