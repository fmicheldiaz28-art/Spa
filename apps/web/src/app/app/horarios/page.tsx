'use client';

import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { AffectedList, ExceptionFormSheet } from '@/components/exception-form';
import { ActionMenu, Alert, Badge, Button, EmptyState, Field, Input } from '@/components/ui';
import { WeeklyEditor } from '@/components/weekly-editor';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type AffectedAppointment,
  type Block,
  describeException,
  EXCEPTION_LABELS,
  EXCEPTION_STATUS,
  formatDay,
  type ScheduleException,
  todayLocal,
  WEEKDAY_NAME,
} from '@/lib/schedule';
import type { StaffMember } from '@/lib/types';

interface Holiday {
  id: string;
  date: string;
  name: string;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

const errorText = (err: unknown) => {
  const p = err instanceof ApiError ? err.problem : null;
  return [p?.title, p?.detail, ...(p?.errors?.map((e) => e.message) ?? [])].filter(Boolean).join(' ') || 'La operación falló';
};

export default function SchedulesPage() {
  const { can } = useAuth();
  return can('schedules.read_all') ? <TeamSchedules /> : <MySchedule />;
}

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

function TeamSchedules() {
  const { can } = useAuth();
  type Tab = 'requests' | 'absences' | 'holidays' | 'business';
  const [tab, setTab] = useState<Tab>('requests');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [affected, setAffected] = useState<AffectedAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    const [s, e] = await Promise.all([api<StaffMember[]>('/staff'), api<ScheduleException[]>(`/schedule-exceptions?from=${todayLocal()}`)]);
    setStaff(s.filter((x) => x.isActive));
    setExceptions(e);
  }, []);

  useEffect(() => {
    load().catch((err: unknown) => setError(errorText(err)));
  }, [load]);

  const pending = exceptions.filter((e) => e.status === 'SOLICITADA');
  const approved = exceptions.filter((e) => e.status === 'APROBADA');

  async function decide(e: ScheduleException, approve: boolean) {
    try {
      const reason = approve ? undefined : (window.prompt('Motivo del rechazo (opcional)') ?? undefined);
      const r = await api<{ affectedAppointments: AffectedAppointment[] }>(`/schedule-exceptions/${e.id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      });
      setAffected(r.affectedAppointments);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'requests', label: `Solicitudes${pending.length ? ` (${pending.length})` : ''}` },
    { key: 'absences', label: 'Ausencias del equipo' },
    { key: 'holidays', label: 'Feriados' },
    ...(can('settings.manage') ? [{ key: 'business' as const, label: 'Horario del negocio' }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Horarios</h1>
          <p className="mt-1 text-sm text-muted">Ausencias, feriados y horario del negocio. El horario de cada una se edita en Colaboradoras.</p>
        </div>
        {can('schedules.manage') && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="size-4" /> Nueva ausencia o bloqueo
          </Button>
        )}
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-primary font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        <AffectedList items={affected} />

        {tab === 'requests' &&
          (pending.length === 0 ? (
            <EmptyState title="No hay solicitudes pendientes" />
          ) : (
            <ExceptionList
              items={pending}
              renderActions={(e) =>
                can('schedules.approve') && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void decide(e, false)}>
                      Rechazar
                    </Button>
                    <Button size="sm" onClick={() => void decide(e, true)}>
                      Aprobar
                    </Button>
                  </div>
                )
              }
            />
          ))}

        {tab === 'absences' &&
          (approved.length === 0 ? (
            <EmptyState title="Sin ausencias próximas" />
          ) : (
            <ExceptionList
              items={approved}
              renderActions={(e) =>
                can('schedules.manage') && (
                  <ActionMenu
                    label="Acciones"
                    items={[
                      {
                        label: 'Eliminar',
                        tone: 'danger',
                        onSelect: () => void api(`/schedule-exceptions/${e.id}`, { method: 'DELETE' }).then(load).catch((err: unknown) => setError(errorText(err))),
                      },
                    ]}
                  />
                )
              }
            />
          ))}

        {tab === 'holidays' && <Holidays onError={setError} />}
        {tab === 'business' && <BusinessHours onError={setError} />}
      </div>

      <ExceptionFormSheet
        open={formOpen}
        mode={{ kind: 'admin', staff }}
        onClose={() => setFormOpen(false)}
        onSaved={({ affected: a }) => {
          setFormOpen(false);
          setAffected(a);
          setTab('absences');
          void load();
        }}
      />
    </div>
  );
}

function ExceptionList({ items, renderActions }: { items: ScheduleException[]; renderActions: (e: ScheduleException) => React.ReactNode }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map((e) => (
        <li key={e.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="flex flex-1 items-start gap-3">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.staff?.color ?? '#6B7770' }} />
            <span>
              <span className="font-medium">{e.staff?.displayName ?? 'Toda la sede'}</span> · {EXCEPTION_LABELS[e.type]}
              <span className="block text-muted">
                {describeException(e)}
                {e.reason && ` · ${e.reason}`}
              </span>
            </span>
          </span>
          <Badge tone={EXCEPTION_STATUS[e.status].tone}>{EXCEPTION_STATUS[e.status].label}</Badge>
          {renderActions(e)}
        </li>
      ))}
    </ul>
  );
}

function Holidays({ onError }: { onError: (m: string) => void }) {
  const { can } = useAuth();
  const year = Number(todayLocal().slice(0, 4));
  const [items, setItems] = useState<Holiday[]>([]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(() => api<Holiday[]>(`/holidays?year=${year}`).then(setItems), [year]);
  useEffect(() => {
    load().catch((err: unknown) => onError(errorText(err)));
  }, [load, onError]);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/holidays', { method: 'POST', body: JSON.stringify({ date, name, isClosed: true }) });
      setDate('');
      setName('');
      await load();
    } catch (err) {
      onError(errorText(err));
    }
  }

  return (
    <div className="space-y-4">
      {can('schedules.manage') && (
        <form onSubmit={add} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-end">
          <Field label="Fecha" htmlFor="hdate">
            <Input id="hdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <div className="flex-1">
            <Field label="Nombre" htmlFor="hname">
              <Input id="hname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Aniversario de Santa Cruz" required />
            </Field>
          </div>
          <Button type="submit" disabled={!date || !name}>
            Agregar feriado
          </Button>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState title={`Sin feriados cargados para ${year}`} description="Los días feriados cerrados no aceptan reservas." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="w-32 font-medium capitalize">{formatDay(h.date)}</span>
              <span className="flex-1">{h.name}</span>
              <Badge tone={h.isClosed ? 'danger' : 'warning'}>{h.isClosed ? 'Cerrado' : `${h.openTime}–${h.closeTime}`}</Badge>
              {can('schedules.manage') && (
                <button
                  onClick={() => void api(`/holidays/${h.id}`, { method: 'DELETE' }).then(load).catch((err: unknown) => onError(errorText(err)))}
                  className="p-1 text-muted hover:text-danger"
                  aria-label={`Eliminar feriado ${h.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BusinessHours({ onError }: { onError: (m: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ blocks: Block[] }>('/business-hours')
      .then((r) => setBlocks(r.blocks))
      .catch((err: unknown) => onError(errorText(err)));
  }, [onError]);

  async function save() {
    try {
      const r = await api<{ blocks: Block[] }>('/business-hours', { method: 'PUT', body: JSON.stringify({ blocks }) });
      setBlocks(r.blocks);
      setSaved(true);
    } catch (err) {
      onError(errorText(err));
    }
  }

  return (
    <div className="space-y-3">
      {saved && <Alert tone="success">Horario del negocio actualizado.</Alert>}
      <WeeklyEditor value={blocks} onChange={(b) => { setBlocks(b); setSaved(false); }} />
      <div className="flex justify-end">
        <Button onClick={() => void save()}>Guardar horario del negocio</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empleada: "Mi horario"
// ---------------------------------------------------------------------------

function MySchedule() {
  const { user, can } = useAuth();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user?.staffId) return;
    const [ws, ex] = await Promise.all([
      api<{ current: { blocks: Block[] } }>(`/staff/${user.staffId}/work-schedule`),
      api<ScheduleException[]>(`/schedule-exceptions?from=${todayLocal()}`),
    ]);
    setBlocks(ws.current.blocks);
    setExceptions(ex.filter((e) => e.status !== 'CANCELADA'));
  }, [user?.staffId]);

  useEffect(() => {
    load().catch((err: unknown) => setError(errorText(err)));
  }, [load]);

  const byDay = [2, 3, 4, 5, 6, 7, 1].map((d) => ({ d, items: blocks.filter((b) => b.weekday === d) }));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mi horario</h1>
        {can('schedules.request') && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="size-4" /> Solicitar ausencia
          </Button>
        )}
      </div>
      <div className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
      </div>

      <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
        {byDay.map(({ d, items }) => (
          <li key={d} className="flex justify-between px-4 py-3 text-sm">
            <span className="font-medium">{WEEKDAY_NAME[d]}</span>
            <span className={items.length ? '' : 'text-muted'}>{items.length ? items.map((b) => `${b.start}–${b.end}`).join(' · ') : 'Libre'}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Mis ausencias y solicitudes</h2>
      <div className="mt-3">
        {exceptions.length === 0 ? (
          <EmptyState title="Nada programado" />
        ) : (
          <ExceptionList
            items={exceptions}
            renderActions={(e) =>
              e.status === 'SOLICITADA' &&
              e.staff?.id === user?.staffId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api(`/schedule-exceptions/${e.id}`, { method: 'DELETE' })
                      .then(load)
                      .catch((err: unknown) => setError(errorText(err)))
                  }
                >
                  Retirar
                </Button>
              )
            }
          />
        )}
      </div>

      <ExceptionFormSheet
        open={formOpen}
        mode={{ kind: 'request' }}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          setNotice('Solicitud enviada. Te avisaremos cuando Administración la revise.');
          void load();
        }}
      />
    </div>
  );
}
