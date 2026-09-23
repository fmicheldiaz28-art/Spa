'use client';

import { useEffect, useRef, useState } from 'react';
import { getAccessToken, refreshSession } from './api';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Actualizaciones en tiempo real de la agenda (RF-AGE-16) vía Server-Sent Events.
 * Se usa fetch (y no EventSource) para enviar el access token en el header. El servidor cierra el
 * stream cuando vence el token; aquí se renueva y se reconecta con espera creciente.
 * `onChange` se llama con los eventos agrupados (300 ms) para no recargar de más.
 */
export function useLiveUpdates(onChange: () => void, enabled = true): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const fire = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => callback.current(), 300);
    };

    async function connect() {
      while (!stopped) {
        controller = new AbortController();
        try {
          let token = getAccessToken();
          if (!token && (await refreshSession())) token = getAccessToken();
          const res = await fetch('/api/v1/events', {
            headers: { Accept: 'text/event-stream', ...(token && { Authorization: `Bearer ${token}` }) },
            signal: controller.signal,
            cache: 'no-store',
          });
          if (res.status === 401) {
            await refreshSession();
            throw new Error('unauthorized');
          }
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          setStatus('live');
          if (attempt > 0) fire(); // al reconectar, puede haberse perdido algún evento
          attempt = 0;

          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            const messages = buffer.split('\n\n');
            buffer = messages.pop() ?? '';
            for (const msg of messages) {
              const event = /^event: (.+)$/m.exec(msg)?.[1];
              if (event && event !== 'ping') fire();
            }
          }
        } catch {
          if (stopped) return;
        }
        if (stopped) return;
        setStatus('offline');
        attempt += 1;
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
        setStatus('connecting');
      }
    }

    void connect();
    return () => {
      stopped = true;
      clearTimeout(debounce);
      controller?.abort();
    };
  }, [enabled]);

  return status;
}

export function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === 'live' ? 'En vivo' : status === 'connecting' ? 'Conectando…' : 'Sin conexión en vivo';
  const color = status === 'live' ? 'bg-success' : status === 'connecting' ? 'bg-warning' : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={label} aria-live="polite">
      <span className={`size-2 rounded-full ${color} ${status === 'live' ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}
