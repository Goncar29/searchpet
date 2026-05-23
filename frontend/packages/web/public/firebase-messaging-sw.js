// Service Worker para Firebase Cloud Messaging
// Este archivo DEBE estar en /public para que se sirva desde la raíz del dominio.
// Las credenciales del SDK web son PÚBLICAS — no contienen secretos del servidor.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Estas credenciales son las mismas que van en el .env del web (VITE_FIREBASE_*)
// Son seguras para el frontend — no exponen el service account del backend.
const firebaseConfig = {
  apiKey: "AIzaSyBX64kOCpg3FLmR5JRbZu2gZWYOT7S-0M8",
  authDomain: "searchpet-566f0.firebaseapp.com",
  projectId: "searchpet-566f0",
  storageBucket: "searchpet-566f0.firebasestorage.app",
  messagingSenderId: "436771110102",
  appId: "1:436771110102:web:58891e0dcffe1b40935d77",
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Manejar mensajes en background (cuando el tab está cerrado o en segundo plano)
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};

  if (!title) return;

  self.registration.showNotification(title, {
    body: body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.data,
  });
});

// Mapa de tipos de notificación a rutas de la app
const ROUTE_MAP = {
  'report.created': (entityId) => `/pet/${entityId}`,
  'pet_found': (entityId) => `/pet/${entityId}`,
  'alert.triggered': (entityId) => `/pet/${entityId}`,
  'message.sent': (entityId) => `/messages/${entityId}`,
};

// Manejar clicks en notificaciones — enfocar tab existente o abrir uno nuevo
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const type = data.type;
  const entityId = data.entityId || data.petId || data.senderId;
  const routeFn = ROUTE_MAP[type];
  const path = routeFn && entityId ? routeFn(entityId) : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(path);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(path);
    })
  );
});
