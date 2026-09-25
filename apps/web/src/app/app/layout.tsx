'use client';

import { ROLE_NAMES } from '@naturalspa/shared';
import { KeyRound, LogOut, Menu, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { Sheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { type NavItem, visibleNav } from '@/lib/navigation';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function NavLink({ item, active, compact = false }: { item: NavItem; active: boolean; compact?: boolean }) {
  const Icon = item.icon;
  const base = compact
    ? 'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]'
    : 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition';
  const tone = compact
    ? active
      ? 'text-primary'
      : 'text-muted'
    : active
      ? 'bg-sidebar-active text-white shadow-[inset_3px_0_0_var(--color-sidebar-accent)]'
      : 'text-sidebar-fg hover:bg-white/5 hover:text-white';

  if (!item.ready) {
    return (
      <span
        className={`${base} cursor-default ${compact ? 'text-muted/60' : 'text-sidebar-fg/55'}`}
        title="Disponible en un próximo sprint"
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
        {!compact && (
          <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sidebar-fg/80">
            Pronto
          </span>
        )}
      </span>
    );
  }
  return (
    <Link href={item.href} className={`${base} ${tone}`} aria-current={active ? 'page' : undefined}>
      <Icon className={compact ? 'size-5' : 'size-4 shrink-0'} aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    if (status === 'authenticated' && user?.mustChangePassword) router.replace('/cambiar-contrasena');
    else if (status === 'authenticated' && user?.mfaSetupRequired) router.replace('/seguridad');
  }, [status, user, router]);

  if (status !== 'authenticated' || !user || user.mustChangePassword || user.mfaSetupRequired) {
    return <div className="grid min-h-dvh place-items-center text-sm text-muted">Cargando…</div>;
  }

  const items = visibleNav(user.permissions);
  const role = user.roles[0] ? ROLE_NAMES[user.roles[0]] : '';

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar oscuro (escritorio) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar px-3 py-5 lg:flex">
        <div className="px-3">
          <Brand />
        </div>
        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto" aria-label="Principal">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 border-t border-white/10 px-3 pt-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent/25 text-sm font-semibold text-white">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-sidebar-fg">{role}</p>
          </div>
          <Link href="/seguridad" className="rounded-md p-2 text-sidebar-fg hover:bg-white/5 hover:text-white" aria-label="Seguridad de la cuenta" title="Seguridad de la cuenta">
            <ShieldCheck className="size-4" />
          </Link>
          <button onClick={onLogout} className="rounded-md p-2 text-sidebar-fg hover:bg-white/5 hover:text-white" aria-label="Cerrar sesión">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Topbar móvil */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur lg:hidden">
        <span className="text-base font-semibold">NaturalSpa</span>
        <button onClick={onLogout} className="rounded-md p-2 text-muted hover:text-text" aria-label="Cerrar sesión">
          <LogOut className="size-4" />
        </button>
      </header>

      <main className="px-4 pt-6 pb-24 lg:px-8 lg:pb-10">{children}</main>

      {/* Barra inferior (móvil): módulos disponibles + "Más" con el menú completo */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface lg:hidden" aria-label="Principal">
        {items
          .filter((i) => i.ready)
          .slice(0, 3)
          .map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} compact />
          ))}
        <button onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] text-muted">
          <Menu className="size-5" aria-hidden />
          Más
        </button>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Menú">
        <nav className="space-y-1 rounded-xl bg-sidebar p-2" aria-label="Menú completo" onClick={() => setMoreOpen(false)}>
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/seguridad" className="flex items-center gap-2 text-primary">
            <ShieldCheck className="size-4" /> Verificación en dos pasos
          </Link>
          <Link href="/cambiar-contrasena" className="flex items-center gap-2 text-primary">
            <KeyRound className="size-4" /> Cambiar contraseña
          </Link>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">{role}</p>
          </div>
          <button onClick={onLogout} className="flex items-center gap-2 text-sm text-danger">
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </div>
      </Sheet>
    </div>
  );
}
