// ============================================================
// SearchPet - Layout principal (Expo Router)
// ============================================================

// MUST stay the first import: installs CustomEvent/addEventListener/dispatchEvent
// on the global scope, which React Native does not provide. The store registers a
// listener on them at import time, so this has to be evaluated before ../store is.
import '../polyfills/domEvents';

// Feeds the device's connectivity into React Query's onlineManager. Without it
// `query.isPaused` is never true on a device and ListState's offline card is
// unreachable — see utils/onlineStatus.ts.
import '../utils/onlineStatus';

// Initialize i18next before any screen renders (synchronous — bundled resources)
import '../i18n';

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  const [isReady, setIsReady] = useState(false);
  // Subscribes the layout to the language: the native titles below are read in render.
  const { t } = useTranslation();

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    loadToken();
    // Rehydrate the session once on mount only. loadToken is a zustand
    // store action; its reference never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // `router` is stable (expo-router memoizes useRouter() with an empty
    // dependency array), so the listener registers once.
  }, [router]);

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
          options={{ title: t('profile:loginButton'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="register"
          options={{ title: t('profile:createAccount'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="forgot-password"
          options={{ title: t('auth:forgotPassword.title'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="pet/[id]"
          options={{ title: t('pet_detail:loading') }}
        />
        <Stack.Screen
          name="chat/[userId]"
          options={{ title: t('tabs:messages') }}
        />
        <Stack.Screen
          name="my-pets"
          options={{ title: t('my_pets:title') }}
        />
        <Stack.Screen
          name="adopt"
          options={{ title: t('adoption:section.title') }}
        />
        <Stack.Screen
          name="pets/register"
          options={{ title: t('post:title') }}
        />
        <Stack.Screen
          name="alerts/index"
          options={{ title: t('alerts:title') }}
        />
        <Stack.Screen
          name="badges/index"
          options={{ title: t('profile:menuBadges') }}
        />
        <Stack.Screen
          name="leaderboard/index"
          options={{ title: t('leaderboard:title') }}
        />
        <Stack.Screen
          name="users/[id]"
          options={{ title: t('profile:title') }}
        />
        <Stack.Screen
          name="groups/index"
          options={{ title: t('groups:title') }}
        />
        <Stack.Screen
          name="groups/[id]"
          options={{ title: t('groups:groupDetail') }}
        />
        <Stack.Screen
          name="blocked-users"
          options={{ title: t('blocked_users:title') }}
        />
        <Stack.Screen
          name="story/create"
          options={{ title: t('story:createTitle'), presentation: 'modal' }}
        />
        <Stack.Screen
          name="foster-homes/index"
          options={{ title: t('fosterHomes:directory.title') }}
        />
        <Stack.Screen
          name="foster-homes/mine"
          options={{ title: t('fosterHomes:mine.title') }}
        />
        <Stack.Screen
          name="foster-homes/register"
          options={{ title: t('fosterHomes:register.title') }}
        />
        <Stack.Screen
          name="foster-home/[id]"
          options={{ title: t('fosterHomes:detail.title') }}
        />
        <Stack.Screen
          name="edit-profile"
          options={{ title: t('profile:editProfile.title') }}
        />
        <Stack.Screen
          name="story/index"
          options={{ title: t('story:title') }}
        />
        <Stack.Screen
          name="story/[id]"
          options={{ title: t('story:title') }}
        />
        <Stack.Screen
          name="google-location"
          options={{ title: t('auth:location.title') }}
        />
        <Stack.Screen name="shelters/index" options={{ headerShown: false }} />
      </Stack>
    </QueryClientProvider>
  );
}
