// Service Worker para Firebase Cloud Messaging
// AUTO-GENERADO en build-time desde src/firebase-messaging-sw.template.js
// No editar public/firebase-messaging-sw.js directamente.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "__VITE_FIREBASE_API_KEY__",
  authDomain: "__VITE_FIREBASE_AUTH_DOMAIN__",
  projectId: "__VITE_FIREBASE_PROJECT_ID__",
  storageBucket: "__VITE_FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__VITE_FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__VITE_FIREBASE_APP_ID__",
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

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

const ROUTE_MAP = {
  'report.created': (entityId) => `/pet/${entityId}`,
  'pet_found': (entityId) => `/pet/${entityId}`,
  'alert.triggered': (entityId) => `/pet/${entityId}`,
  'message.sent': (entityId) => `/messages/${entityId}`,
};

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
