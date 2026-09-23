'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Brand } from '@/components/brand';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }, false);
      setSent(true);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError(p ? [p.title, p.detail].filter(Boolean).join('. ') : 'No se pudo enviar la solicitud');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Brand tone="dark" />
        {sent ? (
          <div className="mt-8">
            <MailCheck className="size-10 text-primary" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Revisa tu correo</h1>
            <p className="mt-2 text-sm text-muted">
              Si <strong className="text-text">{email}</strong> está registrado, te enviamos un enlace para crear una contraseña nueva. Vence en 30
              minutos.
            </p>
            <Link href="/login" className="mt-8 inline-block text-sm text-primary underline">
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-8 text-2xl font-semibold tracking-tight">Recupera tu contraseña</h1>
            <p className="mt-1 text-sm text-muted">Te enviaremos un enlace a tu email.</p>
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              {error && <Alert>{error}</Alert>}
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Button type="submit" className="w-full" disabled={submitting || !email}>
                {submitting ? 'Enviando…' : 'Enviar enlace'}
              </Button>
              <Link href="/login" className="block text-center text-sm text-muted hover:text-text">
                Volver
              </Link>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
