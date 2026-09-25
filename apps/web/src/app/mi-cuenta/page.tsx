'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { ReservationCard } from '@/components/booking/reservation-card';
import { Alert, Button, EmptyState, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatLongDay } from '@/lib/appointments';
import { clientSession, type PublicAppointment, publicApi, type PublicWaitlistEntry } from '@/lib/public-api';

const WAITLIST_STATUS: Record<PublicWaitlistEntry['status'], string> = {
  ACTIVA: 'Esperando un horario',
  NOTIFICADA: 'Te avisamos: ¡hay lugar!',
  CONVERTIDA: 'Reservada',
  VENCIDA: 'Venció',
  CANCELADA: 'Cancelada',
};

/** "Mis reservas": acceso con email verificado por código, sin contraseña (docs/06-modulos.md M9). */
export default function MyAccountPage() {
  const [token, setToken] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<PublicAppointment[] | null>(null);
  const [waitlist, setWaitlist] = useState<PublicWaitlistEntry[]>([]);
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (t: string) => {
    try {
      const [a, w] = await Promise.all([
        publicApi<PublicAppointment[]>('/me/appointments', { clientToken: t }),
        publicApi<PublicWaitlistEntry[]>('/me/waitlist', { clientToken: t }).catch(() => []),
      ]);
      setAppointments(a);
      setWaitlist(w);
    } catch {
      clientSession.clear();
      setToken(null);
    }
  }, []);

  useEffect(() => {
    const t = clientSession.get();
    if (t) {
      setToken(t);
      void load(t);
    }
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicApi('/booking/verify/send', { method: 'POST', body: JSON.stringify({ email }) });
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? [err.problem.title, err.problem.detail].filter(Boolean).join('. ') : 'No se pudo enviar el código');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await publicApi<{ token: string }>('/booking/verify/check', { method: 'POST', body: JSON.stringify({ email, code }) });
      clientSession.set(r.token);
      setToken(r.token);
      await load(r.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Código inválido');
    } finally {
      setBusy(false);
    }
  }

  async function leaveWaitlist(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      const updated = await publicApi<PublicWaitlistEntry>(`/me/waitlist/${id}/cancel`, { method: 'POST', clientToken: token });
      setWaitlist((list) => list.map((w) => (w.id === id ? { ...w, status: updated.status } : w)));
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'No se pudo salir de la lista');
    } finally {
      setBusy(false);
    }
  }

  const openWaitlist = waitlist.filter((w) => w.status === 'ACTIVA' || w.status === 'NOTIFICADA');
  const now = new Date();
  const upcoming = (appointments ?? []).filter((a) => new Date(a.startAt) > now).reverse();
  const past = (appointments ?? []).filter((a) => new Date(a.startAt) <= now);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-xl items-center px-4">
          <Brand tone="dark" />
          {token && (
            <button
              className="ml-auto text-sm text-muted hover:text-text"
              onClick={() => {
                clientSession.clear();
                setToken(null);
                setAppointments(null);
              }}
            >
              Salir
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mis reservas</h1>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}

        {!token ? (
          codeSent ? (
            <form onSubmit={verify} className="mt-6 space-y-4">
              <p className="text-sm text-muted">
                Ingresa el código que enviamos a <strong className="text-text">{email}</strong>.
              </p>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-2xl tracking-[0.5em]" aria-label="Código" autoFocus />
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                Entrar
              </Button>
            </form>
          ) : (
            <form onSubmit={send} className="mt-6 space-y-4">
              <p className="text-sm text-muted">Te enviaremos un código a tu email para ver tus reservas. No necesitas contraseña.</p>
              <Field label="Email" htmlFor="memail">
                <Input id="memail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Button type="submit" className="w-full" disabled={busy || !email.includes('@')}>
                Enviar código
              </Button>
            </form>
          )
        ) : (
          <div className="mt-6 space-y-6">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted uppercase">Próximas</h2>
              {appointments && upcoming.length === 0 && <EmptyState title="No tienes reservas próximas" />}
              {upcoming.map((a) => (
                <ReservationCard
                  key={a.id}
                  appointment={a}
                  actionBase={`/me/appointments/${a.id}`}
                  clientToken={token}
                  onChanged={(u) => setAppointments((list) => list?.map((x) => (x.id === u.id ? u : x)) ?? null)}
                />
              ))}
            </section>
            {openWaitlist.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted uppercase">En lista de espera</h2>
                {openWaitlist.map((w) => (
                  <article key={w.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
                    <div className="text-sm">
                      <p className="font-medium">{w.service.name}</p>
                      <p className="first-letter:uppercase">
                        {formatLongDay(w.date)}
                        {w.timeFrom && ` · ${w.timeFrom < '13:00' ? 'mañana' : 'tarde'}`}
                        {w.staff && ` · con ${w.staff.name}`}
                      </p>
                      <p className={`mt-1 ${w.status === 'NOTIFICADA' ? 'font-medium text-success' : 'text-muted'}`}>{WAITLIST_STATUS[w.status]}</p>
                      {w.status === 'NOTIFICADA' && (
                        <Link href={`/reservar?servicio=${w.service.id}&fecha=${w.date}${w.staff ? `&con=${w.staff.id}` : ''}`} className="mt-1 inline-block text-primary hover:underline">
                          Reservar ahora →
                        </Link>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void leaveWaitlist(w.id)}>
                      Salir
                    </Button>
                  </article>
                ))}
              </section>
            )}
            {past.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted uppercase">Historial</h2>
                {past.map((a) => (
                  <div key={a.id}>
                    <ReservationCard appointment={a} actionBase={`/me/appointments/${a.id}`} clientToken={token} onChanged={() => undefined} />
                    {a.status === 'COMPLETADA' && (
                      <Link href={`/reservar?servicio=${a.service.id}&con=${a.staff.id}`} className="mt-1 inline-block px-1 text-sm text-primary hover:underline">
                        Reservar de nuevo
                      </Link>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        <p className="mt-8 text-center">
          <Link href="/reservar" className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-white">
            Reservar una cita
          </Link>
        </p>
      </main>
    </div>
  );
}
