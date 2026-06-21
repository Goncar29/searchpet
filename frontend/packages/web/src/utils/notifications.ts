import { getToken, onMessage } from 'firebase/messaging';
import { getFirebaseMessaging } from '../lib/firebase';
import { apiClient } from '@shared/api/client';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// Guard to prevent duplicate listeners across hot-reloads or double calls
let _foregroundUnsubscribe: (() => void) | null = null;

/**
 * Registra un listener de mensajes en primer plano (tab activo).
 *
 * Cuando llega una notificación mientras el tab está activo, el SDK de FCM
 * NO muestra la notificación del SO — este handler la muestra manualmente
 * usando la Notification API del browser.
 *
 * Llama al unsubscribe retornado para limpiar el listener (ej: al hacer logout).
 * Idempotente — llamar más de una vez no registra handlers duplicados.
 */
export function listenForegroundMessages(): (() => void) | undefined {
  const messaging = getFirebaseMessaging();
  if (!messaging) return undefined;

  // Si ya hay un listener activo, retornarlo sin registrar otro
  if (_foregroundUnsubscribe) return _foregroundUnsubscribe;

  const unsubscribe = onMessage(messaging, (payload) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const title = payload.notification?.title ?? 'SearchPet';
    const body = payload.notification?.body ?? '';

    new Notification(title, {
      body,
      icon: '/favicon.ico',
    });
  });

  _foregroundUnsubscribe = () => {
    unsubscribe();
    _foregroundUnsubscribe = null;
  };

  return _foregroundUnsubscribe;
}

/**
 * Registra el token FCM del navegador en el backend.
 *
 * Flujo:
 * 1. Verifica soporte de Service Workers y notificaciones en el browser
 * 2. Pide permiso al usuario
 * 3. Registra el Service Worker de Firebase (firebase-messaging-sw.js)
 * 4. Obtiene el token FCM del navegador vía VAPID key
 * 5. Lo envía al backend vía POST /api/devices/token
 *
 * Falla silenciosamente — si el usuario rechaza o el browser no soporta,
 * la app sigue funcionando sin push notifications.
 */
export async function registerWebPushToken(): Promise<void> {
  // Verificar soporte básico del browser
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return;
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) {
    return;
  }

  if (!VAPID_KEY) {
    console.warn('[Notifications] VITE_FIREBASE_VAPID_KEY no configurada');
    return;
  }

  try {
    // Pedir permiso al usuario
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    // Registrar el Service Worker antes de pedir el token
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
      { scope: '/' }
    );

    // Obtener el token FCM del navegador
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      console.warn('[Notifications] No se pudo obtener el token FCM');
      return;
    }

    await apiClient.registerDeviceToken(token, 'web');
  } catch (error) {
    // No propagamos el error — las notificaciones son secundarias
    console.warn('[Notifications] Error al registrar token web:', error);
  }
}
