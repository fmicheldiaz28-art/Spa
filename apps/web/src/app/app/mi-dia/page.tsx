'use client';

import { AlertTriangle, CalendarHeart } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppointmentSheet } from '@/components/agenda/appointment-sheet';
import { Alert, Badge, Button } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { ACTION_LABELS, type Appointment, type CalendarData, STATUS, timeOf } from '@/lib/appointments';
import { useAuth } from '@/lib/auth';
import { LiveDot, useLiveUpdates } from '@/lib/live';
import { todayLocal } from '@/lib/schedule';

/** "Mi día" de la especialista (docs/09-ux-ui.md §15.7): solo sus citas, sin montos ni contactos. */
export default function MyDayPage() {
  const { user } = useAuth();
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayLocal();

  const load = useCallback(async () => {
    try {
      setData(await api<CalendarData>(`/appointments/calendar?from=${today}&to=${today}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar tu día');
    }
  }, [today]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000); // respaldo de la conexión en vivo
    return () => clearInterval(t);
  }, [load]);

  const live = useLiveUpdates(() => void load());

  async function act(a: Appointment, action: 'check-in' | 'complete' | 'no-show') {
    setBusy(a.id);
    setError(null);
    try {
      await api(`/appointments/${a.id}/${action}`, { method: 'POST', headers: { 'If-Match': `"${a.version}"` } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? [err.problem.title, err.problem.detail].filter(Boolean).join('. ') : 'No se pudo actualizar');
    } finally {
      setBusy(null);
    }
  }

  const list = (data?.appointments ?? []).filter((a) => a.status !== 'CANCELADA');
  const active = list.filter((a) => ['CONFIRMADA', 'PENDIENTE', 'EN_CURSO'].includes(a.status));
  const next = active.find((a) => new Date(a.endAt) > new Date());
  const minutes = list.reduce((sum, a) => sum + a.items.reduce((s, i) => s + i.durationMin, 0), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Hola, {user?.firstName} 🌿</h1>
        <LiveDot status={live} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {list.length ? `${list.length} ${list.length === 1 ? 'cita' : 'citas'} hoy · ${Math.floor(minutes / 60)} h ${minutes % 60} min` : 'Aquí verás solo tus citas del día.'}
        {next && ` · Próxima: ${timeOf(next.startAt)}`}
      </p>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      {data && list.length === 0 && (
        <div className="mt-6 flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <CalendarHeart className="size-10 text-primary" aria-hidden />
          <p className="mt-3 font-medium">No tienes citas hoy</p>
          <p className="mt-1 text-sm text-muted">¡Disfruta tu día! Si Administración te asigna una, aparecerá aquí.</p>
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {list.map((a) => {
          const done = a.status === 'COMPLETADA' || a.status === 'NO_SHOW';
          return (
            <li key={a.id} className={`rounded-xl border bg-surface p-4 ${a.id === next?.id ? 'border-primary shadow-sm' : 'border-border'} ${done ? 'opacity-70' : ''}`}>
              <button className="w-full text-left" onClick={() => setSelected(a)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="tabular text-lg font-semibold">{timeOf(a.startAt)}</span>
                  <Badge tone={STATUS[a.status].tone}>
                    {STATUS[a.status].icon} {STATUS[a.status].label}
                  </Badge>
                </div>
                <p className="mt-1 font-medium">{a.client.name}</p>
                <p className="text-sm text-muted">{a.items.map((i) => `${i.serviceName} · ${i.durationMin} min`).join(' + ')}</p>
                {(a.client.allergies || a.client.contraindications) && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger/5 px-2 py-1.5 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {[a.client.allergies, a.client.contraindications].filter(Boolean).join(' · ')}
                  </p>
                )}
                {a.client.preferences && <p className="mt-2 text-sm text-muted">💬 {a.client.preferences}</p>}
              </button>
              {!done && (
                <div className="mt-3 flex gap-2">
                  {a.actions.includes('check-in') && (
                    <Button className="flex-1" disabled={busy === a.id} onClick={() => void act(a, 'check-in')}>
                      ▶ {ACTION_LABELS['check-in']}
                    </Button>
                  )}
                  {a.actions.includes('complete') && a.status === 'EN_CURSO' && (
                    <Button className="flex-1" disabled={busy === a.id} onClick={() => void act(a, 'complete')}>
                      ✓ {ACTION_LABELS.complete}
                    </Button>
                  )}
                  {a.actions.includes('no-show') && (
                    <Button variant="secondary" disabled={busy === a.id} onClick={() => void act(a, 'no-show')}>
                      ✗ {ACTION_LABELS['no-show']}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-center text-sm">
        <Link href="/app/agenda?view=week" className="text-primary hover:underline">
          Ver mi semana →
        </Link>
      </p>

      {selected && <AppointmentSheet appointment={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />}
    </div>
  );
}
