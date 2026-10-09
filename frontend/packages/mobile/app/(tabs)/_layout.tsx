// ============================================================
// SearchPet - Tabs Layout (Navegación inferior)
// ============================================================

import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks/useTheme';
import { Icon, type IconName } from '../../components/Icon';
import { useAuthStore } from '../../store';
import { useUnreadCount } from '@shared/hooks';

// `color` comes from react-navigation: the active or the inactive tint below.
function tabIcon(name: IconName) {
  const TabBarIcon = ({ color }: { color: string }) => (
    <View style={{ alignItems: 'center', paddingTop: 4 }}>
      <Icon name={name} size={26} color={color} />
    </View>
  );
  return TabBarIcon;
}

export default function TabsLayout() {
  const { t } = useTranslation('tabs');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Badge de mensajes sin leer en el tab. REST con poll de 30s; la screen de
  // mensajes invalida ['messages'] vía WebSocket, lo que refresca este count.
  const { data: unreadData } = useUnreadCount(isAuthenticated);
  const unreadCount = unreadData?.count ?? 0;
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        // The scene behind each tab. Logged-out Profile and Messages render a
        // bare centered View with no background, so without this they show
        // react-navigation's default white under dark-theme text.
        sceneStyle: { backgroundColor: colors.background },
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 56,
          paddingBottom: 4,
          paddingTop: 4,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'SearchPet',
          tabBarIcon: tabIcon('home'),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: t('map'),
          tabBarIcon: tabIcon('map'),
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: t('post'),
          tabBarIcon: tabIcon('add'),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('messages'),
          tabBarIcon: tabIcon('chat-bubble'),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.onPrimary },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: tabIcon('person'),
        }}
      />
    </Tabs>
  );
}
