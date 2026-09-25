'use client';

import { ArrowLeft, CalendarPlus, CheckCircle2, Clock, Search, Timer } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '@/components/brand';
import { MonthCalendar } from '@/components/booking/month-calendar';
import { WaitlistJoin } from '@/components/booking/waitlist-join';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatLongDay } from '@/lib/appointments';
import {
  clientSession,
  googleCalendarUrl,
  type PublicAppointment,
  publicApi,
  type PublicInfo,
  type PublicService,
  type PublicSlot,
} from '@/lib/public-api';
import { todayLocal } from '@/lib/schedule';
import { formatMoney } from '@/lib/types';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Hold {
  holdId: string;
  expiresAt: string;
  startAt: string;
  service: { id: string; name: string; durationMin: number; price: string };
  staff: { id: string; name: string };
}

const problemText = (err: unknown) => {
  const p = err instanceof ApiError ? err.problem : null;
  return [p?.title, p?.detail, ...(p?.code === 'VALIDATION_ERROR' ? (p.errors?.map((e) => e.message) ?? []) : [])].filter(Boolean).join('. ') || 'Algo salió mal, intenta de nuevo';
};

/** Reserva online en 6 pasos (docs/06-modulos.md M9, docs/09-ux-ui.md §15.9). */
export default function BookingPage() {
  const [step, setStep] = useState<Step>(1);
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [services, setServices] = useState<PublicService[] | null>(null);
  const [service, setService] = useState<PublicService | null>(null);
  const [staffId, setStaffId] = useState<string>('any');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [availableDays, setAvailableDays] = useState<Set<string> | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [booked, setBooked] = useState<PublicAppointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  useEffect(() => {
    void Promise.all([publicApi<PublicInfo>('/booking/info'), publicApi<PublicService[]>('/booking/catalog')])
      .then(([i, s]) => {
        setInfo(i);
        setServices(s);
        // Enlaces directos: aviso de lista de espera (/reservar?servicio=…&fecha=…&con=…) y
        // "Reservar de nuevo" desde Mis reservas (sin fecha: abre el calendario).
        const params = new URLSearchParams(window.location.search);
        const linked = s.find((x) => x.id === params.get('servicio'));
        if (linked) {
          const con = params.get('con');
          const linkedDate = params.get('fecha');
          setService(linked);
          setStaffId(con && linked.staff.some((x) => x.id === con) ? con : linked.staff.length === 1 ? linked.staff[0]!.id : 'any');
          if (linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate)) {
            setDate(linkedDate);
            setMonth(linkedDate.slice(0, 7));
            setStep(4);
          } else {
            setStep(3);
          }
        }
      })
      .catch((err: unknown) => setError(problemText(err)));
  }, []);

  useEffect(() => {
    if (!service || step !== 3) return;
    setAvailableDays(null);
    void publicApi<{ days: { date: string; available: boolean }[] }>(`/availability/days?serviceId=${service.id}&staffId=${staffId}&month=${month}`)
      .then((r) => setAvailableDays(new Set(r.days.filter((d) => d.available).map((d) => d.date))))
      .catch(() => setAvailableDays(new Set()));
  }, [service, staffId, month, step]);

  useEffect(() => {
    if (!service || !date || step !== 4) return;
    setSlots(null);
    void publicApi<{ slots: PublicSlot[] }>(`/availability/slots?serviceId=${service.id}&staffId=${staffId}&date=${date}`)
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  }, [service, staffId, date, step]);

  // Libera la retención si la clienta abandona la página.
  useEffect(() => {
    if (!hold) return;
    const release = () => navigator.sendBeacon?.(`/api/v1/public/booking/holds/${hold.holdId}/release`);
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [hold]);

  async function pickSlot(slot: PublicSlot) {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      if (hold) await publicApi(`/booking/holds/${hold.holdId}`, { method: 'DELETE' }).catch(() => undefined);
      const h = await publicApi<Hold>('/booking/holds', {
        method: 'POST',
        body: JSON.stringify({ serviceId: service.id, staffId, startAt: slot.startAt }),
      });
      setHold(h);
      setStep(5);
    } catch (err) {
      setError(problemText(err));
      setSlots(null);
      void publicApi<{ slots: PublicSlot[] }>(`/availability/slots?serviceId=${service.id}&staffId=${staffId}&date=${date}`).then((r) => setSlots(r.slots));
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    setError(null);
    if (step === 5 && hold) {
      void publicApi(`/booking/holds/${hold.holdId}`, { method: 'DELETE' }).catch(() => undefined);
      setHold(null);
    }
    if (waitlistOpen) return setWaitlistOpen(false);
    setStep((s) => Math.max(1, s - 1) as Step);
  };

  const today = todayLocal();
  const maxDate = useMemo(() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (info?.policy.maxAdvanceDays ?? 60));
    return d.toISOString().slice(0, 10);
  }, [today, info]);
  const maxMonth = useMemo(() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (info?.policy.maxAdvanceDays ?? 60));
    return d.toISOString().slice(0, 7);
  }, [today, info]);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
          {step > 1 && step < 7 ? (
            <button onClick={back} className="rounded-lg p-1.5 hover:bg-bg" aria-label="Volver">
              <ArrowLeft className="size-5" />
            </button>
          ) : null}
          <Brand tone="dark" />
          <Link href="/mi-cuenta" className="ml-auto text-sm text-primary hover:underline">
            Mis reservas
          </Link>
        </div>
        {step < 7 && (
          <div className="mx-auto flex max-w-xl gap-1.5 px-4 pb-3" aria-label={`Paso ${step} de 6`}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-xl px-4 py-6">
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}

        {step === 1 && (
          <ServiceStep
            services={services}
            onPick={(s) => {
              setService(s);
              setStaffId(s.staff.length === 1 ? s.staff[0]!.id : 'any');
              setDate(null);
              setStep(s.staff.length === 1 ? 3 : 2);
            }}
          />
        )}

        {step === 2 && service && (
          <section>
            <h1 className="text-xl font-semibold">¿Con quién?</h1>
            <p className="mt-1 text-sm text-muted">{service.name}</p>
            <div className="mt-5 space-y-2">
              {[{ id: 'any', name: 'Sin preferencia', color: '#E4E8E3', note: 'Te asignamos a la primera disponible' }, ...service.staff.map((s) => ({ ...s, note: '' }))].map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setStaffId(s.id);
                    setStep(3);
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl border bg-surface p-4 text-left transition hover:border-primary ${staffId === s.id ? 'border-primary' : 'border-border'}`}
                >
                  <span className="grid size-11 place-items-center rounded-full text-sm font-semibold" style={{ backgroundColor: s.color }}>
                    {s.id === 'any' ? '★' : s.name[0]}
                  </span>
                  <span>
                    <span className="block font-medium">{s.name}</span>
                    {s.note && <span className="text-sm text-muted">{s.note}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {waitlistOpen && service && (step === 3 || step === 4) && (
          <WaitlistJoin
            service={service}
            staffId={staffId}
            initialDate={step === 4 ? date : null}
            minDate={today}
            maxDate={maxDate}
            onClose={() => setWaitlistOpen(false)}
          />
        )}

        {step === 3 && service && !waitlistOpen && (
          <section>
            <h1 className="text-xl font-semibold">Elige el día</h1>
            <p className="mt-1 text-sm text-muted">
              {service.name}
              {staffId !== 'any' && ` · ${service.staff.find((s) => s.id === staffId)?.name}`}
            </p>
            <div className="mt-5">
              <MonthCalendar
                month={month}
                available={availableDays}
                selected={date}
                onMonth={setMonth}
                minMonth={today.slice(0, 7)}
                maxMonth={maxMonth}
                onSelect={(d) => {
                  setDate(d);
                  setStep(4);
                }}
              />
            </div>
            <button onClick={() => setWaitlistOpen(true)} className="mt-4 w-full text-center text-sm text-primary hover:underline">
              ¿No hay lugar el día que quieres? Anótate en la lista de espera
            </button>
          </section>
        )}

        {step === 4 && service && date && !waitlistOpen && (
          <section>
            <h1 className="text-xl font-semibold first-letter:uppercase">{formatLongDay(date)}</h1>
            <p className="mt-1 text-sm text-muted">Elige la hora · {service.durationMin} min</p>
            <div className="mt-5 space-y-4">
              {!slots && <p className="text-sm text-muted">Buscando horarios…</p>}
              {slots?.length === 0 && (
                <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
                  <p className="text-muted">Ya no quedan horarios ese día.</p>
                  <Button className="mt-3 w-full" variant="secondary" onClick={() => setWaitlistOpen(true)}>
                    Avísame si se libera un horario
                  </Button>
                </div>
              )}
              {!!slots?.length && (
                <button onClick={() => setWaitlistOpen(true)} className="text-sm text-primary hover:underline">
                  ¿Ninguna hora te sirve? Avísame si se libera otra
                </button>
              )}
              {slots &&
                [
                  { label: 'Mañana', items: slots.filter((s) => s.time < '13:00') },
                  { label: 'Tarde', items: slots.filter((s) => s.time >= '13:00') },
                ]
                  .filter((g) => g.items.length)
                  .map((g) => (
                    <div key={g.label}>
                      <p className="mb-2 text-sm font-medium text-muted">{g.label}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {g.items.map((s) => (
                          <button
                            key={s.startAt}
                            disabled={busy}
                            onClick={() => void pickSlot(s)}
                            className="rounded-xl border border-border bg-surface py-2.5 text-sm font-medium tabular-nums transition hover:border-primary hover:bg-primary/5"
                          >
                            {s.time}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
            </div>
          </section>
        )}

        {step === 5 && hold && (
          <DetailsStep
            hold={hold}
            info={info}
            onExpired={() => {
              setHold(null);
              setError('El horario se liberó porque pasaron los minutos de reserva. Elige nuevamente.');
              setStep(4);
            }}
            onBooked={(a) => {
              setBooked(a);
              setHold(null);
              setStep(7);
            }}
          />
        )}

        {step === 7 && booked && <SuccessStep booked={booked} info={info} />}
      </main>
    </div>
  );
}

function ServiceStep({ services, onPick }: { services: PublicService[] | null; onPick: (s: PublicService) => void }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  if (!services) return <div className="h-64 animate-pulse rounded-2xl bg-surface" />;
  const categories = [...new Map(services.map((s) => [s.category.id, s.category])).values()];
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const visible = services.filter((s) => (!category || s.category.id === category) && (!q || norm(s.name).includes(norm(q))));

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Reserva tu cita</h1>
      <p className="mt-1 text-sm text-muted">Elige un servicio. Verás solo horarios realmente disponibles.</p>
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar servicio" className="rounded-xl pl-9" aria-label="Buscar servicio" />
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {[{ id: null, name: 'Todos' }, ...categories].map((c) => (
          <button
            key={c.id ?? 'all'}
            onClick={() => setCategory(c.id)}
            className={`rounded-full border px-3 py-1.5 text-sm whitespace-nowrap ${category === c.id ? 'border-primary bg-primary text-white' : 'border-border bg-surface'}`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <ul className="mt-4 space-y-3">
        {visible.map((s) => (
          <li key={s.id}>
            <button onClick={() => onPick(s)} className="flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-primary hover:shadow-sm">
              <span className="grid size-14 shrink-0 place-items-center rounded-xl text-xl" style={{ backgroundColor: s.category.color ?? '#E4E8E3' }} aria-hidden>
                🌿
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.name}</span>
                {s.description && <span className="line-clamp-2 text-sm text-muted">{s.description}</span>}
                <span className="mt-1 flex items-center gap-3 text-sm text-muted">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3.5" /> {s.durationMin} min
                  </span>
                  <span className="font-medium text-text">{formatMoney(s.price)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 && <p className="py-8 text-center text-sm text-muted">No encontramos ese servicio.</p>}
      </ul>
    </section>
  );
}

function Countdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  const expired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setLeft(ms);
      if (ms === 0 && !expired.current) {
        expired.current = true;
        onExpired();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpired]);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span className={`inline-flex items-center gap-1 text-sm tabular-nums ${left < 120_000 ? 'text-danger' : 'text-muted'}`}>
      <Timer className="size-4" /> Reservamos tu horario por {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

function DetailsStep({ hold, info, onExpired, onBooked }: { hold: Hold; info: PublicInfo | null; onExpired: () => void; onBooked: (a: PublicAppointment) => void }) {
  const [token, setToken] = useState<string | null>(() => clientSession.get());
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicApi('/booking/verify/send', { method: 'POST', body: JSON.stringify({ email }) });
      setCodeSent(true);
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await publicApi<{ token: string; client: { firstName: string; lastName: string } | null }>('/booking/verify/check', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });
      clientSession.set(r.token);
      setToken(r.token);
      if (r.client) {
        setFirstName(r.client.firstName);
        setLastName(r.client.lastName);
      }
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await publicApi<PublicAppointment>('/booking/confirm', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: JSON.stringify({ holdId: hold.holdId, token, firstName, lastName, phone, notes: notes || null, privacyConsent: privacy, marketingOptIn: marketing }),
      });
      onBooked(a);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      if (p?.code === 'UNVERIFIED') {
        clientSession.clear();
        setToken(null);
      }
      if (p?.code === 'HOLD_EXPIRED' || p?.code === 'SLOT_TAKEN') return onExpired();
      setError(problemText(err));
      key.current = crypto.randomUUID();
    } finally {
      setBusy(false);
    }
  }

  const startLocal = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' }).format(new Date(hold.startAt));

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <p className="font-medium">{hold.service.name}</p>
        <p className="text-sm text-muted first-letter:uppercase">
          {startLocal} · con {hold.staff.name}
        </p>
        <p className="mt-1 text-sm font-medium">{formatMoney(hold.service.price)} · pago en el spa</p>
        <div className="mt-2">
          <Countdown expiresAt={hold.expiresAt} onExpired={onExpired} />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {!token ? (
        codeSent ? (
          <form onSubmit={checkCode} className="space-y-4">
            <h1 className="text-xl font-semibold">Revisa tu email</h1>
            <p className="text-sm text-muted">
              Enviamos un código de 6 dígitos a <strong className="text-text">{email}</strong>.
            </p>
            <Field label="Código" htmlFor="code">
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="text-center text-2xl tracking-[0.5em]"
                autoFocus
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              Verificar
            </Button>
            <button type="button" onClick={() => setCodeSent(false)} className="w-full text-sm text-muted hover:text-text">
              Usar otro email
            </button>
          </form>
        ) : (
          <form onSubmit={sendCode} className="space-y-4">
            <h1 className="text-xl font-semibold">Tus datos</h1>
            <p className="text-sm text-muted">Te enviaremos un código para confirmar que el email es tuyo. No necesitas contraseña.</p>
            <Field label="Email" htmlFor="bemail">
              <Input id="bemail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Button type="submit" className="w-full" disabled={busy || !email.includes('@')}>
              Enviar código
            </Button>
          </form>
        )
      ) : (
        <form onSubmit={confirm} className="space-y-4">
          <h1 className="text-xl font-semibold">Confirma tu reserva</h1>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *" htmlFor="bfn">
              <Input id="bfn" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </Field>
            <Field label="Apellido" htmlFor="bln">
              <Input id="bln" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </div>
          <Field label="Celular (WhatsApp) *" htmlFor="bph">
            <Input id="bph" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="70012345" required />
          </Field>
          <Field label="¿Algo que debamos saber?" htmlFor="bnotes" hint="Alergias, preferencias, si es tu primera vez…">
            <Input id="bnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-primary)]" required />
            <span>
              Acepto la{' '}
              <Link href="/reservar/privacidad" target="_blank" className="text-primary underline">
                política de privacidad
              </Link>{' '}
              *
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
            Quiero recibir promociones de {info?.name ?? 'NaturalSpa'}
          </label>
          <p className="text-xs text-muted">Puedes cancelar o reagendar hasta {info?.policy.cancelUntilHours ?? 12} horas antes.</p>
          <Button type="submit" className="w-full" disabled={busy || !privacy || firstName.trim().length < 2 || phone.trim().length < 7}>
            {busy ? 'Confirmando…' : 'Confirmar reserva'}
          </Button>
        </form>
      )}
    </section>
  );
}

function SuccessStep({ booked, info }: { booked: PublicAppointment; info: PublicInfo | null }) {
  const place = [info?.name, info?.address, info?.city].filter(Boolean).join(', ');
  const whatsapp = info?.phone?.replace(/\D/g, '');
  return (
    <section className="text-center">
      <CheckCircle2 className="mx-auto size-14 text-success" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold">{booked.status === 'CONFIRMADA' ? '¡Reserva confirmada!' : '¡Reserva recibida!'}</h1>
      <p className="mt-1 text-sm text-muted">Te enviamos los detalles a tu email.</p>
      <div className="mt-6 space-y-1 rounded-2xl border border-border bg-surface p-5 text-left text-sm">
        <p className="text-xs text-muted">{booked.code}</p>
        <p className="text-base font-medium">{booked.service.name}</p>
        <p className="first-letter:uppercase">
          {formatLongDay(booked.localDate)} · {booked.localTime}
        </p>
        <p>Con {booked.staff.name}</p>
        <p className="font-medium">{formatMoney(booked.total)} · pago en el spa</p>
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <a href={googleCalendarUrl(booked, place || 'NaturalSpa')} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm font-medium">
          <CalendarPlus className="size-4" /> Agregar a mi calendario
        </a>
        {booked.manageToken && (
          <Link href={`/reservar/gestionar/${booked.manageToken}`} className="inline-flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-medium text-white">
            Ver o cambiar mi reserva
          </Link>
        )}
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
            ¿Dudas? Escríbenos por WhatsApp
          </a>
        )}
      </div>
    </section>
  );
}
