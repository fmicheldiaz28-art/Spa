'use client';

import { CalendarPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MonthCalendar } from '@/components/booking/month-calendar';
import { Alert, Badge, Button } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatLongDay, STATUS } from '@/lib/appointments';
import { googleCalendarUrl, type PublicAppointment, publicApi, type PublicSlot } from '@/lib/public-api';
import { todayLocal } from '@/lib/schedule';
import { formatMoney } from '@/lib/types';

/**
 * Tarjeta de una reserva con acciones de la clienta (cancelar / reagendar dentro de la política).
 * `actionBase` es el prefijo de la API: por enlace de gestión o por sesión de clienta.
 */
export function ReservationCard({
  appointment,
  actionBase,
  clientToken,
  onChanged,
}: {
  appointment: PublicAppointment;
  actionBase: string;
  clientToken?: string | null;
  onChanged: (a: PublicAppointment) => void;
}) {
  const a = appointment;
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await publicApi<PublicAppointment>(`${actionBase}/cancel`, { method: 'POST', clientToken }));
      setMode('view');
    } catch (err) {
      setError(err instanceof ApiError ? [err.problem.title, err.problem.detail].filter(Boolean).join('. ') : 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  }

  const upcoming = new Date(a.startAt) > new Date();
  const st = STATUS[a.status];

  return (
    <article className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">{a.code}</p>
          <p className="text-lg font-medium">{a.service.name}</p>
          <p className="text-sm first-letter:uppercase">
            {formatLongDay(a.localDate)} · {a.localTime}
          </p>
          <p className="text-sm text-muted">
            Con {a.staff.name} · {formatMoney(a.total)}
          </p>
        </div>
        <Badge tone={st.tone}>
          {st.icon} {st.label}
        </Badge>
      </div>

      {error && <div className="mt-3"><Alert>{error}</Alert></div>}

      {mode === 'view' && upcoming && (a.status === 'CONFIRMADA' || a.status === 'PENDIENTE') && (
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={googleCalendarUrl(a, 'NaturalSpa')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm"
          >
            <CalendarPlus className="size-4" /> Calendario
          </a>
          {a.canReschedule && (
            <Button size="sm" variant="secondary" onClick={() => setMode('reschedule')}>
              Reagendar
            </Button>
          )}
          {a.canCancel && (
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setMode('cancel')}>
              Cancelar
            </Button>
          )}
          {!a.canCancel && <p className="w-full text-xs text-muted">Faltan menos de {a.cancelUntilHours} h: para cambios escríbenos por WhatsApp.</p>}
        </div>
      )}

      {mode === 'cancel' && (
        <div className="mt-4 space-y-3 rounded-xl bg-danger/5 p-4">
          <p className="text-sm">¿Seguro que quieres cancelar esta reserva?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMode('view')}>
              No, mantener
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void cancel()}>
              Sí, cancelar
            </Button>
          </div>
        </div>
      )}

      {mode === 'reschedule' && (
        <Reschedule
          appointment={a}
          actionBase={actionBase}
          clientToken={clientToken}
          onDone={(updated) => {
            onChanged(updated);
            setMode('view');
          }}
          onCancel={() => setMode('view')}
        />
      )}
    </article>
  );
}

function Reschedule({
  appointment: a,
  actionBase,
  clientToken,
  onDone,
  onCancel,
}: {
  appointment: PublicAppointment;
  actionBase: string;
  clientToken?: string | null;
  onDone: (a: PublicAppointment) => void;
  onCancel: () => void;
}) {
  const today = todayLocal();
  const [month, setMonth] = useState(a.localDate.slice(0, 7) < today.slice(0, 7) ? today.slice(0, 7) : a.localDate.slice(0, 7));
  const [days, setDays] = useState<Set<string> | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDays(null);
    void publicApi<{ days: { date: string; available: boolean }[] }>(`/availability/days?serviceId=${a.service.id}&staffId=${a.staff.id}&month=${month}`)
      .then((r) => setDays(new Set(r.days.filter((d) => d.available).map((d) => d.date))))
      .catch(() => setDays(new Set()));
  }, [a.service.id, a.staff.id, month]);

  useEffect(() => {
    if (!date) return;
    setSlots(null);
    void publicApi<{ slots: PublicSlot[] }>(`/availability/slots?serviceId=${a.service.id}&staffId=${a.staff.id}&date=${date}`).then((r) => setSlots(r.slots));
  }, [a.service.id, a.staff.id, date]);

  async function move(slot: PublicSlot) {
    setError(null);
    try {
      onDone(await publicApi<PublicAppointment>(`${actionBase}/reschedule`, { method: 'POST', body: JSON.stringify({ startAt: slot.startAt }), clientToken }));
    } catch (err) {
      setError(err instanceof ApiError ? [err.problem.title, err.problem.detail].filter(Boolean).join('. ') : 'No se pudo reagendar');
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm font-medium">Elige el nuevo día y hora con {a.staff.name}</p>
      {error && <Alert>{error}</Alert>}
      <MonthCalendar month={month} available={days} selected={date} onMonth={setMonth} onSelect={setDate} minMonth={today.slice(0, 7)} maxMonth="9999-12" />
      {date && (
        <div className="grid grid-cols-4 gap-2">
          {!slots && <p className="col-span-4 text-sm text-muted">Buscando horarios…</p>}
          {slots?.length === 0 && <p className="col-span-4 text-sm text-muted">Sin horarios ese día.</p>}
          {slots?.map((s) => (
            <button key={s.startAt} onClick={() => void move(s)} className="rounded-xl border border-border py-2 text-sm tabular-nums hover:border-primary">
              {s.time}
            </button>
          ))}
        </div>
      )}
      <Button size="sm" variant="secondary" onClick={onCancel}>
        Volver
      </Button>
    </div>
  );
}
