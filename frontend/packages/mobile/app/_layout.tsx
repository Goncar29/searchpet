// ============================================================
// SearchPet - Layout principal (Expo Router)
// ============================================================

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

  useEffect(() => {
    loadToken();
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
      </Stack>
    </QueryClientProvider>
  );
}
