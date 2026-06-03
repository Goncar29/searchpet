// ============================================================
// SearchPet - Layout principal (Expo Router)
// ============================================================

// Initialize i18next before any screen renders (synchronous — bundled resources)
import '../i18n';

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import i18next from 'i18next';
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
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

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

  if (!isReady) {
    return <View style={{ flex: 1 }} />;
  }

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
          options={{ title: i18next.t('profile.loginButton'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="register"
          options={{ title: i18next.t('profile.createAccount'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="pet/[id]"
          options={{ title: i18next.t('pet_detail.loading') }}
        />
        <Stack.Screen
          name="report/create"
          options={{ title: i18next.t('post.title'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="chat/[userId]"
          options={{ title: i18next.t('tabs.messages') }}
        />
        <Stack.Screen
          name="my-pets"
          options={{ title: i18next.t('my_pets.title') }}
        />
        <Stack.Screen
          name="alerts/index"
          options={{ title: i18next.t('alerts.title') }}
        />
        <Stack.Screen
          name="badges/index"
          options={{ title: i18next.t('profile.menuBadges') }}
        />
        <Stack.Screen
          name="leaderboard/index"
          options={{ title: i18next.t('leaderboard.title') }}
        />
        <Stack.Screen
          name="users/[id]"
          options={{ title: i18next.t('profile.title') }}
        />
        <Stack.Screen
          name="groups/index"
          options={{ title: i18next.t('groups.title') }}
        />
        <Stack.Screen
          name="groups/[id]"
          options={{ title: i18next.t('groups.groupDetail') }}
        />
        <Stack.Screen
          name="blocked-users"
          options={{ title: i18next.t('blocked_users.title') }}
        />
        <Stack.Screen
          name="story/create"
          options={{ title: i18next.t('story.createTitle'), presentation: 'modal' }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
