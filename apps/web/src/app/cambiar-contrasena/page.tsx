'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';

export default function ChangePasswordPage() {
  const { status, user, reload } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setErrors(['Las contraseñas nuevas no coinciden']);
    setErrors([]);
    setSubmitting(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const me = await reload();
      if (me) router.replace(homeFor(me));
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setErrors(p?.errors?.map((x) => x.message) ?? [p?.title ?? 'No se pudo cambiar la contraseña']);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Brand tone="dark" />
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Cambia tu contraseña</h1>
        <p className="mt-1 text-sm text-muted">
          {user?.mustChangePassword
            ? 'Por seguridad, debes definir una contraseña nueva antes de continuar.'
            : 'Define una contraseña nueva para tu cuenta.'}
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          {errors.length > 0 && (
            <Alert>
              <ul className="list-inside list-disc">
                {errors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Field label="Contraseña actual" htmlFor="current">
            <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Contraseña nueva" htmlFor="new">
            <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repite la contraseña nueva" htmlFor="confirm">
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <p className="text-xs text-muted">Mínimo 8 caracteres, con mayúscula, minúscula, número y símbolo.</p>
          <Button type="submit" className="w-full" disabled={submitting || !current || !next || !confirm}>
            {submitting ? 'Guardando…' : 'Guardar contraseña'}
          </Button>
        </form>
      </div>
    </main>
  );
}
