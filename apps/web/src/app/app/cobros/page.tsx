'use client';

import { PAYMENT_METHODS, type PaymentMethod } from '@naturalspa/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { METHOD_LABELS, type PaymentRow } from '@/components/agenda/payment-panel';
import { Alert, Badge, Button, EmptyState, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatShortDateTime } from '@/lib/format';
import { todayLocal } from '@/lib/schedule';
import { formatMoney } from '@/lib/types';

interface ListResponse {
  data: PaymentRow[];
  summary: { total: string; count: number; byMethod: Record<string, string> };
}

interface Closure {
  date: string;
  expected: Record<string, string>;
  expectedTotal: string;
  closed: { counted: Record<string, number>; difference: string; closedAt: string; notes: string | null } | null;
}

export default function PaymentsPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('payments.read_all');
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResponse>(`/payments?from=${from}&to=${to}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar');
    }
  }, [from, to]);

  useEffect(() => {
    if (allowed && from <= to) void load();
  }, [allowed, load, from, to]);

  async function voidPayment(p: PaymentRow) {
    const reason = window.prompt(`Motivo para anular ${formatMoney(p.amount)} (${p.appointmentCode})`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/payments/${p.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo anular');
    }
  }

  if (!allowed) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Cobros</h1>
      <p className="mt-1 text-sm text-muted">Los cobros no se editan: se anulan con motivo y se vuelven a registrar.</p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Field label="Desde" htmlFor="pfrom">
          <Input id="pfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </Field>
        <Field label="Hasta" htmlFor="pto">
          <Input id="pto" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </Field>
        <Button size="sm" variant="secondary" onClick={() => { setFrom(todayLocal()); setTo(todayLocal()); }}>
          Hoy
        </Button>
      </div>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      {data && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-border bg-surface p-4 md:col-span-1">
            <p className="text-xs text-muted">Total</p>
            <p className="tabular text-xl font-semibold">{formatMoney(data.summary.total)}</p>
            <p className="text-xs text-muted">{data.summary.count} cobros</p>
          </div>
          {PAYMENT_METHODS.filter((m) => m !== 'OTRO').map((m) => (
            <div key={m} className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-muted">{METHOD_LABELS[m]}</p>
              <p className="tabular text-lg font-semibold">{formatMoney(data.summary.byMethod[m] ?? 0)}</p>
            </div>
          ))}
        </div>
      )}

      {from === to && can('payments.close_cash') && <CashClosure date={from} onError={setError} />}

      <div className="mt-6">
        {data && data.data.length === 0 ? (
          <EmptyState title="Sin cobros en el período" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg/60 text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Cita · Clienta</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Método</th>
                  <th className="px-4 py-3 text-right font-medium">Monto</th>
                  <th className="w-20 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.data.map((p) => (
                  <tr key={p.id} className={p.status === 'ANULADO' ? 'text-muted' : ''}>
                    <td className="tabular px-4 py-3 whitespace-nowrap">{formatShortDateTime(p.paidAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.client ?? '—'}</p>
                      <p className="text-xs text-muted">
                        {p.appointmentCode} · cobró {p.receivedBy}
                        {p.status === 'ANULADO' && ` · anulado: ${p.voidReason}`}
                      </p>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {METHOD_LABELS[p.method]}
                      {p.reference && <span className="block text-xs text-muted">{p.reference}</span>}
                    </td>
                    <td className={`tabular px-4 py-3 text-right font-medium ${p.status === 'ANULADO' ? 'line-through' : ''}`}>{formatMoney(p.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      {p.status === 'ANULADO' ? (
                        <Badge>Anulado</Badge>
                      ) : (
                        can('payments.void') && (
                          <button className="text-xs text-danger hover:underline" onClick={() => void voidPayment(p)}>
                            Anular
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CashClosure({ date, onError }: { date: string; onError: (m: string) => void }) {
  const [closure, setClosure] = useState<Closure | null>(null);
  const [counted, setCounted] = useState<Partial<Record<PaymentMethod, string>>>({});
  const [notes, setNotes] = useState('');

  const load = useCallback(() => api<Closure>(`/cash-closures/preview?date=${date}`).then(setClosure), [date]);
  useEffect(() => {
    load().catch(() => setClosure(null));
  }, [load]);

  async function close(e: FormEvent) {
    e.preventDefault();
    try {
      const body = Object.fromEntries(Object.entries(counted).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
      setClosure(await api<Closure>('/cash-closures', { method: 'POST', body: JSON.stringify({ date, counted: body, notes: notes || null }) }));
    } catch (err) {
      onError(err instanceof ApiError ? err.problem.title : 'No se pudo cerrar la caja');
    }
  }

  if (!closure) return null;
  const methods = PAYMENT_METHODS.filter((m) => m !== 'OTRO');
  const countedTotal = methods.reduce((s, m) => s + Number(counted[m] || 0), 0);

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">Cierre de caja del día</h2>
      {closure.closed ? (
        <div className="mt-2 text-sm">
          <Alert tone={Number(closure.closed.difference) === 0 ? 'success' : 'warning'}>
            Caja cerrada. Esperado {formatMoney(closure.expectedTotal)} · diferencia {formatMoney(closure.closed.difference)}
            {closure.closed.notes && ` · ${closure.closed.notes}`}
          </Alert>
        </div>
      ) : (
        <form onSubmit={close} className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {methods.map((m) => (
              <Field key={m} label={`${METHOD_LABELS[m]} (esperado ${formatMoney(closure.expected[m] ?? 0)})`} htmlFor={`c-${m}`}>
                <Input id={`c-${m}`} type="number" min={0} step="0.5" value={counted[m] ?? ''} onChange={(e) => setCounted((c) => ({ ...c, [m]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <Field label="Observaciones" htmlFor="cnotes">
                <Input id="cnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            <p className="text-sm">
              Contado {formatMoney(countedTotal)} · diferencia <strong>{formatMoney(countedTotal - Number(closure.expectedTotal))}</strong>
            </p>
            <Button type="submit" size="sm">
              Cerrar caja
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
