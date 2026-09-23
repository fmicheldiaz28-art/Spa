'use client';

import { Clock, Globe, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type Category, formatMoney, type Service, type StaffMember } from '@/lib/types';

const errorText = (err: unknown) => {
  const p = err instanceof ApiError ? err.problem : null;
  return [p?.title, p?.detail, ...(p?.errors?.map((e) => e.message) ?? [])].filter(Boolean).join(' ') || 'La operación falló';
};

export default function ServicesPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('services.manage');
  const [services, setServices] = useState<Service[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [editing, setEditing] = useState<Service | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  const load = useCallback(async () => {
    const [s, c, st] = await Promise.all([api<Service[]>('/services'), api<Category[]>('/service-categories'), api<StaffMember[]>('/staff')]);
    setServices(s);
    setCategories(c);
    setStaff(st.filter((x) => x.isActive));
  }, []);

  useEffect(() => {
    if (allowed) load().catch((err: unknown) => setError(errorText(err)));
  }, [allowed, load]);

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/service-categories', { method: 'POST', body: JSON.stringify({ name: newCategory }) });
      setNewCategory('');
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!allowed) return null;
  const visible = (services ?? []).filter((s) => showInactive || s.isActive);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servicios</h1>
          <p className="mt-1 text-sm text-muted">Duración, precio y quién los realiza. Los cambios de precio no alteran citas ya agendadas.</p>
        </div>
        <Button onClick={() => setEditing(null)} disabled={!categories.length}>
          <Plus className="size-4" /> Nuevo servicio
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Mostrar inactivos
        </label>
        <form onSubmit={addCategory} className="flex gap-2">
          <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Nueva categoría" className="h-9 w-44" aria-label="Nueva categoría" />
          <Button size="sm" variant="secondary" type="submit" disabled={newCategory.trim().length < 2}>
            Agregar
          </Button>
        </form>
      </div>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      <div className="mt-6 space-y-6">
        {services && visible.length === 0 && <EmptyState title="Sin servicios" />}
        {categories.map((c) => {
          const items = visible.filter((s) => s.category.id === c.id);
          if (!items.length) return null;
          return (
            <section key={c.id}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color ?? '#E4E8E3' }} />
                {c.name}
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {items.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setEditing(s)} className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-bg/60 sm:flex-row sm:items-center sm:gap-4 ${s.isActive ? '' : 'opacity-60'}`}>
                      <span className="flex-1">
                        <span className="flex items-center gap-2 font-medium">
                          {s.name}
                          {!s.isActive && <Badge>Inactivo</Badge>}
                          {s.isActive && s.isOnlineBookable && (
                            <Badge tone="info">
                              <Globe className="size-3" /> Online
                            </Badge>
                          )}
                        </span>
                        <span className="text-xs text-muted">{s.staff.length ? s.staff.map((x) => x.displayName).join(' · ') : 'Sin colaboradoras asignadas'}</span>
                      </span>
                      <span className="flex items-center gap-1 text-sm text-muted">
                        <Clock className="size-3.5" /> {s.durationMin} min{s.bufferAfterMin ? ` + ${s.bufferAfterMin}` : ''}
                      </span>
                      <span className="tabular w-28 text-sm font-medium sm:text-right">{formatMoney(s.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <ServiceForm
        open={editing !== undefined}
        service={editing ?? null}
        categories={categories}
        staff={staff}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          void load();
        }}
      />
    </div>
  );
}

function ServiceForm({
  open,
  service,
  categories,
  staff,
  onClose,
  onSaved,
}: {
  open: boolean;
  service: Service | null;
  categories: Category[];
  staff: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [durationMin, setDurationMin] = useState('60');
  const [bufferAfterMin, setBufferAfterMin] = useState('10');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState(true);
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? '');
    setCategoryId(service?.category.id ?? categories[0]?.id ?? '');
    setDurationMin(String(service?.durationMin ?? 60));
    setBufferAfterMin(String(service?.bufferAfterMin ?? 10));
    setPrice(service ? String(Number(service.price)) : '');
    setDescription(service?.description ?? '');
    setOnline(service?.isOnlineBookable ?? true);
    setActive(service?.isActive ?? true);
    setStaffIds(service?.staff.map((s) => s.id) ?? []);
    setErrors(null);
  }, [open, service, categories]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors(null);
    const body = {
      name,
      categoryId,
      durationMin: Number(durationMin),
      bufferAfterMin: Number(bufferAfterMin),
      price: Number(price),
      description: description || null,
      isOnlineBookable: online,
      staffIds,
      ...(service && { isActive: active }),
    };
    try {
      await api(service ? `/services/${service.id}` : '/services', { method: service ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (err) {
      setErrors(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={service ? 'Editar servicio' : 'Nuevo servicio'}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="service-form" disabled={saving || !name || !price || !categoryId}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={onSubmit} className="space-y-5">
        {errors && <Alert>{errors}</Alert>}
        <Field label="Nombre *" htmlFor="sname">
          <Input id="sname" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Categoría *" htmlFor="scat">
          <Select id="scat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Duración (min)" htmlFor="sdur">
            <Input id="sdur" type="number" min={5} max={600} step={5} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
          </Field>
          <Field label="Preparación" htmlFor="sbuf" hint="min después">
            <Input id="sbuf" type="number" min={0} max={120} step={5} value={bufferAfterMin} onChange={(e) => setBufferAfterMin(e.target.value)} />
          </Field>
          <Field label="Precio (Bs) *" htmlFor="sprice">
            <Input id="sprice" type="number" min={0} step="0.5" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <Field label="Descripción" htmlFor="sdesc" hint="Se muestra en las reservas online.">
          <textarea
            id="sdesc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">¿Quién lo realiza?</legend>
          {staff.length === 0 && <p className="text-sm text-muted">No hay colaboradoras activas.</p>}
          <div className="grid grid-cols-2 gap-2">
            {staff.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={staffIds.includes(s.id)}
                  onChange={(e) => setStaffIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id)))}
                  className="size-4 accent-[var(--color-primary)]"
                />
                <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.displayName}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Las clientas pueden reservarlo online
        </label>
        {service && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
            Activo (si lo desactivas, deja de ofrecerse pero su historial se conserva)
          </label>
        )}
      </form>
    </Sheet>
  );
}
