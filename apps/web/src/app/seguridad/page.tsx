'use client';

import { CheckCircle2, Copy, Download, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { PushToggle } from '@/components/push-toggle';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
}

const problemText = (err: unknown, fallback: string) => {
  const p = err instanceof ApiError ? err.problem : null;
  return p ? [p.title, p.detail].filter(Boolean).join('. ') : fallback;
};

/**
 * Verificación en dos pasos (docs/11-seguridad-auditoria.md §30). Fuera del layout del backoffice:
 * si la política la exige, es la única pantalla disponible hasta completarla.
 */
export default function SecurityPage() {
  const { status, user, reload } = useAuth();
  const router = useRouter();
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<MfaStatus>('/auth/mfa').then(setMfa), []);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    if (status === 'authenticated' && user?.mustChangePassword) router.replace('/cambiar-contrasena');
    if (status === 'authenticated') void load().catch((err: unknown) => setError(problemText(err, 'No se pudo cargar')));
  }, [status, user, router, load]);

  async function done() {
    const me = await reload();
    await load();
    if (me && user?.mfaSetupRequired) router.replace(homeFor(me));
  }

  return (
    <main className="flex min-h-dvh justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Brand tone="dark" />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Verificación en dos pasos</h1>
        <p className="mt-1 text-sm text-muted">
          Además de tu contraseña, al ingresar te pediremos un código de tu celular. Así nadie puede entrar a tu cuenta aunque conozca tu contraseña.
        </p>
        {user?.mfaSetupRequired && (
          <div className="mt-4">
            <Alert tone="warning">Tu rol requiere la verificación en dos pasos. Configúrala para continuar.</Alert>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}

        {mfa && !mfa.enabled && <Setup onDone={done} />}
        {mfa?.enabled && <Enabled status={mfa} onChanged={done} />}

        {!user?.mfaSetupRequired && (
          <div className="mt-8">
            <PushToggle />
          </div>
        )}

        {!user?.mfaSetupRequired && (
          <p className="mt-8 text-center text-sm">
            <Link href={user ? homeFor(user) : '/login'} className="text-primary hover:underline">
              ← Volver
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

function Setup({ onDone }: { onDone: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ otpauthUri: string; secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ otpauthUri: string; secret: string }>('/auth/mfa/setup', { method: 'POST' });
      const qr = await QRCode.toString(r.otpauthUri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      setSetup({ ...r, qr });
    } catch (err) {
      setError(problemText(err, 'No se pudo generar el código'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setRecovery(r.recoveryCodes);
    } catch (err) {
      setError(problemText(err, 'No se pudo activar'));
    } finally {
      setBusy(false);
    }
  }

  if (recovery) return <RecoveryCodes codes={recovery} onDone={onDone} />;

  return (
    <div className="mt-6 space-y-5">
      {error && <Alert>{error}</Alert>}
      {!setup ? (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-medium">Necesitas una app de autenticación</p>
              <p className="mt-1 text-muted">Google Authenticator o Microsoft Authenticator (gratis en tu tienda de apps).</p>
            </div>
          </div>
          <Button className="mt-4 w-full" onClick={() => void start()} disabled={busy}>
            {busy ? 'Generando…' : 'Configurar'}
          </Button>
        </div>
      ) : (
        <form onSubmit={confirm} className="space-y-5 rounded-xl border border-border bg-surface p-5">
          <div>
            <p className="text-sm font-medium">1. Escanea este código con la app</p>
            {/* SVG generado localmente por la librería qrcode a partir de la URI otpauth (no hay contenido externo). */}
            <div className="mx-auto mt-3 size-48 rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qr }} aria-label="Código QR para la app de autenticación" role="img" />
            <p className="mt-3 text-xs text-muted">¿No puedes escanear? Ingresa esta clave en la app:</p>
            <p className="mt-1 rounded-lg bg-bg px-3 py-2 text-center font-mono text-sm tracking-wider break-all select-all">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
            <a href={setup.otpauthUri} className="mt-2 block text-center text-xs text-primary hover:underline sm:hidden">
              Abrir en la app de este celular
            </a>
          </div>
          <Field label="2. Escribe el código de 6 dígitos que muestra la app" htmlFor="code">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="text-center text-lg tracking-widest tabular-nums"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? 'Verificando…' : 'Activar'}
          </Button>
        </form>
      )}
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const text = `Códigos de recuperación de NaturalSpa (cada uno sirve una sola vez):\n\n${codes.join('\n')}\n`;

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'naturalspa-codigos-recuperacion.txt' });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6 space-y-4 rounded-xl border border-border bg-surface p-5">
      <p className="flex items-center gap-2 font-medium text-success">
        <CheckCircle2 className="size-5" /> Verificación en dos pasos activada
      </p>
      <p className="text-sm">
        Guarda estos <strong>códigos de recuperación</strong> en un lugar seguro. Si pierdes el celular, cada uno te permite ingresar una vez. No los volveremos a mostrar.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-bg p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          <Copy className="size-4" /> {copied ? 'Copiados' : 'Copiar'}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={download}>
          <Download className="size-4" /> Descargar
        </Button>
      </div>
      <Button className="w-full" onClick={() => void onDone()}>
        Ya los guardé, continuar
      </Button>
    </div>
  );
}

function Enabled({ status, onChanged }: { status: MfaStatus; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password, code: code.trim() }) });
      await onChanged();
    } catch (err) {
      setError(problemText(err, 'No se pudo desactivar'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <div>
          <p className="font-medium">Activa{status.enabledAt ? ` desde el ${formatDateTime(status.enabledAt)}` : ''}</p>
          <p className="mt-1 text-muted">
            Te quedan {status.recoveryCodesLeft} códigos de recuperación.{status.recoveryCodesLeft <= 2 && ' Si se te acaban, desactívala y vuelve a configurarla para obtener nuevos.'}
          </p>
        </div>
      </div>
      {status.required ? (
        <p className="text-sm text-muted">Tu rol requiere la verificación en dos pasos. Si cambiaste de celular, pide a otra administradora que te la reinicie desde Usuarios.</p>
      ) : !open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Desactivar
        </Button>
      ) : (
        <form onSubmit={disable} className="space-y-4 rounded-xl border border-border bg-surface p-5">
          {error && <Alert>{error}</Alert>}
          <Field label="Contraseña" htmlFor="pw">
            <Input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Código de la app (o de recuperación)" htmlFor="dcode">
            <Input id="dcode" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={busy || !password || code.trim().length < 6}>
              Desactivar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
