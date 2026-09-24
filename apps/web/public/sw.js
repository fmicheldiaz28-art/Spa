// Service worker de NaturalSpa (PWA, docs/09-ux-ui.md): instalable y con aviso sin conexión.
// Regla de privacidad: NUNCA se guardan en caché respuestas del API ni páginas con datos;
// solo archivos estáticos con hash y la página de "sin conexión".
const VERSION = 'ns-v1';
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
