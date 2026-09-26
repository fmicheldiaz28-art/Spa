'use client';

import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

type State = 'loading' | 'unsupported' | 'disabled' | 'denied' | 'off' | 'on';

function toKey(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** El service worker solo se registra en producción (ver service-worker.tsx). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ?? null;
}

/**
 * Activar o desactivar las notificaciones push en este dispositivo (Fase 2). En iPhone requiere
 * tener la app instalada en la pantalla de inicio (iOS 16.4+).
 */
export function PushToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!('Notification' in window) || !('PushManager' in window)) return setState('unsupported');
      const cfg = await api<{ enabled: boolean; publicKey: string | null }>('/push/config').catch(() => null);
      if (!cfg?.enabled || !cfg.publicKey) return setState('disabled');
      setPublicKey(cfg.publicKey);
      const reg = await registration();
      if (!reg) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      setState((await reg.pushManager.getSubscription()) ? 'on' : 'off');
    })();
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied');
      const reg = await registration();
      if (!reg || !publicKey) return setState('unsupported');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
      const json = sub.toJSON();
      await api('/push/subscriptions', { method: 'POST', body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
      setState('on');
      const r = await api<{ sent: number }>('/push/test', { method: 'POST' });
      setMessage({ tone: 'success', text: r.sent ? 'Listo: te enviamos una notificación de prueba.' : 'Activadas.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.problem.title : 'No se pudieron activar las notificaciones' });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'disabled') return null;
  if (compact && state !== 'off') return null; // en "Mi día" solo se ofrece si falta activarlas

  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <div className="flex items-start gap-3">
        {state === 'on' ? <Bell className="mt-0.5 size-5 shrink-0 text-primary" /> : <BellOff className="mt-0.5 size-5 shrink-0 text-muted" />}
        <div className="flex-1">
          <p className="font-medium">Avisos en este celular</p>
          <p className="mt-0.5 text-muted">
            {state === 'on' && 'Te avisamos cuando te asignan, mueven o cancelan una cita.'}
            {state === 'off' && 'Recibe un aviso cuando te asignen, muevan o cancelen una cita, aunque la app esté cerrada.'}
            {state === 'denied' && 'Bloqueaste las notificaciones para este sitio. Actívalas en la configuración del navegador.'}
            {state === 'unsupported' && 'Instala la app en tu celular (Compartir → Agregar a inicio) para recibir avisos.'}
          </p>
          {message && (
            <div className="mt-2">
              <Alert tone={message.tone}>{message.text}</Alert>
            </div>
          )}
        </div>
        {state === 'off' && (
          <Button size="sm" onClick={() => void enable()} disabled={busy}>
            Activar
          </Button>
        )}
        {state === 'on' && (
          <Button size="sm" variant="ghost" onClick={() => void disable()} disabled={busy}>
            Desactivar
          </Button>
        )}
      </div>
    </div>
  );
}
