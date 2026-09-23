'use client';

import { AlertTriangle, ChevronLeft, ChevronRight, Globe, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AppointmentSheet } from '@/components/agenda/appointment-sheet';
import { type NewAppointmentPreset, NewAppointmentSheet } from '@/components/agenda/new-appointment-sheet';
import { Alert, Button, Dialog, EmptyState, Select } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import {
  addDays,
  type Appointment,
  type AppointmentItem,
  type CalendarData,
  formatLongDay,
  localDateOf,
  localMinutes,
  STATUS,
  timeOf,
  toHHMM,
  toInstant,
  toMinutes,
  weekStart,
} from '@/lib/appointments';
import { useAuth } from '@/lib/auth';
import { LiveDot, useLiveUpdates } from '@/lib/live';
import { todayLocal } from '@/lib/schedule';

type View = 'day' | 'week' | 'month' | 'list';

const SLOT_MIN = 15;
const PX_PER_MIN = 1.1; // 15 min ≈ 16.5 px, 1 h ≈ 66 px

interface DragState {
  appointment: Appointment;
  item: AppointmentItem;
}

interface PendingMove {
  appointment: Appointment;
  item: AppointmentItem;
  staffId: string;
  staffName: string;
  date: string;
  time: string;
}

function AgendaContent() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayLocal();
  const date = params.get('date') ?? today;
  const view = (params.get('view') as View | null) ?? (typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'day');
  const staffFilter = params.get('staff') ?? '';
  const canCreate = can('appointments.create');

  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [preset, setPreset] = useState<NewAppointmentPreset | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moving, setMoving] = useState(false);
  const [allStaff, setAllStaff] = useState<CalendarData['staff']>([]);

  const range = useMemo(() => {
    if (view === 'week') {
      const start = weekStart(date);
      return { from: start, to: addDays(start, 6) };
    }
    if (view === 'month') {
      // Cuadrícula de 6 semanas que contiene el mes completo.
      const start = weekStart(`${date.slice(0, 8)}01`);
      return { from: start, to: addDays(start, 41) };
    }
    return { from: date, to: date };
  }, [date, view]);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/app/agenda?${next}`);
  };

  const load = useCallback(async () => {
    try {
      const d = await api<CalendarData>(`/appointments/calendar?from=${range.from}&to=${range.to}${staffFilter ? `&staffId=${staffFilter}` : ''}`);
      setData(d);
      if (!staffFilter) setAllStaff(d.staff); // el selector conserva a todas aunque se filtre
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar la agenda');
    }
  }, [range, staffFilter]);

  useEffect(() => {
    void load();
    // Respaldo por si se corta la conexión en vivo.
    const t = setInterval(() => void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  // RF-AGE-16: los cambios hechos por otras personas aparecen en segundos.
  const live = useLiveUpdates(() => void load());

  const shiftDate = (dir: -1 | 1) => {
    if (view === 'month') {
      const [y, m] = date.split('-').map(Number) as [number, number];
      return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
    }
    return addDays(date, dir * (view === 'week' ? 7 : 1));
  };

  async function confirmMove() {
    if (!pendingMove) return;
    setMoving(true);
    try {
      await api(`/appointments/${pendingMove.appointment.id}/reschedule`, {
        method: 'POST',
        headers: { 'If-Match': `"${pendingMove.appointment.version}"` },
        body: JSON.stringify({ items: [{ itemId: pendingMove.item.id, staffId: pendingMove.staffId, startAt: toInstant(pendingMove.date, pendingMove.time) }] }),
      });
      setPendingMove(null);
      await load();
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError([p?.title, p?.detail].filter(Boolean).join('. ') || 'No se pudo mover la cita');
      setPendingMove(null);
    } finally {
      setMoving(false);
    }
  }

  const dayLabel =
    view === 'week'
      ? `${formatLongDay(range.from).split(',')[1]?.trim() ?? range.from} – ${formatLongDay(range.to).split(',')[1]?.trim() ?? range.to}`
      : view === 'month'
        ? new Date(`${date}T12:00:00Z`).toLocaleDateString('es-BO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : formatLongDay(date);

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold tracking-tight">{can('appointments.read_all') ? 'Agenda' : 'Mi agenda'}</h1>
        <LiveDot status={live} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setParam({ date: shiftDate(-1) })} aria-label="Anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setParam({ date: null })} disabled={date === today}>
            Hoy
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setParam({ date: shiftDate(1) })} aria-label="Siguiente">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setParam({ date: e.target.value })}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm"
          aria-label="Ir a fecha"
        />
        <span className="text-sm font-medium first-letter:uppercase">{dayLabel}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-surface p-0.5 ring-1 ring-border" role="tablist">
            {(['day', 'week', 'month', 'list'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setParam({ view: v })}
                className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
              >
                {{ day: 'Día', week: 'Semana', month: 'Mes', list: 'Lista' }[v]}
              </button>
            ))}
          </div>
          {can('appointments.read_all') && allStaff.length > 0 && (
            <Select value={staffFilter} onChange={(e) => setParam({ staff: e.target.value || null })} className="h-9 w-44" aria-label="Filtrar colaboradora">
              <option value="">Todas</option>
              {allStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </Select>
          )}
          {canCreate && (
            <Button size="sm" onClick={() => setPreset({ date: date < today ? today : date })}>
              <Plus className="size-4" /> Nueva cita
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <Alert>
            <span className="flex justify-between gap-3">
              {error}
              <button className="text-xs underline" onClick={() => setError(null)}>
                Cerrar
              </button>
            </span>
          </Alert>
        </div>
      )}

      <div className="mt-4">
        {!data ? (
          <div className="h-96 animate-pulse rounded-xl bg-surface" />
        ) : view === 'list' ? (
          <ListView data={data} onOpen={setSelected} />
        ) : view === 'month' ? (
          <MonthView data={data} month={date.slice(0, 7)} today={today} onDay={(d) => setParam({ date: d, view: 'day' })} />
        ) : view === 'week' ? (
          <WeekView data={data} today={today} onOpen={setSelected} onSlot={(d, t) => canCreate && setPreset({ date: d, time: t, staffId: staffFilter || undefined })} />
        ) : (
          <DayView
            data={data}
            date={date}
            isToday={date === today}
            onOpen={setSelected}
            onSlot={(staffId, time) => canCreate && date >= today && setPreset({ date, time, staffId })}
            draggable={can('appointments.reschedule')}
            onDragStart={setDrag}
            onDrop={(staffId, time) => {
              if (!drag) return;
              const staff = data.staff.find((s) => s.id === staffId);
              setPendingMove({ ...drag, staffId, staffName: staff?.displayName ?? '', date, time });
              setDrag(null);
            }}
          />
        )}
      </div>

      <Legend />

      {selected && (
        <AppointmentSheet
          appointment={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
      <NewAppointmentSheet
        preset={preset}
        onClose={() => setPreset(null)}
        onCreated={(a) => {
          setPreset(null);
          void load();
          setSelected(a);
        }}
      />
      <Dialog
        open={!!pendingMove}
        onClose={() => setPendingMove(null)}
        title="¿Mover la cita?"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setPendingMove(null)} disabled={moving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void confirmMove()} disabled={moving}>
              {moving ? 'Moviendo…' : 'Mover'}
            </Button>
          </>
        }
      >
        {pendingMove && (
          <p className="text-muted">
            <strong className="text-text">{pendingMove.appointment.client.name}</strong> · {pendingMove.item.serviceName}
            <br />
            {timeOf(pendingMove.item.startAt)} con {pendingMove.item.staff.displayName} → <strong className="text-text">{pendingMove.time}</strong> con{' '}
            <strong className="text-text">{pendingMove.staffName}</strong>
          </p>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista Día: columnas por colaboradora (docs/09-ux-ui.md §15.4)
// ---------------------------------------------------------------------------

function useDayBounds(data: CalendarData) {
  return useMemo(() => {
    let min = 9 * 60;
    let max = 19 * 60;
    for (const day of Object.values(data.availability)) {
      for (const s of Object.values(day)) {
        for (const w of s.workable) {
          min = Math.min(min, toMinutes(w.start));
          max = Math.max(max, toMinutes(w.end));
        }
      }
    }
    for (const a of data.appointments) {
      min = Math.min(min, localMinutes(a.startAt));
      max = Math.max(max, localMinutes(a.endAt));
    }
    return { start: Math.floor(min / 60) * 60, end: Math.ceil(max / 60) * 60 };
  }, [data]);
}

function DayView({
  data,
  date,
  isToday,
  onOpen,
  onSlot,
  draggable,
  onDragStart,
  onDrop,
}: {
  data: CalendarData;
  date: string;
  isToday: boolean;
  onOpen: (a: Appointment) => void;
  onSlot: (staffId: string, time: string) => void;
  draggable: boolean;
  onDragStart: (d: DragState) => void;
  onDrop: (staffId: string, time: string) => void;
}) {
  const { start, end } = useDayBounds(data);
  const [now, setNow] = useState(() => localMinutes(new Date().toISOString()));
  useEffect(() => {
    const t = setInterval(() => setNow(localMinutes(new Date().toISOString())), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data.staff.length) return <EmptyState title="No hay colaboradoras activas" />;
  const height = (end - start) * PX_PER_MIN;
  const hours = Array.from({ length: (end - start) / 60 }, (_, i) => start + i * 60);
  const day = data.availability[date] ?? {};

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="grid min-w-max" style={{ gridTemplateColumns: `3.5rem repeat(${data.staff.length}, minmax(10rem, 1fr))` }}>
        <div className="sticky left-0 z-10 border-b border-border bg-surface" />
        {data.staff.map((s) => (
          <div key={s.id} className="flex items-center gap-2 border-b border-l border-border px-3 py-2 text-sm font-medium">
            <span className="size-3 rounded-full" style={{ backgroundColor: s.color }} />
            {s.displayName}
          </div>
        ))}

        <div className="relative sticky left-0 z-10 bg-surface" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted tabular-nums" style={{ top: (h - start) * PX_PER_MIN }}>
              {h > start && toHHMM(h)}
            </span>
          ))}
        </div>

        {data.staff.map((s) => {
          const availability = day[s.id] ?? { workable: [], absences: [] };
          const items = data.appointments.flatMap((a) =>
            a.items.filter((i) => i.staff.id === s.id && localDateOf(i.startAt) === date).map((i) => ({ appointment: a, item: i })),
          );
          return (
            <div
              key={s.id}
              className="relative border-l border-border bg-[repeating-linear-gradient(45deg,#f1f3f0,#f1f3f0_6px,#e9ece8_6px,#e9ece8_12px)]"
              style={{ height }}
              onDragOver={(e) => draggable && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const minute = start + Math.round((e.clientY - rect.top) / PX_PER_MIN / SLOT_MIN) * SLOT_MIN;
                onDrop(s.id, toHHMM(minute));
              }}
            >
              {availability.workable.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className="absolute inset-x-0 cursor-cell bg-surface hover:bg-primary/5"
                  style={{ top: (toMinutes(w.start) - start) * PX_PER_MIN, height: (toMinutes(w.end) - toMinutes(w.start)) * PX_PER_MIN }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const offset = Math.max(0, Math.floor((e.clientY - rect.top) / PX_PER_MIN / SLOT_MIN) * SLOT_MIN);
                    const minute = Math.min(toMinutes(w.start) + offset, toMinutes(w.end) - SLOT_MIN);
                    onSlot(s.id, toHHMM(minute));
                  }}
                  aria-label={`Crear cita con ${s.displayName} desde ${w.start}`}
                />
              ))}
              {hours.map((h) => (
                <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: (h - start) * PX_PER_MIN }} />
              ))}
              {availability.absences.map((a, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-x-1 grid place-items-center rounded bg-muted/15 text-[11px] text-muted"
                  style={{ top: (toMinutes(a.start) - start) * PX_PER_MIN, height: (toMinutes(a.end) - toMinutes(a.start)) * PX_PER_MIN }}
                >
                  Ausente
                </div>
              ))}
              {items.map(({ appointment, item }) => (
                <AppointmentCard
                  key={item.id}
                  appointment={appointment}
                  item={item}
                  top={(localMinutes(item.startAt) - start) * PX_PER_MIN}
                  height={Math.max(22, (localMinutes(item.endAt) - localMinutes(item.startAt)) * PX_PER_MIN - 2)}
                  onOpen={onOpen}
                  draggable={draggable && (appointment.status === 'CONFIRMADA' || appointment.status === 'PENDIENTE')}
                  onDragStart={() => onDragStart({ appointment, item })}
                />
              ))}
              {isToday && now >= start && now <= end && (
                <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger" style={{ top: (now - start) * PX_PER_MIN }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AppointmentCard({
  appointment: a,
  item,
  top,
  height,
  onOpen,
  draggable,
  onDragStart,
}: {
  appointment: Appointment;
  item: AppointmentItem;
  top: number;
  height: number;
  onOpen: (a: Appointment) => void;
  draggable: boolean;
  onDragStart: () => void;
}) {
  const st = STATUS[a.status];
  const faded = a.status === 'CANCELADA' || a.status === 'NO_SHOW';
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onClick={() => onOpen(a)}
      className={`absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md ${faded ? 'opacity-50' : ''} ${a.isOverbooking ? 'ring-2 ring-warning' : ''}`}
      style={{ top, height, backgroundColor: `${item.staff.color}40`, borderLeftColor: item.staff.color }}
      title={`${timeOf(item.startAt)}–${timeOf(item.endAt)} · ${a.client.name} · ${item.serviceName} · ${st.label}`}
    >
      <span className={`flex items-center gap-1 font-medium ${a.status === 'CANCELADA' ? 'line-through' : ''}`}>
        <span aria-hidden>{st.icon}</span>
        <span className="truncate">{a.client.name}</span>
        {(a.client.allergies || a.client.contraindications) && <AlertTriangle className="size-3 shrink-0 text-danger" aria-label="Alergias" />}
        {a.source === 'ONLINE' && <Globe className="size-3 shrink-0 text-info" aria-label="Reserva online" />}
      </span>
      {height > 34 && (
        <span className="block truncate text-muted">
          {timeOf(item.startAt)} · {item.serviceName}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Vista Semana
// ---------------------------------------------------------------------------

function WeekView({ data, today, onOpen, onSlot }: { data: CalendarData; today: string; onOpen: (a: Appointment) => void; onSlot: (date: string, time: string) => void }) {
  const { start, end } = useDayBounds(data);
  const height = (end - start) * PX_PER_MIN * 0.8;
  const scale = PX_PER_MIN * 0.8;
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.from, i));
  const hours = Array.from({ length: (end - start) / 60 }, (_, i) => start + i * 60);
  const dayFmt = new Intl.DateTimeFormat('es-BO', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="grid min-w-[56rem]" style={{ gridTemplateColumns: '3.5rem repeat(7, 1fr)' }}>
        <div className="border-b border-border" />
        {days.map((d) => (
          <div key={d} className={`border-b border-l border-border px-2 py-2 text-center text-sm capitalize ${d === today ? 'font-semibold text-primary' : ''}`}>
            {dayFmt.format(new Date(`${d}T12:00:00Z`))}
          </div>
        ))}
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted" style={{ top: (h - start) * scale }}>
              {h > start && toHHMM(h)}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const anyWorkable = Object.values(data.availability[d] ?? {}).some((s) => s.workable.length);
          const items = data.appointments.flatMap((a) => a.items.filter((i) => localDateOf(i.startAt) === d).map((i) => ({ a, i })));
          return (
            <div
              key={d}
              className={`relative border-l border-border ${anyWorkable ? 'cursor-cell' : 'bg-bg'}`}
              style={{ height }}
              onClick={(e) => {
                if (e.target !== e.currentTarget || !anyWorkable || d < today) return;
                const rect = e.currentTarget.getBoundingClientRect();
                onSlot(d, toHHMM(start + Math.floor((e.clientY - rect.top) / scale / SLOT_MIN) * SLOT_MIN));
              }}
            >
              {hours.map((h) => (
                <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: (h - start) * scale }} />
              ))}
              {items.map(({ a, i }) => (
                <button
                  key={i.id}
                  onClick={() => onOpen(a)}
                  className={`absolute inset-x-0.5 overflow-hidden rounded border-l-4 px-1 text-left text-[11px] ${a.status === 'CANCELADA' || a.status === 'NO_SHOW' ? 'opacity-50' : ''}`}
                  style={{
                    top: (localMinutes(i.startAt) - start) * scale,
                    height: Math.max(16, (localMinutes(i.endAt) - localMinutes(i.startAt)) * scale - 1),
                    backgroundColor: `${i.staff.color}40`,
                    borderLeftColor: i.staff.color,
                  }}
                  title={`${timeOf(i.startAt)} ${a.client.name} · ${i.serviceName} · ${i.staff.displayName}`}
                >
                  {timeOf(i.startAt)} {a.client.name}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista Lista (móvil por defecto)
// ---------------------------------------------------------------------------

function ListView({ data, onOpen }: { data: CalendarData; onOpen: (a: Appointment) => void }) {
  if (!data.appointments.length) return <EmptyState title="Sin citas" description="No hay citas en este período." />;
  const byDay = new Map<string, Appointment[]>();
  for (const a of data.appointments) byDay.set(localDateOf(a.startAt), [...(byDay.get(localDateOf(a.startAt)) ?? []), a]);
  return (
    <div className="space-y-5">
      {[...byDay.entries()].map(([d, list]) => (
        <section key={d}>
          <h2 className="mb-2 text-sm font-semibold text-muted first-letter:uppercase">{formatLongDay(d)}</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {list.map((a) => (
              <li key={a.id}>
                <button onClick={() => onOpen(a)} className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-bg/60 ${a.status === 'CANCELADA' ? 'opacity-60' : ''}`}>
                  <span className="tabular w-12 font-medium">{timeOf(a.startAt)}</span>
                  <span className="h-8 w-1 rounded-full" style={{ backgroundColor: a.items[0]?.staff.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      {a.client.name}
                      {(a.client.allergies || a.client.contraindications) && <AlertTriangle className="size-3.5 text-danger" />}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {a.items.map((i) => `${i.serviceName} · ${i.staff.displayName}`).join(' + ')}
                    </span>
                  </span>
                  <span className="text-xs whitespace-nowrap">
                    {STATUS[a.status].icon} {STATUS[a.status].label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista Mes: cantidad de citas y ocupación por día (docs/09-ux-ui.md §15.4)
// ---------------------------------------------------------------------------

function MonthView({ data, month, today, onDay }: { data: CalendarData; month: string; today: string; onDay: (date: string) => void }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(data.from, i));
  const active = (a: Appointment) => a.status !== 'CANCELADA' && a.status !== 'NO_SHOW';
  const stats = new Map<string, { count: number; reserved: number; available: number }>();
  for (const d of days) {
    const available = Object.values(data.availability[d] ?? {}).reduce((s, x) => s + x.workable.reduce((a, w) => a + toMinutes(w.end) - toMinutes(w.start), 0), 0);
    stats.set(d, { count: 0, reserved: 0, available });
  }
  for (const a of data.appointments.filter(active)) {
    for (const i of a.items) {
      const s = stats.get(localDateOf(i.startAt));
      if (s) s.reserved += i.durationMin;
    }
    const s = stats.get(localDateOf(a.startAt));
    if (s) s.count += 1;
  }
  const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-bg/60 text-center text-xs text-muted">
        {weekdays.map((w) => (
          <span key={w} className="py-2">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const s = stats.get(d)!;
          const occupancy = s.available ? Math.min(100, Math.round((s.reserved / s.available) * 100)) : 0;
          const outside = !d.startsWith(month);
          const tone = occupancy >= 80 ? 'bg-danger' : occupancy >= 50 ? 'bg-warning' : 'bg-success';
          return (
            <button
              key={d}
              onClick={() => onDay(d)}
              className={`min-h-24 border-r border-b border-border p-2 text-left transition hover:bg-primary/5 ${outside ? 'bg-bg/50 text-muted' : ''}`}
              aria-label={`${d}: ${s.count} citas, ocupación ${occupancy} %`}
            >
              <span className={`inline-grid size-6 place-items-center rounded-full text-xs ${d === today ? 'bg-primary font-semibold text-white' : ''}`}>{Number(d.slice(8))}</span>
              {s.available > 0 ? (
                <>
                  <span className="mt-1 block text-sm font-medium">{s.count ? `${s.count} ${s.count === 1 ? 'cita' : 'citas'}` : '—'}</span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-border">
                    <span className={`block h-full ${tone}`} style={{ width: `${occupancy}%` }} />
                  </span>
                  <span className="text-[11px] text-muted">{occupancy} % ocupado</span>
                </>
              ) : (
                <span className="mt-1 block text-xs text-muted">{s.count ? `${s.count} citas` : 'Cerrado'}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {Object.values(STATUS).map((s) => (
        <span key={s.label}>
          {s.icon} {s.label}
        </span>
      ))}
      <span>
        <AlertTriangle className="inline size-3 text-danger" /> Alergias
      </span>
      <span>
        <Globe className="inline size-3 text-info" /> Online
      </span>
      <span>▨ No disponible</span>
    </p>
  );
}

export default function AgendaPage() {
  return (
    <Suspense fallback={null}>
      <AgendaContent />
    </Suspense>
  );
}
