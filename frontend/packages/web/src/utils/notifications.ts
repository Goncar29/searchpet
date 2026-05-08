import { getToken } from 'firebase/messaging';
import { getFirebaseMessaging } from '../lib/firebase';
import { apiClient } from '@shared/api/client';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

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
    console.log('[Notifications] Browser no soporta notificaciones push');
    return;
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) {
    console.log('[Notifications] Firebase no configurado — push notifications desactivadas');
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
      console.log('[Notifications] Permiso denegado');
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
    console.log('[Notifications] Token FCM web registrado correctamente');
  } catch (error) {
    // No propagamos el error — las notificaciones son secundarias
    console.warn('[Notifications] Error al registrar token web:', error);
  }
}
