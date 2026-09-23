'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Brand } from '@/components/brand';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErrors(['Las contraseñas no coinciden']);
    setSubmitting(true);
    setErrors([]);
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: password }) }, false);
      setDone(true);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      if (p?.code === 'INVALID_RESET_TOKEN') setExpired(true);
      setErrors(p?.errors?.map((x) => x.message) ?? [[p?.title, p?.detail].filter(Boolean).join('. ') || 'No se pudo guardar']);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Brand tone="dark" />
        {done ? (
          <div className="mt-8">
            <h1 className="text-2xl font-semibold tracking-tight">Contraseña actualizada</h1>
            <p className="mt-2 text-sm text-muted">Por seguridad cerramos tus sesiones abiertas. Ingresa con tu contraseña nueva.</p>
            <Link href="/login" className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white">
              Iniciar sesión
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-8 text-2xl font-semibold tracking-tight">Crea una contraseña nueva</h1>
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              {errors.length > 0 && (
                <Alert>
                  <ul className="list-inside list-disc">
                    {errors.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  {expired && (
                    <Link href="/recuperar" className="mt-1 block underline">
                      Pedir un enlace nuevo
                    </Link>
                  )}
                </Alert>
              )}
              <Field label="Contraseña nueva" htmlFor="new">
                <Input id="new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Repítela" htmlFor="confirm">
                <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              <p className="text-xs text-muted">Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.</p>
              <Button type="submit" className="w-full" disabled={submitting || !password || !confirm}>
                {submitting ? 'Guardando…' : 'Guardar contraseña'}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
