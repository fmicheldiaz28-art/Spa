import Link from 'next/link';
import { Brand } from '@/components/brand';

export const metadata = { title: 'Política de privacidad' };

/**
 * Texto base de la política (RNF-LEG-01). ⚠️ Borrador a validar con asesoría legal local antes
 * del lanzamiento (docs/02-requerimientos.md §6.10).
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <Brand tone="dark" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold">Política de privacidad</h1>
        <p className="text-muted">Versión 1.0 · Borrador pendiente de revisión legal.</p>
        <h2 className="pt-2 font-semibold">Qué datos usamos</h2>
        <p>Nombre, email y celular para gestionar tus reservas; y, si nos los indicas, alergias o preferencias para atenderte con seguridad.</p>
        <h2 className="pt-2 font-semibold">Para qué</h2>
        <p>Confirmar, recordarte y gestionar tus citas. Solo te enviaremos promociones si lo aceptas expresamente.</p>
        <h2 className="pt-2 font-semibold">Quién accede</h2>
        <p>
          Solo la administración del spa ve tus datos de contacto; la especialista que te atiende ve únicamente lo necesario para tu servicio. Cada acceso a datos
          sensibles queda registrado.
        </p>
        <h2 className="pt-2 font-semibold">Tus derechos</h2>
        <p>Puedes pedir ver, corregir o eliminar tus datos escribiéndonos. Conservamos el historial de citas de forma anónima para fines estadísticos.</p>
        <Link href="/reservar" className="inline-block pt-4 text-primary hover:underline">
          ← Volver a reservar
        </Link>
      </main>
    </div>
  );
}
