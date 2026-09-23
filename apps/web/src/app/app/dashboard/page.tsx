'use client';

import { Ban, CalendarCheck, CircleDollarSign, Globe, Percent, TrendingUp, UserX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KpiCard } from '@/components/kpi-card';
import { Alert } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { type Appointment, type CalendarData, STATUS, timeOf } from '@/lib/appointments';
import { useAuth } from '@/lib/auth';
import { todayLocal } from '@/lib/schedule';
import { formatMoney } from '@/lib/types';

interface Summary {
  period: { from: string; to: string };
  kpis: {
    salesToday: { value: string; deltaPct: number | null };
    salesMonth: { value: string; deltaPct: number | null };
    appointmentsToday: { value: number; byStatus: Record<string, number> };
    occupancy: { todayPct: number; weekPct: number };
    cancellations: { count: number; pct: number };
    noShow: { count: number; pct: number };
    onlineBookings: { count: number; pct: number };
  };
}

interface Charts {
  sales: { date: string; amount: number; previous: number }[];
  topServices: { name: string; count: number; revenue: number }[];
  staffOccupancy: { id: string; name: string; color: string; pct: number }[];
  newClients: { weekStart: string; online: number; manual: number }[];
}

type Period = 'month' | 'prev' | '7d';

function periodRange(p: Period): { from: string; to: string } {
  const today = todayLocal();
  if (p === '7d') {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (p === 'prev') {
    const [y, m] = today.split('-').map(Number) as [number, number];
    return { from: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10) };
  }
  return { from: `${today.slice(0, 8)}01`, to: today };
}

const delta = (v: number | null) =>
  v === null ? 'Sin período anterior para comparar' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toLocaleString('es-BO')} % vs. período anterior`;

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-BO', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function DashboardPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('dashboard.view_global');
  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/app/mi-dia');
  }, [user, allowed, router]);

  useEffect(() => {
    if (!allowed) return;
    const { from, to } = periodRange(period);
    Promise.all([api<Summary>(`/dashboard/summary?from=${from}&to=${to}`), api<Charts>(`/dashboard/charts?from=${from}&to=${to}`)])
      .then(([s, c]) => {
        setSummary(s);
        setCharts(c);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.problem.title : 'No se pudo cargar el dashboard'));
  }, [allowed, period]);

  useEffect(() => {
    if (!allowed) return;
    const today = todayLocal();
    void api<CalendarData>(`/appointments/calendar?from=${today}&to=${today}`).then((d) =>
      setUpcoming(d.appointments.filter((a) => ['CONFIRMADA', 'PENDIENTE', 'EN_CURSO'].includes(a.status) && new Date(a.endAt) > new Date()).slice(0, 6)),
    );
  }, [allowed]);

  if (!allowed) return null;
  const k = summary?.kpis;
  const today = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/La_Paz' }).format(new Date());

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hola, {user?.firstName} 👋</h1>
          <p className="mt-1 text-sm text-muted first-letter:uppercase">{today}</p>
        </div>
        <div className="flex rounded-lg bg-surface p-0.5 ring-1 ring-border" role="tablist" aria-label="Período">
          {([['7d', '7 días'], ['month', 'Este mes'], ['prev', 'Mes anterior']] as const).map(([p, label]) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={`rounded-md px-3 py-1 text-sm ${period === p ? 'bg-primary text-white' : 'text-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Indicadores">
        <Link href="/app/cobros"><KpiCard label="Ventas del día" icon={CircleDollarSign} value={k ? formatMoney(k.salesToday.value) : '—'} hint={k ? delta(k.salesToday.deltaPct) : ''} /></Link>
        <KpiCard label="Ventas del mes" icon={TrendingUp} value={k ? formatMoney(k.salesMonth.value) : '—'} hint={k ? delta(k.salesMonth.deltaPct) : ''} />
        <Link href="/app/agenda"><KpiCard
          label="Citas del día"
          icon={CalendarCheck}
          value={k ? String(k.appointmentsToday.value) : '—'}
          hint={k ? Object.entries(k.appointmentsToday.byStatus).map(([s, n]) => `${STATUS[s as keyof typeof STATUS]?.icon ?? ''}${n}`).join('  ') || 'Sin citas hoy' : ''}
        /></Link>
        <KpiCard label="Ocupación hoy" icon={Percent} value={k ? `${k.occupancy.todayPct.toLocaleString('es-BO')} %` : '—'} hint={k ? `Semana: ${k.occupancy.weekPct.toLocaleString('es-BO')} %` : ''} />
        <KpiCard label="Cancelaciones" icon={Ban} value={k ? String(k.cancellations.count) : '—'} hint={k ? `${k.cancellations.pct.toLocaleString('es-BO')} % del período` : ''} />
        <KpiCard label="No asistió" icon={UserX} value={k ? String(k.noShow.count) : '—'} hint={k ? `${k.noShow.pct.toLocaleString('es-BO')} % de las citas que debían ocurrir` : ''} />
        <KpiCard label="Reservas online" icon={Globe} value={k ? String(k.onlineBookings.count) : '—'} hint={k ? `${k.onlineBookings.pct.toLocaleString('es-BO')} % del período` : ''} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3" aria-label="Gráficas">
        <ChartCard title="Ventas (últimos 30 días)" className="lg:col-span-2">
          {charts && (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={charts.sales} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E8E3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#6B7770' }} interval={6} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7770' }} width={48} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => shortDate(String(l))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="amount" name="Actual" stroke="#4F7A5A" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="previous" name="30 días antes" stroke="#C9A27E" strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Próximas citas de hoy">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">No quedan citas por hoy.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="tabular w-11 font-medium">{timeOf(a.startAt)}</span>
                  <span className="size-2 rounded-full" style={{ backgroundColor: a.items[0]?.staff.color }} />
                  <span className="min-w-0 flex-1 truncate">
                    {a.client.name} {(a.client.allergies || a.client.contraindications) && '⚠️'} · {a.items[0]?.serviceName}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/agenda" className="mt-3 inline-block text-xs text-primary hover:underline">
            Ver agenda completa →
          </Link>
        </ChartCard>

        <ChartCard title="Servicios más vendidos">
          {charts && charts.topServices.length === 0 ? (
            <p className="text-sm text-muted">Sin citas en el período.</p>
          ) : (
            charts && (
              <ResponsiveContainer width="100%" height={Math.max(160, charts.topServices.length * 34)}>
                <BarChart data={charts.topServices} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#1B221E' }} />
                  <Tooltip formatter={(v) => [`${Number(v)} citas`, 'Cantidad']} />
                  <Bar dataKey="count" fill="#4F7A5A" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          )}
        </ChartCard>

        <ChartCard title="Ocupación por colaboradora">
          {charts && (
            <ResponsiveContainer width="100%" height={Math.max(160, charts.staffOccupancy.length * 30)}>
              <BarChart data={charts.staffOccupancy} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#1B221E' }} />
                <Tooltip formatter={(v) => `${Number(v)} %`} />
                <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                  {charts.staffOccupancy.map((s) => (
                    <Cell key={s.id} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Nuevas clientas por semana">
          {charts && (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={charts.newClients}>
                <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#6B7770' }} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11, fill: '#6B7770' }} />
                <Tooltip labelFormatter={(l) => `Semana del ${shortDate(String(l))}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="manual" name="Manual" stackId="a" fill="#A7D3B0" />
                <Bar dataKey="online" name="Online" stackId="a" fill="#3C7DD9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>
    </div>
  );
}

function ChartCard({ title, className = '', children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children ?? <div className="h-44 animate-pulse rounded-lg bg-bg" />}
    </div>
  );
}
