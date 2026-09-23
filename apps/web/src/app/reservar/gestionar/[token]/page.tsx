'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Brand } from '@/components/brand';
import { ReservationCard } from '@/components/booking/reservation-card';
import { Alert } from '@/components/ui';
import { type PublicAppointment, publicApi } from '@/lib/public-api';

/** Gestión de una reserva desde el enlace del email, sin iniciar sesión (docs/05-api.md §2.9). */
export default function ManageBookingPage() {
  const { token } = useParams<{ token: string }>();
  const [appointment, setAppointment] = useState<PublicAppointment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicApi<PublicAppointment>(`/booking/manage/${token}`)
      .then(setAppointment)
      .catch(() => setError('No encontramos esta reserva. Revisa que el enlace esté completo.'));
  }, [token]);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-xl items-center px-4">
          <Brand tone="dark" />
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
        <h1 className="text-xl font-semibold">Tu reserva</h1>
        {error && <Alert>{error}</Alert>}
        {appointment && <ReservationCard appointment={appointment} actionBase={`/booking/manage/${token}`} onChanged={setAppointment} />}
        <p className="text-center text-sm">
          <Link href="/reservar" className="text-primary hover:underline">
            Hacer otra reserva
          </Link>
        </p>
      </main>
    </div>
  );
}
