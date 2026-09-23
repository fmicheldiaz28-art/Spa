'use client';

import { Copy, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ActionMenu, Alert, Badge, Button, Dialog, EmptyState, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative, initials } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/labels';
import type { Page, RoleOption, StaffUser } from './types';
import { UserFormSheet } from './user-form';

const FILTERS = [
  { key: 'all', label: 'Todos', query: '' },
  { key: 'admin', label: 'Administración', query: 'role=ADMIN' },
  { key: 'staff', label: 'Empleadas', query: 'role=EMPLEADA' },
  { key: 'inactive', label: 'Inactivos', query: 'status=INACTIVE' },
  { key: 'locked', label: 'Bloqueados', query: 'status=LOCKED' },
] as const;

function StatusBadge({ user }: { user: StaffUser }) {
  if (user.status === 'INACTIVE') return <Badge tone="neutral">Inactivo</Badge>;
  if (user.locked) return <Badge tone="danger">Bloqueado</Badge>;
  if (user.mustChangePassword) return <Badge tone="warning">Contraseña temporal</Badge>;
  return <Badge tone="success">Activo</Badge>;
}

function Avatar({ user }: { user: StaffUser }) {
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-text"
      style={{ backgroundColor: user.staff?.color ?? '#E4E8E3' }}
      aria-hidden
    >
      {initials(user.name)}
    </span>
  );
}

type Confirm =
  | { kind: 'deactivate'; user: StaffUser }
  | { kind: 'reset'; user: StaffUser }
  | { kind: 'sessions'; user: StaffUser };

export default function UsersPage() {
  const { user: me, can } = useAuth();
  const router = useRouter();
  const allowed = can('users.read');

  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<Page<StaffUser> | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffUser | null | undefined>(undefined); // undefined = cerrado
  const [secret, setSecret] = useState<{ user: StaffUser; password: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me && !allowed) router.replace('/app');
  }, [me, allowed, router]);

  const load = useCallback(async () => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const params = new URLSearchParams(f.query);
    if (q.trim()) params.set('q', q.trim());
    try {
      setData(await api<Page<StaffUser>>(`/users?${params}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar la lista');
    }
  }, [filter, q]);

  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [allowed, load, q]);

  useEffect(() => {
    if (allowed && can('roles.read')) void api<RoleOption[]>('/roles').then(setRoles).catch(() => undefined);
  }, [allowed, can]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? [err.problem.title, err.problem.detail].filter(Boolean).join('. ') : 'La acción falló');
    } finally {
      setBusy(false);
      setConfirm(null);
      setReason('');
    }
  }

  const activate = (u: StaffUser) =>
    run(async () => {
      await api(`/users/${u.id}/activate`, { method: 'POST' });
      setNotice(u.locked && u.status === 'ACTIVE' ? `${u.name} fue desbloqueado.` : `${u.name} fue reactivado.`);
    });

  async function onConfirm() {
    if (!confirm) return;
    const { user: u } = confirm;
    if (confirm.kind === 'deactivate') {
      await run(async () => {
        const r = await api<{ futureAppointments: number }>(`/users/${u.id}/deactivate`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason || undefined }),
        });
        setNotice(
          r.futureAppointments > 0
            ? `${u.name} fue desactivado. Tiene ${r.futureAppointments} citas futuras que debes reasignar.`
            : `${u.name} fue desactivado y ya no puede ingresar.`,
        );
      });
    } else if (confirm.kind === 'reset') {
      await run(async () => {
        const r = await api<{ temporaryPassword: string }>(`/users/${u.id}/force-password-reset`, { method: 'POST' });
        setSecret({ user: u, password: r.temporaryPassword });
      });
    } else {
      await run(async () => {
        await api(`/users/${u.id}/sessions`, { method: 'DELETE' });
        setNotice(`Se cerraron las sesiones de ${u.name}.`);
      });
    }
  }

  if (!allowed) return null;

  const rows = data?.data ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
          <p className="mt-1 text-sm text-muted">Quién puede ingresar al sistema y con qué rol.</p>
        </div>
        {can('users.create') && (
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> Nuevo usuario
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-surface p-1 ring-1 ring-border" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${filter === f.key ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o email" className="pl-9" aria-label="Buscar usuarios" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        {notice && (
          <Alert tone={notice.includes('citas futuras') ? 'warning' : 'success'}>
            <span className="flex items-start justify-between gap-3">
              {notice}
              <button onClick={() => setNotice(null)} className="text-xs underline">
                Cerrar
              </button>
            </span>
          </Alert>
        )}
      </div>

      <div className="mt-4">
        {data && rows.length === 0 ? (
          <EmptyState title="No hay usuarios con ese filtro" description={q ? 'Prueba con otra búsqueda.' : undefined} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="hidden border-b border-border bg-bg/60 text-left text-xs tracking-wide text-muted uppercase md:table-header-group">
                <tr>
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Último acceso</th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!data &&
                  Array.from({ length: 4 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-4">
                        <div className="h-5 w-2/3 animate-pulse rounded bg-bg" />
                      </td>
                    </tr>
                  ))}
                {rows.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.status === 'INACTIVE' ? 'opacity-60' : ''}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar user={u} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {u.name} {self && <span className="text-xs font-normal text-muted">(tú)</span>}
                            </p>
                            <p className="truncate text-xs text-muted">{u.email}</p>
                            <div className="mt-1 flex flex-wrap gap-1 md:hidden">
                              {u.role && <Badge tone="primary">{ROLE_LABELS[u.role]}</Badge>}
                              <StatusBadge user={u} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">{u.role && <Badge tone="primary">{ROLE_LABELS[u.role]}</Badge>}</td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <StatusBadge user={u} />
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">{formatRelative(u.lastLoginAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <ActionMenu
                          label={`Acciones para ${u.name}`}
                          items={[
                            { label: 'Editar', onSelect: () => setEditing(u), hidden: !can('users.update') },
                            {
                              label: 'Restablecer contraseña',
                              onSelect: () => setConfirm({ kind: 'reset', user: u }),
                              hidden: self || !can('users.reset_password') || u.status === 'INACTIVE',
                            },
                            {
                              label: 'Cerrar sus sesiones',
                              onSelect: () => setConfirm({ kind: 'sessions', user: u }),
                              hidden: self || !can('users.deactivate') || u.status === 'INACTIVE',
                            },
                            {
                              label: 'Desbloquear',
                              onSelect: () => void activate(u),
                              hidden: !u.locked || u.status !== 'ACTIVE' || !can('users.deactivate'),
                            },
                            {
                              label: 'Reactivar',
                              onSelect: () => void activate(u),
                              hidden: u.status !== 'INACTIVE' || !can('users.deactivate'),
                            },
                            {
                              label: 'Ver actividad',
                              onSelect: () => router.push(`/app/auditoria?entityId=${u.id}`),
                              hidden: !can('audit.read'),
                            },
                            {
                              label: 'Desactivar',
                              tone: 'danger',
                              onSelect: () => setConfirm({ kind: 'deactivate', user: u }),
                              hidden: self || u.status === 'INACTIVE' || !can('users.deactivate'),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <p className="mt-3 text-xs text-muted">
            {data.total} {data.total === 1 ? 'usuario' : 'usuarios'}
          </p>
        )}
      </div>

      <UserFormSheet
        open={editing !== undefined}
        user={editing ?? null}
        roles={roles}
        onClose={() => setEditing(undefined)}
        onSaved={(saved, password) => {
          setEditing(undefined);
          if (password) setSecret({ user: saved, password });
          else setNotice(`Se guardaron los cambios de ${saved.name}.`);
          void load();
        }}
      />

      <Dialog
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        title={
          confirm?.kind === 'deactivate'
            ? `¿Desactivar a ${confirm.user.name}?`
            : confirm?.kind === 'reset'
              ? `¿Restablecer la contraseña de ${confirm.user.name}?`
              : `¿Cerrar las sesiones de ${confirm?.user.name}?`
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant={confirm?.kind === 'deactivate' ? 'danger' : 'primary'} size="sm" onClick={() => void onConfirm()} disabled={busy}>
              {busy ? 'Procesando…' : confirm?.kind === 'deactivate' ? 'Desactivar' : 'Confirmar'}
            </Button>
          </>
        }
      >
        {confirm?.kind === 'deactivate' && (
          <div className="space-y-3">
            <p className="text-muted">
              Perderá el acceso de inmediato y se cerrarán todas sus sesiones. Su historial se conserva y puedes reactivarlo cuando quieras.
            </p>
            <Field label="Motivo (opcional)" htmlFor="reason">
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: fin de contrato" />
            </Field>
          </div>
        )}
        {confirm?.kind === 'reset' && (
          <p className="text-muted">
            Se generará una contraseña temporal y se cerrarán sus sesiones. Deberá cambiarla al ingresar.
          </p>
        )}
        {confirm?.kind === 'sessions' && <p className="text-muted">Tendrá que volver a iniciar sesión en todos sus dispositivos.</p>}
      </Dialog>

      <TemporaryPasswordDialog secret={secret} onClose={() => setSecret(null)} />

      <p className="mt-8 text-xs text-muted">
        Cada cambio queda registrado en{' '}
        {can('audit.read') ? (
          <Link href="/app/auditoria?module=users" className="underline">
            Auditoría
          </Link>
        ) : (
          'Auditoría'
        )}
        .
      </p>
    </div>
  );
}

function TemporaryPasswordDialog({ secret, onClose }: { secret: { user: StaffUser; password: string } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [secret]);
  return (
    <Dialog
      open={!!secret}
      onClose={onClose}
      title="Contraseña temporal"
      footer={
        <Button size="sm" onClick={onClose}>
          Listo
        </Button>
      }
    >
      {secret && (
        <div className="space-y-3">
          <p className="text-muted">
            Entrégasela a <strong className="text-text">{secret.user.name}</strong> ({secret.user.email}) por un medio privado. No volverá a
            mostrarse; al ingresar deberá definir una propia.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
            <code className="flex-1 font-mono text-base tracking-wider">{secret.password}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(secret.password).then(() => setCopied(true));
              }}
            >
              <Copy className="size-4" /> {copied ? 'Copiada' : 'Copiar'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
