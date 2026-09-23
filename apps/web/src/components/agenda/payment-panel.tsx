'use client';

import { PAYMENT_METHODS, type PaymentMethod } from '@naturalspa/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatShortDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/types';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo',
  QR: 'QR',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};

export interface PaymentRow {
  id: string;
  appointmentId: string | null;
  appointmentCode: string | null;
  client: string | null;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  status: 'REGISTRADO' | 'ANULADO';
  receivedBy: string;
  paidAt: string;
  voidReason: string | null;
}

interface Balance {
  total: string;
  paid: string;
  balance: string;
  payments: PaymentRow[];
}

/** Cobro de una cita en 2 clics (docs/06-modulos.md M10). */
export function PaymentPanel({ appointmentId, cancelled, onChanged }: { appointmentId: string; cancelled: boolean; onChanged: () => void }) {
  const { can } = useAuth();
  const [data, setData] = useState<Balance | null>(null);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('EFECTIVO');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef('');

  const load = useCallback(async () => {
    const b = await api<Balance>(`/appointments/${appointmentId}/payments`);
    setData(b);
    setAmount(b.balance);
  }, [appointmentId]);

  useEffect(() => {
    void load().catch(() => setData(null));
  }, [load]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await api('/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: JSON.stringify({ appointmentId, method, amount: Number(amount), reference: reference || null }),
      });
      setOpen(false);
      setReference('');
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo registrar el cobro');
      key.current = crypto.randomUUID();
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(p: PaymentRow) {
    const reason = window.prompt(`Motivo para anular el cobro de ${formatMoney(p.amount)}`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/payments/${p.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo anular');
    }
  }

  if (!data) return null;
  const balance = Number(data.balance);

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Cobro</p>
        {balance <= 0 ? <Badge tone="success">💰 Pagada</Badge> : Number(data.paid) > 0 ? <Badge tone="warning">Pago parcial</Badge> : <Badge>Pendiente de pago</Badge>}
      </div>
      <p className="text-muted">
        Total {formatMoney(data.total)} · Pagado {formatMoney(data.paid)} · <strong className="text-text">Saldo {formatMoney(data.balance)}</strong>
      </p>
      {data.payments.length > 0 && (
        <ul className="space-y-1">
          {data.payments.map((p) => (
            <li key={p.id} className={`flex items-center gap-2 text-xs ${p.status === 'ANULADO' ? 'text-muted line-through' : ''}`}>
              <span className="flex-1">
                {formatShortDateTime(p.paidAt)} · {METHOD_LABELS[p.method]} {formatMoney(p.amount)}
                {p.reference && ` · ${p.reference}`} · {p.receivedBy}
              </span>
              {p.status === 'REGISTRADO' && can('payments.void') && (
                <button className="text-danger hover:underline" onClick={() => void voidPayment(p)}>
                  Anular
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      {balance > 0 && !cancelled && can('payments.create') && !open && (
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            key.current = crypto.randomUUID();
            setAmount(data.balance);
            setOpen(true);
          }}
        >
          💰 Cobrar {formatMoney(data.balance)}
        </Button>
      )}
      {open && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {PAYMENT_METHODS.filter((m) => m !== 'OTRO').map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`rounded-md border px-2 py-1.5 text-xs ${method === m ? 'border-primary bg-primary text-white' : 'border-border'}`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min={0.01} step="0.5" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Monto" />
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'QR' || method === 'TRANSFERENCIA' ? 'Nº de transacción' : 'Referencia (opcional)'} aria-label="Referencia" />
          </div>
          {Number(amount) < balance && Number(amount) > 0 && <p className="text-xs text-muted">Quedará un saldo de {formatMoney(balance - Number(amount))} (pago dividido).</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button size="sm" disabled={busy || !(Number(amount) > 0)} onClick={() => void pay()}>
              Confirmar cobro
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
