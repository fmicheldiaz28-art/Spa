'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker (PWA) solo en producción: en desarrollo interferiría con la recarga
 * en caliente. Ver public/sw.js.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
