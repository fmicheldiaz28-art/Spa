'use client';

import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
} from '@/lib/schedule';
import type { StaffMember } from '@/lib/types';

interface WorkSchedule {
  current: { validFrom: string | null; blocks: Block[] };
  upcoming: { validFrom: string; blocks: Block[] } | null;
}

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canManage = can('schedules.manage');

  const [member, setMember] = useState<StaffMember | null>(null);
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [draft, setDraft] = useState<Block[]>([]);
  const [validFrom, setValidFrom] = useState(todayLocal());
  const [exceptions, setExceptions] = useState<ScheduleException[]>([]);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [affected, setAffected] = useState<AffectedAppointment[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [all, ws, ex] = await Promise.all([
      api<StaffMember[]>('/staff'),
      api<WorkSchedule>(`/staff/${id}/work-schedule`),
      api<ScheduleException[]>(`/schedule-exceptions?staffId=${id}&from=${todayLocal()}`),
    ]);
    setMember(all.find((s) => s.id === id) ?? null);
    setSchedule(ws);
    setDraft((ws.upcoming ?? ws.current).blocks);
    setExceptions(ex.filter((e) => e.staff?.id === id));
  }, [id]);

  useEffect(() => {
    load().catch((err: unknown) => setMessage({ tone: 'danger', text: err instanceof ApiError ? err.problem.title : 'No se pudo cargar' }));
  }, [load]);

  async function saveSchedule() {
    setSaving(true);
    setMessage(null);
    try {
      const r = await api<WorkSchedule & { appointmentsOutside: number }>(`/staff/${id}/work-schedule`, {
        method: 'PUT',
        body: JSON.stringify({ validFrom, blocks: draft }),
      });
      setSchedule(r);
      setMessage(
        r.appointmentsOutside > 0
          ? { tone: 'warning', text: `Horario guardado. ${r.appointmentsOutside} citas futuras quedan fuera del horario nuevo: revísalas en la agenda.` }
          : { tone: 'success', text: `Horario guardado; rige desde el ${formatDay(validFrom)}.` },
      );
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setMessage({ tone: 'danger', text: [p?.title, p?.detail, ...(p?.errors?.map((e) => e.message) ?? [])].filter(Boolean).join(' ') || 'No se pudo guardar' });
    } finally {
      setSaving(false);
    }
  }

  async function removeException(e: ScheduleException) {
    await api(`/schedule-exceptions/${e.id}`, { method: 'DELETE' });
    await load();
  }

  if (!member) return message ? <Alert>{message.text}</Alert> : <p className="text-sm text-muted">Cargando…</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/colaboradoras" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Colaboradoras
      </Link>
      <div className="mt-3 flex items-center gap-3">
        <span className="size-4 rounded-full" style={{ backgroundColor: member.color }} />
        <h1 className="text-2xl font-semibold tracking-tight">{member.displayName}</h1>
        {!member.isActive && <Badge>Inactiva</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">{member.services.map((s) => s.name).join(' · ') || 'Sin servicios asignados (se asignan en Servicios).'}</p>

      {message && (
        <div className="mt-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Horario semanal</h2>
            <p className="text-sm text-muted">
              {schedule?.upcoming
                ? `Hay un horario nuevo que rige desde el ${formatDay(schedule.upcoming.validFrom)}.`
                : schedule?.current.validFrom
                  ? `Vigente desde el ${formatDay(schedule.current.validFrom)}.`
                  : 'Sin horario cargado.'}
            </p>
          </div>
          {canManage && (
            <div className="flex items-end gap-2">
              <Field label="Rige desde" htmlFor="validFrom">
                <Input id="validFrom" type="date" value={validFrom} min={todayLocal()} onChange={(e) => setValidFrom(e.target.value)} className="h-9" />
              </Field>
              <Button size="sm" onClick={() => void saveSchedule()} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar horario'}
              </Button>
            </div>
          )}
        </div>
        <div className="mt-3">
          <WeeklyEditor value={draft} onChange={setDraft} disabled={!canManage} />
        </div>
        <p className="mt-2 text-xs text-muted">Los cambios no mueven citas ya agendadas; te avisamos si alguna queda fuera del horario.</p>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ausencias próximas</h2>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> Nueva ausencia
            </Button>
          )}
        </div>
        <div className="mt-3 space-y-3">
          <AffectedList items={affected} />
          {exceptions.length === 0 ? (
            <EmptyState title="Sin ausencias programadas" />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {exceptions.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="flex-1">
                    <p className="font-medium">
                      {EXCEPTION_LABELS[e.type]} <span className="font-normal text-muted">· {describeException(e)}</span>
                    </p>
                    {e.reason && <p className="text-xs text-muted">{e.reason}</p>}
                  </div>
                  <Badge tone={EXCEPTION_STATUS[e.status].tone}>{EXCEPTION_STATUS[e.status].label}</Badge>
                  {canManage && <ActionMenu label="Acciones" items={[{ label: 'Eliminar', tone: 'danger', onSelect: () => void removeException(e) }]} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ExceptionFormSheet
        open={formOpen}
        mode={{ kind: 'admin', staff: [member], fixedStaffId: member.id }}
        onClose={() => setFormOpen(false)}
        onSaved={({ affected: a }) => {
          setFormOpen(false);
          setAffected(a);
          void load();
        }}
      />
    </div>
  );
}
