'use client';

import { Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Dialog, EmptyState, Field, Input } from '@/components/ui';
import { ApiError, api, apiDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { todayLocal } from '@/lib/schedule';
import { formatMoney } from '@/lib/types';

type ReportType = 'sales' | 'services' | 'clients' | 'staff' | 'cancellations';
type ValueType = 'money' | 'number' | 'pct' | 'text' | 'date';

interface Report {
  type: ReportType;
  period: { from: string; to: string };
  summary: { label: string; value: string | number; type?: ValueType }[];
  tables: { title: string; columns: { key: string; label: string; type?: ValueType }[]; rows: Record<string, string | number | null>[] }[];
}

const TABS: { key: ReportType; label: string }[] = [
  { key: 'sales', label: 'Ventas' },
  { key: 'services', label: 'Servicios' },
  { key: 'clients', label: 'Clientes' },
  { key: 'staff', label: 'Personal' },
  { key: 'cancellations', label: 'Cancelaciones' },
];

function format(value: string | number | null, type?: ValueType) {
  if (value === null || value === undefined) return '—';
  if (type === 'money') return formatMoney(value);
  if (type === 'pct') return `${Number(value).toLocaleString('es-BO')} %`;
  if (type === 'number') return Number(value).toLocaleString('es-BO');
  if (type === 'date') return new Date(`${value}T12:00:00Z`).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return String(value);
}

function presets() {
  const today = todayLocal();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = (date: Date) => date.toISOString().slice(0, 10);
  return [
    { label: 'Este mes', from: `${today.slice(0, 8)}01`, to: today },
    { label: 'Mes anterior', from: d(new Date(Date.UTC(y, m - 2, 1))), to: d(new Date(Date.UTC(y, m - 1, 0))) },
    { label: 'Este año', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

/** Reportes automáticos (docs/06-modulos.md M11). La empleada solo ve su reporte personal. */
export default function ReportsPage() {
  const { can } = useAuth();
  const global = can('reports.view_global');
  const [type, setType] = useState<ReportType>(global ? 'sales' : 'staff');
  const [from, setFrom] = useState(presets()[0]!.from);
  const [to, setTo] = useState(presets()[0]!.to);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setReport(null);
    try {
      setReport(await api<Report>(`/reports/${type}?from=${from}&to=${to}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo generar el reporte');
    }
  }, [type, from, to]);

  useEffect(() => {
    if (from <= to) void load();
  }, [load, from, to]);

  async function doExport() {
    try {
      await apiDownload(`/reports/${type}/export`, { from, to, reason });
      setExporting(false);
      setReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo exportar');
    }
  }

  const tabs = global ? TABS : [{ key: 'staff' as const, label: 'Mi reporte' }];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{global ? 'Reportes' : 'Mi reporte'}</h1>
        {can('reports.export') && (
          <Button variant="secondary" size="sm" onClick={() => setExporting(true)} disabled={!report}>
            <Download className="size-4" /> Exportar a Excel
          </Button>
        )}
      </div>

      {tabs.length > 1 && (
        <div className="mt-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={type === t.key}
              onClick={() => setType(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${type === t.key ? 'border-primary font-medium' : 'border-transparent text-muted hover:text-text'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Desde" htmlFor="rfrom">
          <Input id="rfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </Field>
        <Field label="Hasta" htmlFor="rto">
          <Input id="rto" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </Field>
        {presets().map((p) => (
          <Button key={p.label} size="sm" variant={from === p.from && to === p.to ? 'primary' : 'secondary'} onClick={() => { setFrom(p.from); setTo(p.to); }}>
            {p.label}
          </Button>
        ))}
      </div>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      {!report ? (
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface" />
      ) : (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {report.summary.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-xs text-muted">{s.label}</p>
                <p className="tabular mt-1 text-xl font-semibold">{format(s.value, s.type)}</p>
              </div>
            ))}
          </section>
          <div className="mt-6 space-y-6">
            {report.tables.map((t) => (
              <section key={t.title}>
                <h2 className="mb-2 text-sm font-semibold">{t.title}</h2>
                {t.rows.length === 0 ? (
                  <EmptyState title="Sin datos en el período" />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-surface">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-bg/60 text-left text-xs tracking-wide text-muted uppercase">
                        <tr>
                          {t.columns.map((c) => (
                            <th key={c.key} className={`px-4 py-2.5 font-medium ${c.type && c.type !== 'text' && c.type !== 'date' ? 'text-right' : ''}`}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {t.rows.map((r, i) => (
                          <tr key={i}>
                            {t.columns.map((c) => (
                              <td key={c.key} className={`px-4 py-2.5 ${c.type && c.type !== 'text' && c.type !== 'date' ? 'tabular text-right' : ''}`}>
                                {format(r[c.key] ?? null, c.type)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={exporting}
        onClose={() => setExporting(false)}
        title="Exportar reporte"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setExporting(false)}>
              Cancelar
            </Button>
            <Button size="sm" disabled={reason.trim().length < 3} onClick={() => void doExport()}>
              Descargar Excel
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-muted">Las exportaciones quedan registradas en la auditoría. Indica para qué la necesitas.</p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: cierre contable de septiembre" aria-label="Motivo" />
        </div>
      </Dialog>
    </div>
  );
}
