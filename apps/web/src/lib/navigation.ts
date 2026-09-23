import type { Permission } from '@naturalspa/shared';
import {
  BarChart3,
  CalendarDays,
  Clock,
  Gift,
  Home,
  type LucideIcon,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible si el usuario tiene cualquiera de estos permisos. */
  anyOf: Permission[];
  /** false = módulo planificado para un sprint posterior. */
  ready: boolean;
}

/** Menú lateral por rol (docs/09-ux-ui.md §14.2). */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/app/dashboard', icon: Home, anyOf: ['dashboard.view_global'], ready: true },
  { label: 'Mi día', href: '/app/mi-dia', icon: Home, anyOf: ['dashboard.view_own'], ready: true },
  { label: 'Agenda', href: '/app/agenda', icon: CalendarDays, anyOf: ['appointments.read_all', 'appointments.read_own'], ready: true },
  { label: 'Clientes', href: '/app/clientes', icon: Users, anyOf: ['clients.read_all'], ready: true },
  { label: 'Servicios', href: '/app/servicios', icon: Sparkles, anyOf: ['services.manage'], ready: true },
  { label: 'Paquetes', href: '/app/paquetes', icon: Gift, anyOf: ['packages.manage'], ready: true },
  { label: 'Colaboradoras', href: '/app/colaboradoras', icon: UsersRound, anyOf: ['staff.manage'], ready: true },
  { label: 'Horarios', href: '/app/horarios', icon: Clock, anyOf: ['schedules.read_all', 'schedules.read_own'], ready: true },
  { label: 'Cobros', href: '/app/cobros', icon: Wallet, anyOf: ['payments.read_all'], ready: true },
  { label: 'Reportes', href: '/app/reportes', icon: BarChart3, anyOf: ['reports.view_global', 'reports.view_own'], ready: true },
  { label: 'Auditoría', href: '/app/auditoria', icon: ShieldCheck, anyOf: ['audit.read'], ready: true },
  { label: 'Usuarios', href: '/app/usuarios', icon: UserCog, anyOf: ['users.read'], ready: true },
  { label: 'Configuración', href: '/app/configuracion', icon: Settings, anyOf: ['settings.manage'], ready: true },
];

export function visibleNav(permissions: readonly Permission[]): NavItem[] {
  const items = NAV_ITEMS.filter((item) => item.anyOf.some((p) => permissions.includes(p)));
  // Quien ve el dashboard global no necesita "Mi día" en el menú.
  return permissions.includes('dashboard.view_global') ? items.filter((i) => i.href !== '/app/mi-dia') : items;
}
