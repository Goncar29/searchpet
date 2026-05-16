// SearchPet Service Worker v1
// Estrategia: Network first, cache fallback para assets estáticos.
// Las llamadas a /api/ NUNCA se cachean.

const CACHE_NAME = 'searchpet-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

// Instalar: cachear assets base
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback a cache
self.addEventListener('fetch', (event) => {
  // Nunca interceptar llamadas a la API — siempre deben ir al servidor
  if (event.request.url.includes('/api/')) return;

  // Solo cachear GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cachear respuestas exitosas de assets estáticos
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        // Sin red: servir desde cache, fallback a index.html para SPA routing
        caches.match(event.request).then(
          (cached) => cached || caches.match('/index.html')
        )
      )
  );
});

// Push notifications básicas (cuando FCM esté integrado, este handler
// convive con firebase-messaging-sw.js que maneja el scope /firebase-cloud-messaging-push-scope)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'SearchPet', {
      body: data.body || '¡Hay una mascota perdida cerca de ti!',
      icon: '/icons/icon.png',
      badge: '/icons/icon.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
      actions: [
        { action: 'view', title: 'Ver mascota' },
        { action: 'close', title: 'Cerrar' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
