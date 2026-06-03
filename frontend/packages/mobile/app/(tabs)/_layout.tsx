// ============================================================
// SearchPet - Tabs Layout (Navegación inferior)
// ============================================================

import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../constants';

const TAB_ICONS: Record<string, string> = {
  home: '🏠',
  map: '🗺️',
  post: '➕',
  messages: '💬',
  profile: '👤',
};

function TabIcon({ tab, focused }: { tab: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 4 }}>
      <Text style={{ fontSize: 24, opacity: focused ? 1 : 0.55 }}>{TAB_ICONS[tab]}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation('tabs');
  return (
    <Tabs
      screenOptions={{
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 56,
          paddingBottom: 4,
          paddingTop: 4,
        },
        tabBarActiveTintColor: COLORS.primary,
        headerStyle: { backgroundColor: COLORS.white },
        headerTintColor: COLORS.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'SearchPet',
          tabBarIcon: ({ focused }) => <TabIcon tab="home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: t('map'),
          tabBarIcon: ({ focused }) => <TabIcon tab="map" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: t('post'),
          tabBarIcon: ({ focused }) => <TabIcon tab="post" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('messages'),
          tabBarIcon: ({ focused }) => <TabIcon tab="messages" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: ({ focused }) => <TabIcon tab="profile" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
