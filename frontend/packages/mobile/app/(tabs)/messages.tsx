// ============================================================
// SearchPet - Messages Screen (Lista de conversaciones)
// ============================================================

import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { useConversations, useWebSocket } from '../../../shared/hooks';
import type { WsEnvelope } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS, SHADOWS } from '../../constants';
import type { Message } from '../../../shared/types';

export default function MessagesScreen() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: conversations, isLoading, refetch, isRefetching } = useConversations();

  // WS subscription: invalidate conversation list on badge_update or new chat_message.
  const handleWsMessage = useCallback((envelope: WsEnvelope) => {
    if (envelope.type === 'badge_update' || envelope.type === 'chat_message') {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    }
  }, [queryClient]);

  useWebSocket({
    enabled: isAuthenticated,
    onMessage: handleWsMessage,
  });

  if (!isAuthenticated) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>💬</Text>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.subtitle}>
          Inicia sesión para ver tus conversaciones
        </Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.loginText}>Iniciar Sesión</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const getOtherUser = (msg: Message) => {
    // El "otro" en la conversación es quien no soy yo
    if (msg.sender_id === user?.id) {
      return { id: msg.receiver_id, name: 'Usuario' };
    }
    return {
      id: msg.sender_id,
      name: msg.sender?.name || 'Usuario',
    };
  };

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'ahora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const other = getOtherUser(item);
          const isUnread = !item.is_read && item.receiver_id === user?.id;

          return (
            <TouchableOpacity
              style={styles.conversationItem}
              onPress={() => router.push(`/chat/${other.id}?userName=${encodeURIComponent(other.name)}` as `/${string}`)}
              activeOpacity={0.7}
            >
              {/* Avatar */}
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {other.name.charAt(0).toUpperCase()}
                </Text>
              </View>

              {/* Info */}
              <View style={styles.conversationInfo}>
                <View style={styles.conversationHeader}>
                  <Text style={[styles.userName, isUnread && styles.userNameUnread]}>
                    {other.name}
                  </Text>
                  <Text style={styles.timeText}>{getTimeAgo(item.created_at)}</Text>
                </View>
                <View style={styles.messageRow}>
                  <Text
                    style={[styles.lastMessage, isUnread && styles.lastMessageUnread]}
                    numberOfLines={1}
                  >
                    {item.sender_id === user?.id ? 'Vos: ' : ''}{item.content}
                  </Text>
                  {isUnread && <View style={styles.unreadDot} />}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={COLORS.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>📭</Text>
            <Text style={styles.title}>Sin mensajes</Text>
            <Text style={styles.subtitle}>
              Cuando alguien te contacte sobre una mascota, aparecerá aquí
            </Text>
          </View>
        }
        contentContainerStyle={
          !conversations?.length ? { flex: 1 } : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
  },
  loginText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
  },
  conversationInfo: { flex: 1 },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  userName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  userNameUnread: { fontWeight: '700' },
  timeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastMessage: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  lastMessageUnread: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginLeft: SPACING.sm,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginLeft: 52 + SPACING.lg + SPACING.md,
  },
});
