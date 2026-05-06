// ============================================================
// SearchPet - Tabs Layout (Navegación inferior)
// ============================================================

import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { COLORS } from '../../constants';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Inicio: '🏠',
    Mapa: '🗺️',
    Publicar: '➕',
    Mensajes: '💬',
    Perfil: '👤',
  };

  return (
    <View style={{ alignItems: 'center', paddingTop: 4 }}>
      <Text style={{ fontSize: 22 }}>{icons[name]}</Text>
      <Text
        style={{
          fontSize: 10,
          marginTop: 2,
          color: focused ? COLORS.primary : COLORS.textMuted,
          fontWeight: focused ? '600' : '400',
        }}
      >
        {name}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 10,
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
          tabBarIcon: ({ focused }) => <TabIcon name="Inicio" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Mapa',
          tabBarIcon: ({ focused }) => <TabIcon name="Mapa" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: 'Publicar',
          tabBarIcon: ({ focused }) => <TabIcon name="Publicar" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Mensajes',
          tabBarIcon: ({ focused }) => <TabIcon name="Mensajes" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused }) => <TabIcon name="Perfil" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
