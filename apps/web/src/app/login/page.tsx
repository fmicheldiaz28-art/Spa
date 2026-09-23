'use client';

import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login, status, user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(homeFor(user));
  }, [status, user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const me = await login(email, password);
      router.replace(homeFor(me));
    } catch (err) {
      const problem = err instanceof ApiError ? err.problem : null;
      setError(problem ? [problem.title, problem.detail].filter(Boolean).join('. ') : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 lg:flex">
        <Brand />
        <div className="relative z-10 max-w-md">
          <p className="text-3xl font-semibold leading-tight text-white">Gestiona tu spa con calma.</p>
          <p className="mt-3 text-sidebar-fg">Agenda, clientas y reservas en un solo lugar, con cada cambio registrado.</p>
        </div>
        <div aria-hidden className="absolute -right-24 -bottom-24 size-96 rounded-full bg-sidebar-accent/10" />
        <div aria-hidden className="absolute right-24 bottom-40 size-40 rounded-full bg-accent/10" />
      </section>

      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Brand tone="dark" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Bienvenida de nuevo</h1>
          <p className="mt-1 text-sm text-muted">Ingresa con tu cuenta de NaturalSpa.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
            {error && <Alert>{error}</Alert>}
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
              />
            </Field>
            <Field label="Contraseña" htmlFor="password">
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-text"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <div className="-mt-2 text-right">
              <Link href="/recuperar" className="text-sm text-primary hover:underline">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !email || !password}>
              {submitting ? 'Ingresando…' : 'Iniciar sesión'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
