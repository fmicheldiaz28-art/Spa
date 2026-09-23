'use client';

import { AlertTriangle, ArrowLeft, Eye, MessageCircle, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ActionMenu, Alert, Button, Dialog, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, initials } from '@/lib/format';
import { type Client, type ClientFull, formatMoney } from '@/lib/types';
import { ClientFormSheet } from '../client-form';

const REVEAL_SECONDS = 60;

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<{ phone: string | null; email: string | null } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setClient(await api<Client>(`/clients/${id}`));
    } catch (err) {
      setError(err instanceof ApiError && err.problem.status === 404 ? 'Clienta no encontrada' : 'No se pudo cargar la ficha');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // El contacto revelado se oculta solo a los 60 s (docs/09-ux-ui.md, microinteracciones).
  useEffect(() => {
    if (!contact) return;
    setRemaining(REVEAL_SECONDS);
    const t = setInterval(() => setRemaining((s) => s - 1), 1000);
    const hide = setTimeout(() => setContact(null), REVEAL_SECONDS * 1000);
    return () => {
      clearInterval(t);
      clearTimeout(hide);
    };
  }, [contact]);

  async function reveal() {
    try {
      setContact(await api<{ phone: string | null; email: string | null }>(`/clients/${id}/reveal-contact`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof ApiError ? [err.problem.title, err.problem.detail].filter(Boolean).join('. ') : 'No se pudo revelar');
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/clients/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      router.replace('/app/clientes');
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo eliminar');
      setDeleting(false);
    }
  }

  if (!client) return error ? <Alert>{error}</Alert> : <p className="text-sm text-muted">Cargando…</p>;

  const health = [client.allergies && `Alergias: ${client.allergies}`, client.contraindications && `Contraindicaciones: ${client.contraindications}`].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl">
      {!client.restricted && (
        <Link href="/app/clientes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Clientes
        </Link>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{initials(client.name)}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          {!client.restricted && (
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="tabular">📞 {contact ? (contact.phone ?? '—') : (client.phone ?? 'Sin teléfono')}</span>
              <span>✉ {contact ? (contact.email ?? '—') : (client.email ?? 'Sin email')}</span>
              {client.birthDate && <span>🎂 {new Date(`${client.birthDate}T12:00:00Z`).toLocaleDateString('es-BO', { day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>}
            </div>
          )}
        </div>
        {!client.restricted && (
          <div className="flex items-center gap-2">
            {can('clients.view_contact') && (client.hasPhone || client.hasEmail) && !contact && (
              <Button size="sm" variant="secondary" onClick={() => void reveal()}>
                <Eye className="size-4" /> Ver contacto
              </Button>
            )}
            {contact?.phone && (
              <a
                href={`https://wa.me/${contact.phone.replace('+', '')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#25D366] px-3 text-sm font-medium text-white"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {can('clients.update') && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Editar
              </Button>
            )}
            <ActionMenu
              label="Más acciones"
              items={[
                { label: 'Ver actividad', onSelect: () => router.push(`/app/auditoria?entityId=${client.id}`), hidden: !can('audit.read') },
                { label: 'Eliminar', tone: 'danger', onSelect: () => setDeleting(true), hidden: !can('clients.delete') },
              ]}
            />
          </div>
        )}
      </div>
      {contact && <p className="mt-2 text-xs text-muted">El contacto se ocultará en {remaining} s. Esta consulta quedó registrada.</p>}

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      {health.length > 0 && (
        <div className="mt-5 flex gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            {health.map((h) => (
              <p key={h as string} className="font-medium">
                {h}
              </p>
            ))}
          </div>
        </div>
      )}

      {!client.restricted && <Stats client={client} />}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Notes key={client.preferences ?? ''} client={client} onSaved={setClient} />
        {!client.restricted && client.internalNotes !== undefined && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold">Observaciones internas</h2>
            <p className="mt-2 text-sm whitespace-pre-line text-muted">{client.internalNotes || 'Sin observaciones.'}</p>
          </section>
        )}
      </div>

      <section className="mt-6 rounded-xl border border-dashed border-border p-5 text-sm text-muted">
        El historial de citas aparecerá aquí cuando esté disponible la agenda (próximo sprint).
      </section>

      {!client.restricted && (
        <ClientFormSheet
          open={editing}
          client={client}
          onClose={() => setEditing(false)}
          onSaved={(c) => {
            setEditing(false);
            setClient(c);
          }}
        />
      )}

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`¿Eliminar la ficha de ${client.name}?`}
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setDeleting(false)}>
              Cancelar
            </Button>
            <Button size="sm" variant="danger" type="submit" form="delete-form" disabled={reason.trim().length < 3}>
              Eliminar
            </Button>
          </>
        }
      >
        <form id="delete-form" onSubmit={remove} className="space-y-3">
          <p className="text-muted">La ficha deja de aparecer, pero queda guardada y registrada en la auditoría.</p>
          <Field label="Motivo *" htmlFor="dreason">
            <Input id="dreason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: ficha duplicada" />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}

function Stats({ client }: { client: ClientFull }) {
  const s = client.stats;
  const avg = s.visits ? Number(s.totalSpent) / s.visits : 0;
  const items = [
    { label: 'Visitas', value: String(s.visits) },
    { label: 'Gasto total', value: formatMoney(s.totalSpent) },
    { label: 'Ticket promedio', value: s.visits ? formatMoney(avg) : '—' },
    { label: 'No asistió', value: String(s.noShows) },
  ];
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">{i.label}</p>
          <p className="tabular mt-1 text-lg font-semibold">{i.value}</p>
        </div>
      ))}
      <p className="col-span-full text-xs text-muted">Clienta desde {formatDateTime(client.createdAt).slice(0, 10)}</p>
    </div>
  );
}

/** Preferencias de servicio: la especialista asignada también puede actualizarlas. */
function Notes({ client, onSaved }: { client: Client; onSaved: (c: Client) => void }) {
  const { can } = useAuth();
  const editable = can('clients.update_service_notes') || can('clients.update');
  const [value, setValue] = useState(client.preferences ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = value !== (client.preferences ?? '');

  async function save() {
    setSaving(true);
    try {
      onSaved(await api<Client>(`/clients/${client.id}/service-notes`, { method: 'PATCH', body: JSON.stringify({ preferences: value || null }) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">Preferencias de servicio</h2>
      {editable ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            placeholder="Ej.: presión media, sin música, aceite neutro"
            className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {dirty && (
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar preferencias'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{client.preferences || 'Sin preferencias registradas.'}</p>
      )}
    </section>
  );
}
