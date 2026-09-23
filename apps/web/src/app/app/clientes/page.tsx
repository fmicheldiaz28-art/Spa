'use client';

import { AlertTriangle, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, EmptyState, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative, initials } from '@/lib/format';
import type { ClientFull } from '@/lib/types';
import { ClientFormSheet } from './client-form';
import { ImportSheet } from './import-sheet';

interface Page {
  data: ClientFull[];
  total: number;
  page: number;
  pageSize: number;
}

export default function ClientsPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('clients.read_all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (q.trim()) params.set('q', q.trim());
    try {
      setData(await api<Page>(`/clients?${params}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar');
    }
  }, [q, page]);

  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [allowed, load, q]);

  if (!allowed) return null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-1 text-sm text-muted">El contacto se muestra oculto; revelarlo queda registrado.</p>
        </div>
        <div className="flex gap-2">
        {can('clients.import') && (
          <Button variant="secondary" onClick={() => setImporting(true)}>
            Importar CSV
          </Button>
        )}
        {can('clients.create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nueva clienta
          </Button>
        )}
        </div>
      </div>

      <div className="relative mt-6 md:w-96">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Nombre, teléfono o email"
          className="pl-9"
          aria-label="Buscar clientas"
        />
      </div>

      <div className="mt-4">
        {error && <Alert>{error}</Alert>}
        {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}
        {data && data.data.length === 0 ? (
          <EmptyState title={q ? 'Sin resultados' : 'Aún no hay clientas'} description={q ? 'Prueba con otro nombre o con los últimos dígitos del teléfono.' : undefined} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="hidden border-b border-border bg-bg/60 text-left text-xs tracking-wide text-muted uppercase md:table-header-group">
                <tr>
                  <th className="px-4 py-3 font-medium">Clienta</th>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <th className="px-4 py-3 font-medium">Visitas</th>
                  <th className="px-4 py-3 font-medium">Última visita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!data &&
                  Array.from({ length: 5 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-4">
                        <div className="h-4 w-1/2 animate-pulse rounded bg-bg" />
                      </td>
                    </tr>
                  ))}
                {data?.data.map((c) => (
                  <tr key={c.id} className="hover:bg-bg/60">
                    <td className="px-4 py-3">
                      <Link href={`/app/clientes/${c.id}`} className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(c.name)}</span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            {c.name}
                            {(c.allergies || c.contraindications) && <AlertTriangle className="size-3.5 text-danger" aria-label="Tiene alergias o contraindicaciones" />}
                          </span>
                          <span className="block text-xs text-muted md:hidden">{c.phone ?? 'Sin teléfono'}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="tabular hidden px-4 py-3 text-muted md:table-cell">{c.phone ?? '—'}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{c.stats.visits}</td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">{c.stats.lastVisitAt ? formatRelative(c.stats.lastVisitAt) : 'Sin visitas'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted">
              {data.total} clientas · página {page} de {pages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </div>

      <ImportSheet
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(n) => {
          setNotice(`Se importaron ${n} clientas.`);
          void load();
        }}
      />

      <ClientFormSheet
        open={creating}
        client={null}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          router.push(`/app/clientes/${c.id}`);
        }}
      />
    </div>
  );
}
