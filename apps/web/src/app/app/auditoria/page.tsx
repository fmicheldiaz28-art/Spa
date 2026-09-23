'use client';

import { ArrowRight, Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeDevice, formatDateTime } from '@/lib/format';
import { actionLabel, FIELD_LABELS, formatAuditValue, MODULE_LABELS, ROLE_LABELS } from '@/lib/labels';

interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: { id: string | null; type: string; name: string | null; role: string | null };
  action: string;
  module: string;
  entity: { type: string; id: string | null; label: string | null } | null;
  changedFields: string[];
  reason: string | null;
}

interface AuditDetail extends AuditEvent {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

interface Facets {
  modules: string[];
  actions: string[];
  actors: { id: string; name: string }[];
}

const FILTER_KEYS = ['actorId', 'module', 'action', 'entityId', 'from', 'to', 'q'] as const;

function actorLabel(e: AuditEvent) {
  if (e.actor.type === 'ANONYMOUS') return 'Anónimo';
  if (e.actor.type === 'SYSTEM') return `Sistema (${e.actor.name ?? '—'})`;
  return e.actor.name ?? '—';
}

function summary(e: AuditEvent): string {
  const fields = e.changedFields.filter((f) => f !== 'version').map((f) => FIELD_LABELS[f] ?? f);
  const parts = [e.entity?.label, fields.length && e.action !== 'CREATE' ? fields.join(', ') : null, e.reason].filter(Boolean);
  return parts.join(' · ');
}

function AuditContent() {
  const { user, can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const allowed = can('audit.read');

  const [facets, setFacets] = useState<Facets | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const queryString = params.toString();

  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/app/auditoria${next.size ? `?${next}` : ''}`);
  };

  const fetchPage = useCallback(
    async (after?: string) => {
      const query = new URLSearchParams(queryString);
      // Las fechas del filtro son días completos en hora local de Bolivia (UTC−4).
      if (query.get('from')) query.set('from', `${query.get('from')}T00:00:00-04:00`);
      if (query.get('to')) query.set('to', `${query.get('to')}T23:59:59-04:00`);
      query.set('limit', '50');
      if (after) query.set('cursor', after);
      return api<{ data: AuditEvent[]; nextCursor: string | null }>(`/audit-logs?${query}`);
    },
    [queryString],
  );

  useEffect(() => {
    if (!allowed) return;
    setEvents(null);
    fetchPage()
      .then((r) => {
        setEvents(r.data);
        setCursor(r.nextCursor);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar la auditoría'));
  }, [allowed, fetchPage]);

  useEffect(() => {
    if (allowed) void api<Facets>('/audit-logs/facets').then(setFacets).catch(() => undefined);
  }, [allowed]);

  // Búsqueda con pausa para no consultar en cada tecla.
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => setFilter('q', q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]); // solo reacciona a lo que escribe la persona

  async function loadMore() {
    if (!cursor) return;
    const r = await fetchPage(cursor);
    setEvents((prev) => [...(prev ?? []), ...r.data]);
    setCursor(r.nextCursor);
  }

  async function openDetail(id: string) {
    try {
      setDetail(await api<AuditDetail>(`/audit-logs/${id}`));
    } catch {
      setError('No se pudo abrir el detalle');
    }
  }

  if (!allowed) return null;
  const hasFilters = FILTER_KEYS.some((k) => filters[k]);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight">Auditoría</h1>
      <p className="mt-1 text-sm text-muted">Quién hizo qué, cuándo y desde dónde. Los registros no se pueden modificar ni borrar.</p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: email, código de cita, motivo" className="pl-9" aria-label="Buscar" />
        </div>
        <Select value={filters.actorId} onChange={(e) => setFilter('actorId', e.target.value)} aria-label="Usuario">
          <option value="">Todos los usuarios</option>
          {facets?.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={filters.module} onChange={(e) => setFilter('module', e.target.value)} aria-label="Módulo">
          <option value="">Todos los módulos</option>
          {facets?.modules.map((m) => (
            <option key={m} value={m}>
              {MODULE_LABELS[m] ?? m}
            </option>
          ))}
        </Select>
        <Select value={filters.action} onChange={(e) => setFilter('action', e.target.value)} aria-label="Acción">
          <option value="">Todas las acciones</option>
          {facets?.actions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a).label}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} aria-label="Desde" className="px-2" />
          <Input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} aria-label="Hasta" className="px-2" />
        </div>
      </div>
      {hasFilters && (
        <button
          className="mt-2 text-xs text-primary underline"
          onClick={() => {
            setQ('');
            router.replace('/app/auditoria');
          }}
        >
          Quitar filtros{filters.entityId ? ' (incluido el filtro por registro)' : ''}
        </button>
      )}

      <div className="mt-4">
        {error && <Alert>{error}</Alert>}
        {events && events.length === 0 ? (
          <EmptyState title="Sin eventos" description="No hay registros con esos filtros." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="hidden border-b border-border bg-bg/60 text-left text-xs tracking-wide text-muted uppercase md:table-header-group">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha y hora</th>
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Acción</th>
                  <th className="px-4 py-3 font-medium">Módulo</th>
                  <th className="px-4 py-3 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!events &&
                  Array.from({ length: 6 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-4">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-bg" />
                      </td>
                    </tr>
                  ))}
                {events?.map((e) => {
                  const a = actionLabel(e.action);
                  return (
                    <tr key={e.id} onClick={() => void openDetail(e.id)} className="cursor-pointer hover:bg-bg/60">
                      <td className="tabular px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(e.occurredAt)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{actorLabel(e)}</p>
                        {e.actor.role && <p className="text-xs text-muted">{ROLE_LABELS[e.actor.role as keyof typeof ROLE_LABELS] ?? e.actor.role}</p>}
                        <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                          <Badge tone={a.tone}>{a.label}</Badge>
                          <span className="text-xs text-muted">{summary(e)}</span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <Badge tone={a.tone}>{a.label}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">{MODULE_LABELS[e.module] ?? e.module}</td>
                      <td className="hidden max-w-sm truncate px-4 py-3 text-muted md:table-cell">{summary(e)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <div className="mt-4 text-center">
            <Button variant="secondary" size="sm" onClick={() => void loadMore()}>
              Cargar más
            </Button>
          </div>
        )}
      </div>

      <Sheet open={!!detail} onClose={() => setDetail(null)} title="Detalle del evento">
        {detail && <AuditDetailView detail={detail} />}
      </Sheet>
    </div>
  );
}

function AuditDetailView({ detail }: { detail: AuditDetail }) {
  const a = actionLabel(detail.action);
  const fields = [...new Set([...Object.keys(detail.oldValues ?? {}), ...Object.keys(detail.newValues ?? {})])];
  const isChange = !!detail.oldValues && !!detail.newValues;

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-1">
        <Badge tone={a.tone}>{a.label}</Badge>
        <p className="tabular pt-1 text-muted">{formatDateTime(detail.occurredAt)} (hora de Bolivia)</p>
      </div>

      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
        <dt className="text-muted">Usuario</dt>
        <dd>
          {actorLabel(detail)}
          {detail.actor.role && <span className="text-muted"> · {ROLE_LABELS[detail.actor.role as keyof typeof ROLE_LABELS] ?? detail.actor.role}</span>}
        </dd>
        <dt className="text-muted">Módulo</dt>
        <dd>{MODULE_LABELS[detail.module] ?? detail.module}</dd>
        {detail.entity && (
          <>
            <dt className="text-muted">Registro</dt>
            <dd className="break-all">{detail.entity.label ?? detail.entity.id}</dd>
          </>
        )}
        {detail.reason && (
          <>
            <dt className="text-muted">Motivo</dt>
            <dd>{detail.reason}</dd>
          </>
        )}
        <dt className="text-muted">Dispositivo</dt>
        <dd>{describeDevice(detail.userAgent)}</dd>
        <dt className="text-muted">IP</dt>
        <dd className="font-mono text-xs">{detail.ip ?? '—'}</dd>
      </dl>

      {fields.length > 0 && (
        <div>
          <p className="mb-2 font-medium">{isChange ? 'Cambios' : 'Datos registrados'}</p>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {fields.map((f) => (
                  <tr key={f}>
                    <th className="w-28 bg-bg/60 px-3 py-2 text-left font-medium text-muted">{FIELD_LABELS[f] ?? f}</th>
                    <td className="px-3 py-2">
                      {isChange ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger line-through">{formatAuditValue(f, detail.oldValues?.[f])}</span>
                          <ArrowRight className="size-3 text-muted" />
                          <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">{formatAuditValue(f, detail.newValues?.[f])}</span>
                        </span>
                      ) : (
                        formatAuditValue(f, (detail.newValues ?? detail.oldValues)?.[f])
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail.requestId && <p className="font-mono text-[11px] text-muted">Request ID: {detail.requestId}</p>}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditContent />
    </Suspense>
  );
}
