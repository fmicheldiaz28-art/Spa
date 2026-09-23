'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { type AffectedAppointment, EXCEPTION_LABELS, formatTime, type ScheduleException, todayLocal } from '@/lib/schedule';

type Mode = { kind: 'admin'; staff: { id: string; displayName: string }[]; fixedStaffId?: string } | { kind: 'request' };

/** Alta de ausencias (administración) o solicitud de vacaciones/permiso (empleada). */
export function ExceptionFormSheet({
  open,
  mode,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  onClose: () => void;
  onSaved: (result: { exception: ScheduleException; affected: AffectedAppointment[] }) => void;
}) {
  const types = mode.kind === 'admin' ? (['VACACIONES', 'PERMISO', 'BLOQUEO', 'EXTRA'] as const) : (['VACACIONES', 'PERMISO'] as const);
  const [staffId, setStaffId] = useState<string>('');
  const [type, setType] = useState<ScheduleException['type']>('VACACIONES');
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState(todayLocal());
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStaffId(mode.kind === 'admin' ? (mode.fixedStaffId ?? '') : '');
    setType('VACACIONES');
    setStartDate(todayLocal());
    setEndDate(todayLocal());
    setAllDay(true);
    setReason('');
    setErrors([]);
  }, [open]); // se reinicia solo al abrir, no en cada render del padre

  useEffect(() => {
    if (endDate < startDate) setEndDate(startDate);
  }, [startDate, endDate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);
    const body = {
      type,
      startDate,
      endDate: allDay ? endDate : startDate,
      allDay,
      ...(!allDay && { startTime, endTime }),
      reason: reason || null,
    };
    try {
      if (mode.kind === 'admin') {
        const r = await api<{ exception: ScheduleException; affectedAppointments: AffectedAppointment[] }>('/schedule-exceptions', {
          method: 'POST',
          body: JSON.stringify({ ...body, staffId: staffId || null }),
        });
        onSaved({ exception: r.exception, affected: r.affectedAppointments });
      } else {
        const r = await api<ScheduleException>('/schedule-exceptions/requests', { method: 'POST', body: JSON.stringify(body) });
        onSaved({ exception: r, affected: [] });
      }
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setErrors(p?.errors?.map((x) => x.message) ?? [p?.title ?? 'No se pudo guardar']);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode.kind === 'admin' ? 'Nueva ausencia o bloqueo' : 'Solicitar ausencia'}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="exception-form" disabled={saving || (mode.kind === 'admin' && !staffId && type !== 'BLOQUEO')}>
            {saving ? 'Guardando…' : mode.kind === 'admin' ? 'Guardar' : 'Enviar solicitud'}
          </Button>
        </>
      }
    >
      <form id="exception-form" onSubmit={onSubmit} className="space-y-5">
        {errors.length > 0 && <Alert>{errors.join('. ')}</Alert>}
        {mode.kind === 'admin' && !mode.fixedStaffId && (
          <Field label="Colaboradora" htmlFor="staff">
            <Select id="staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">{type === 'BLOQUEO' ? 'Toda la sede' : 'Elige una colaboradora'}</option>
              {mode.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
          <div className="grid grid-cols-2 gap-2">
            {types.map((t) => (
              <label key={t} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${type === t ? 'border-primary bg-primary/5 font-medium' : 'border-border'}`}>
                <input type="radio" name="type" className="sr-only" checked={type === t} onChange={() => setType(t)} />
                {EXCEPTION_LABELS[t]}
              </label>
            ))}
          </div>
          {type === 'EXTRA' && <p className="mt-2 text-xs text-muted">Horas adicionales en que la colaboradora sí puede atender (aunque el local esté cerrado).</p>}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Día(s) completo(s)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label={allDay ? 'Desde' : 'Fecha'} htmlFor="startDate">
            <Input id="startDate" type="date" value={startDate} min={todayLocal()} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          {allDay ? (
            <Field label="Hasta (inclusive)" htmlFor="endDate">
              <Input id="endDate" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="De" htmlFor="startTime">
                <Input id="startTime" type="time" step={900} value={startTime} onChange={(e) => setStartTime(e.target.value)} className="px-2" />
              </Field>
              <Field label="A" htmlFor="endTime">
                <Input id="endTime" type="time" step={900} value={endTime} onChange={(e) => setEndTime(e.target.value)} className="px-2" />
              </Field>
            </div>
          )}
        </div>
        <Field label="Motivo" htmlFor="reason">
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" />
        </Field>
        {mode.kind === 'request' && <p className="text-xs text-muted">Administración revisará tu solicitud. Mientras tanto tu agenda no cambia.</p>}
      </form>
    </Sheet>
  );
}

export function AffectedList({ items }: { items: AffectedAppointment[] }) {
  if (!items.length) return null;
  return (
    <Alert tone="warning">
      <p className="font-medium">
        {items.length} {items.length === 1 ? 'cita queda afectada' : 'citas quedan afectadas'}; reagéndalas o reasígnalas desde la agenda:
      </p>
      <ul className="mt-1 list-inside list-disc">
        {items.map((a) => (
          <li key={a.appointmentId}>
            {a.code} · {new Date(a.startAt).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' })} {formatTime(a.startAt)} · {a.client} · {a.service} ({a.staff})
          </li>
        ))}
      </ul>
    </Alert>
  );
}
