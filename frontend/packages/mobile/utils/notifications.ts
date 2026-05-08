import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { apiClient } from '../../shared/api/client';

/**
 * Registra el token FCM del dispositivo en el backend.
 *
 * Flujo:
 * 1. Verifica que estemos en un dispositivo físico (FCM no funciona en simulador)
 * 2. Pide permiso al usuario para recibir notificaciones
 * 3. Obtiene el token nativo del dispositivo (FCM en Android, APNs en iOS)
 * 4. Lo envía al backend vía POST /api/devices/token
 *
 * Falla silenciosamente — si el usuario rechaza o hay error,
 * la app sigue funcionando sin push notifications.
 */
export async function registerPushToken(): Promise<void> {
  // FCM solo funciona en dispositivos físicos
  if (!Device.isDevice) {
    console.log('[Notifications] Simulador detectado — registro de token omitido');
    return;
  }

  try {
    // Pedir permiso al usuario
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permiso denegado — push notifications desactivadas');
      return;
    }

    // Obtener el token nativo del dispositivo
    // getDevicePushTokenAsync() retorna el token FCM raw en Android
    // y el token APNs en iOS (Firebase lo mapea automáticamente)
    const tokenData = await Notifications.getDevicePushTokenAsync();

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';

    await apiClient.registerDeviceToken(tokenData.data, platform);

    console.log('[Notifications] Token FCM registrado correctamente');
  } catch (error) {
    // No propagamos el error — las notificaciones son secundarias
    console.warn('[Notifications] Error al registrar token:', error);
  }
}

/**
 * Configura cómo se muestran las notificaciones cuando la app está en foreground.
 * Llamar una vez al arrancar la app (en _layout.tsx).
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
