'use client';

import { ArrowDown, ArrowUp, Clock, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMoney, type Service, type ServicePackage } from '@/lib/types';

const errorText = (err: unknown) => {
  const p = err instanceof ApiError ? err.problem : null;
  return [p?.title, p?.detail, ...(p?.errors?.map((e) => e.message) ?? [])].filter(Boolean).join(' ') || 'La operación falló';
};

/** Paquetes como el "Día de Novia" (docs/06-modulos.md M6). */
export default function PackagesPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('packages.manage');
  const [packages, setPackages] = useState<ServicePackage[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [editing, setEditing] = useState<ServicePackage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api<ServicePackage[]>('/packages'), api<Service[]>('/services?active=true')]);
    setPackages(p);
    setServices(s);
  }, []);

  useEffect(() => {
    if (allowed) load().catch((err: unknown) => setError(errorText(err)));
  }, [allowed, load]);

  if (!allowed) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paquetes</h1>
          <p className="mt-1 text-sm text-muted">Servicios combinados en secuencia o en paralelo, con un precio especial.</p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus className="size-4" /> Nuevo paquete
        </Button>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {packages?.length === 0 && <EmptyState title="Aún no hay paquetes" />}
        {packages?.map((p) => {
          const groups = [...new Set(p.items.map((i) => i.parallelGroup))];
          return (
            <button key={p.id} onClick={() => setEditing(p)} className={`rounded-xl border border-border bg-surface p-5 text-left transition hover:border-primary/40 ${p.isActive ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-semibold">{p.name}</p>
                {!p.isActive && <Badge>Inactivo</Badge>}
              </div>
              <p className="mt-1 text-sm">
                <strong>{formatMoney(p.price)}</strong>{' '}
                {Number(p.listPrice) > Number(p.price) && <span className="text-muted line-through">{formatMoney(p.listPrice)}</span>}
                <span className="ml-2 inline-flex items-center gap-1 text-muted">
                  <Clock className="size-3.5" /> {Math.floor(p.totalMin / 60)} h {p.totalMin % 60} min
                </span>
              </p>
              <ol className="mt-3 space-y-1 text-sm">
                {groups.map((g, i) => (
                  <li key={g} className="flex gap-2">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">{i + 1}</span>
                    {p.items
                      .filter((x) => x.parallelGroup === g)
                      .map((x) => x.serviceName)
                      .join(' + ')}
                    {p.items.filter((x) => x.parallelGroup === g).length > 1 && <span className="text-xs text-muted">(en paralelo)</span>}
                  </li>
                ))}
              </ol>
            </button>
          );
        })}
      </div>

      <PackageForm
        open={editing !== undefined}
        pkg={editing ?? null}
        services={services}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          void load();
        }}
      />
    </div>
  );
}

interface Row {
  serviceId: string;
  parallel: boolean; // en paralelo con el ítem anterior
}

function PackageForm({ open, pkg, services, onClose, onSaved }: { open: boolean; pkg: ServicePackage | null; services: Service[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(pkg?.name ?? '');
    setPrice(pkg ? String(Number(pkg.price)) : '');
    setDescription(pkg?.description ?? '');
    setActive(pkg?.isActive ?? true);
    setRows(pkg?.items.map((i, idx) => ({ serviceId: i.serviceId, parallel: idx > 0 && i.parallelGroup === pkg.items[idx - 1]!.parallelGroup })) ?? []);
    setError(null);
  }, [open, pkg]);

  const byId = new Map(services.map((s) => [s.id, s]));
  const listPrice = rows.reduce((sum, r) => sum + Number(byId.get(r.serviceId)?.price ?? 0), 0);

  function groupsOf(list: Row[]) {
    let g = 0;
    return list.map((r, i) => ({ serviceId: r.serviceId, parallelGroup: i === 0 || !r.parallel ? ++g : g }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(pkg ? `/packages/${pkg.id}` : '/packages', {
        method: pkg ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, price: Number(price), description: description || null, isActive: active, items: groupsOf(rows) }),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const move = (i: number, d: -1 | 1) =>
    setRows((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x!);
      return next.map((r, idx) => (idx === 0 ? { ...r, parallel: false } : r));
    });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={pkg ? 'Editar paquete' : 'Nuevo paquete'}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="package-form" disabled={saving || rows.length < 2 || !name || !price}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="package-form" onSubmit={onSubmit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre *" htmlFor="pname">
          <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Día de Novia" />
        </Field>
        <Field label="Precio del paquete (Bs) *" htmlFor="pprice" hint={rows.length ? `Suma de los servicios por separado: ${formatMoney(listPrice)}` : undefined}>
          <Input id="pprice" type="number" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Descripción" htmlFor="pdesc">
          <Input id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium">Servicios (en orden)</p>
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li key={`${r.serviceId}-${i}`} className="rounded-lg border border-border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">{groupsOf(rows)[i]!.parallelGroup}</span>
                  <span className="flex-1">
                    {byId.get(r.serviceId)?.name ?? 'Servicio inactivo'} <span className="text-xs text-muted">{byId.get(r.serviceId)?.durationMin} min</span>
                  </span>
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-muted disabled:opacity-30" aria-label="Subir">
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="p-1 text-muted disabled:opacity-30" aria-label="Bajar">
                    <ArrowDown className="size-4" />
                  </button>
                  <button type="button" onClick={() => setRows((list) => list.filter((_, idx) => idx !== i))} className="p-1 text-muted hover:text-danger" aria-label="Quitar">
                    <X className="size-4" />
                  </button>
                </div>
                {i > 0 && (
                  <label className="mt-1 ml-8 flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={r.parallel}
                      onChange={(e) => setRows((list) => list.map((x, idx) => (idx === i ? { ...x, parallel: e.target.checked } : x)))}
                      className="accent-[var(--color-primary)]"
                    />
                    Al mismo tiempo que el anterior (otra colaboradora)
                  </label>
                )}
              </li>
            ))}
          </ol>
          <Select
            className="mt-2"
            value=""
            onChange={(e) => e.target.value && setRows((list) => [...list, { serviceId: e.target.value, parallel: false }])}
            aria-label="Agregar servicio"
          >
            <option value="">+ Agregar servicio…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.durationMin} min · {formatMoney(s.price)}
              </option>
            ))}
          </Select>
        </div>

        {pkg && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
            Activo
          </label>
        )}
      </form>
    </Sheet>
  );
}
