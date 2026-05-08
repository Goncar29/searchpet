// Service Worker para Firebase Cloud Messaging
// Este archivo DEBE estar en /public para que se sirva desde la raíz del dominio.
// Firebase lo registra en /<root>/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Las credenciales se inyectan en build time via __FIREBASE_CONFIG__
// Si no están disponibles, el SW no hace nada (degradación graceful)
const firebaseConfig = self.__FIREBASE_CONFIG__ || {};

if (Object.values(firebaseConfig).some(Boolean)) {
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
}
