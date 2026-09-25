'use client';

import { BellRing, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatLongDay } from '@/lib/appointments';
import { clientSession, publicApi, type PublicService, type PublicWaitlistEntry } from '@/lib/public-api';

const WINDOWS = [
  { key: 'any', label: 'Cualquier hora', from: null, to: null },
  { key: 'morning', label: 'Mañana', from: '00:00', to: '13:00' },
  { key: 'afternoon', label: 'Tarde', from: '13:00', to: '23:59' },
] as const;

const problemText = (err: unknown) => {
  const p = err instanceof ApiError ? err.problem : null;
  return [p?.title, p?.detail, ...(p?.code === 'VALIDATION_ERROR' ? (p.errors?.map((e) => e.message) ?? []) : [])].filter(Boolean).join('. ') || 'Algo salió mal, intenta de nuevo';
};

/**
 * Lista de espera pública (Fase 2): la clienta se anota para un día sin horarios que le sirvan
 * y recibe un email en cuanto se libera uno. Verifica el email igual que al reservar.
 */
export function WaitlistJoin({
  service,
  staffId,
  initialDate,
  minDate,
  maxDate,
  onClose,
}: {
  service: PublicService;
  staffId: string;
  initialDate: string | null;
  minDate: string;
  maxDate: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate ?? '');
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]['key']>('any');
  const [token, setToken] = useState<string | null>(() => clientSession.get());
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [done, setDone] = useState<PublicWaitlistEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const staffName = staffId !== 'any' ? service.staff.find((s) => s.id === staffId)?.name : null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      if (p?.code === 'UNVERIFIED') {
        clientSession.clear();
        setToken(null);
      }
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await publicApi('/booking/verify/send', { method: 'POST', body: JSON.stringify({ email }) });
      setCodeSent(true);
    });
  };

  const checkCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
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
    });
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const w = WINDOWS.find((x) => x.key === windowKey)!;
    void run(async () => {
      setDone(
        await publicApi<PublicWaitlistEntry>('/waitlist', {
          method: 'POST',
          clientToken: token,
          body: JSON.stringify({
            serviceId: service.id,
            staffId: staffId === 'any' ? null : staffId,
            date,
            timeFrom: w.from,
            timeTo: w.to,
            firstName,
            lastName,
            phone,
            privacyConsent: privacy,
          }),
        }),
      );
    });
  };

  if (done) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h2 className="mt-3 text-lg font-semibold">Estás en la lista de espera</h2>
        <p className="mt-1 text-sm text-muted">
          Te escribiremos en cuanto se libere un horario para {service.name} el <span className="first-letter:uppercase">{formatLongDay(done.date)}</span>. Reserva rápido: el primero en
          confirmar se lo queda.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Link href="/mi-cuenta" className="text-sm text-primary hover:underline">
            Ver mis reservas y esperas
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Buscar otro día
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-semibold">Avísame si se libera un horario</h2>
          <p className="mt-0.5 text-sm text-muted">
            {service.name}
            {staffName && ` con ${staffName}`}
          </p>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}

      <Field label="Día" htmlFor="wl-date">
        <Input id="wl-date" type="date" min={minDate} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">¿A qué hora te sirve?</legend>
        <div className="grid grid-cols-3 gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              className={`rounded-xl border px-2 py-2 text-sm ${windowKey === w.key ? 'border-primary bg-primary/5 font-medium' : 'border-border'}`}
              aria-pressed={windowKey === w.key}
            >
              {w.label}
            </button>
          ))}
        </div>
      </fieldset>

      {!token ? (
        !codeSent ? (
          <form onSubmit={sendCode} className="space-y-3">
            <Field label="Tu email" htmlFor="wl-email" hint="Te enviaremos un código para confirmar que es tuyo.">
              <Input id="wl-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={busy || !email || !date}>
              Continuar
            </Button>
          </form>
        ) : (
          <form onSubmit={checkCode} className="space-y-3">
            <Field label="Código de 6 dígitos" htmlFor="wl-code" hint={`Lo enviamos a ${email}.`}>
              <Input id="wl-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              Verificar
            </Button>
          </form>
        )
      ) : (
        <form onSubmit={join} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" htmlFor="wl-first">
              <Input id="wl-first" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Apellido" htmlFor="wl-last">
              <Input id="wl-last" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
          </div>
          <Field label="Celular" htmlFor="wl-phone">
            <Input id="wl-phone" type="tel" autoComplete="tel" placeholder="+591 7…" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
            <span>
              Acepto la{' '}
              <Link href="/reservar/privacidad" target="_blank" className="text-primary underline">
                política de privacidad
              </Link>
            </span>
          </label>
          <Button type="submit" className="w-full" disabled={busy || !date || !firstName || !phone || !privacy}>
            {busy ? 'Anotando…' : 'Anotarme en la lista de espera'}
          </Button>
        </form>
      )}
      <button type="button" className="w-full text-sm text-muted hover:text-text" onClick={onClose}>
        Volver
      </button>
    </section>
  );
}
