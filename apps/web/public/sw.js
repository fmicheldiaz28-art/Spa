// Service worker de NaturalSpa (PWA, docs/09-ux-ui.md): instalable y con aviso sin conexión.
// Regla de privacidad: NUNCA se guardan en caché respuestas del API ni páginas con datos;
// solo archivos estáticos con hash y la página de "sin conexión".
const VERSION = 'ns-v2';
const STATIC = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icon.svg', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Navegación: siempre a la red; si no hay conexión, la página de aviso.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Archivos de Next.js con hash en el nombre: inmutables, se sirven desde caché.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(STATIC).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Notificaciones push (Fase 2): el API envía { title, body, url, tag } cifrado (RFC 8291).
self.addEventListener('push', (event) => {
  let data = { title: 'NaturalSpa', body: '', url: '/app' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* mensaje sin contenido: aviso genérico */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url },
    }),
  );
});

// Al tocar la notificación: enfoca la app si ya está abierta; si no, la abre en la pantalla indicada.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/app', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === url.origin);
      if (win) return win.navigate(url.href).then((w) => (w ?? win).focus());
      return self.clients.openWindow(url.href);
    }),
  );
});
