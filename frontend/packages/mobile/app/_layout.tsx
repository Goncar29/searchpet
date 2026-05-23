// ============================================================
// SearchPet - Layout principal (Expo Router)
// ============================================================

import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../store';
import { COLORS } from '../constants';
import { configureNotificationHandler } from '../utils/notifications';

// Configura cómo se muestran las notificaciones en foreground — una vez al arrancar
configureNotificationHandler();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export default function RootLayout() {
  const loadToken = useAuthStore((state) => state.loadToken);
  const router = useRouter();

  useEffect(() => {
    loadToken();
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const data = response.notification.request.content.data as Record<string, string> | undefined;
        const type = data?.type;
        const entityId = data?.entityId;

        switch (type) {
          case 'report.created':
            try { router.push(`/pet/${entityId}` as `/${string}`); } catch { router.push('/(tabs)'); }
            break;
          case 'pet_found':
            try { router.push(`/pet/${entityId}` as `/${string}`); } catch { router.push('/(tabs)'); }
            break;
          case 'message.sent':
            try { router.push(`/chat/${entityId}${data?.senderName ? `?userName=${encodeURIComponent(data.senderName)}` : ''}` as `/${string}`); } catch { router.push('/(tabs)'); }
            break;
          default:
            router.push('/(tabs)');
            break;
        }
      } catch {
        router.push('/(tabs)');
      }
    });

    return () => subscription.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: COLORS.white },
          headerTintColor: COLORS.primary,
          headerTitleStyle: { fontWeight: '700', fontSize: 18 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: COLORS.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="login"
          options={{ title: 'Iniciar Sesión', presentation: 'modal' }}
        />
        <Stack.Screen
          name="register"
          options={{ title: 'Crear Cuenta', presentation: 'modal' }}
        />
        <Stack.Screen
          name="pet/[id]"
          options={{ title: 'Detalle de Mascota' }}
        />
        <Stack.Screen
          name="report/create"
          options={{ title: 'Crear Reporte', presentation: 'modal' }}
        />
        <Stack.Screen
          name="chat/[userId]"
          options={{ title: 'Chat' }}
        />
        <Stack.Screen
          name="my-pets"
          options={{ title: 'Mis Mascotas' }}
        />
        <Stack.Screen
          name="alerts/index"
          options={{ title: 'Mis Alertas' }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
