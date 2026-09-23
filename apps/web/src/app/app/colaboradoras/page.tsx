'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, EmptyState } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { initials } from '@/lib/format';
import type { StaffMember } from '@/lib/types';

export default function StaffPage() {
  const { can } = useAuth();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<StaffMember[]>('/staff')
      .then(setStaff)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar'));
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Colaboradoras</h1>
      <p className="mt-1 text-sm text-muted">
        Horarios, ausencias y servicios de cada una.{' '}
        {can('users.create') && (
          <>
            Para agregar una colaboradora crea un usuario con rol Empleada en{' '}
            <Link href="/app/usuarios" className="text-primary underline">
              Usuarios
            </Link>
            .
          </>
        )}
      </p>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      {staff && staff.length === 0 && <div className="mt-6"><EmptyState title="Aún no hay colaboradoras" /></div>}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {staff?.map((s) => (
          <li key={s.id}>
            <Link
              href={`/app/colaboradoras/${s.id}`}
              className={`flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition hover:border-primary/40 hover:shadow-sm ${s.isActive ? '' : 'opacity-60'}`}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold" style={{ backgroundColor: s.color }}>
                {initials(s.displayName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.displayName}</span>
                  {!s.isActive && <Badge>Inactiva</Badge>}
                  {s.isActive && !s.isBookableOnline && <Badge tone="warning">No reservable online</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {s.services.length ? s.services.map((x) => x.name).join(' · ') : 'Sin servicios asignados'}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
