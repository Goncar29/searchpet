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
  Alert,
} from 'react-native';
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import {
  useConversations,
  useHideConversation,
  useMarkConversationUnread,
  useWebSocket,
} from '../../../shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ActionMenuModal } from '../../components/ActionMenuModal';
import type { WsEnvelope } from '../../../shared/hooks';
import { ListState } from '../../components/list/ListState';
import { SPACING, FONTS, RADIUS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { Icon } from '../../components/Icon';
import type { Conversation } from '../../../shared/types';

export default function MessagesScreen() {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['common', 'messages']);
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();
  const conversationsQuery = useConversations();
  const { refetch, isRefetching } = conversationsQuery;
  const markUnread = useMarkConversationUnread();
  const hideConversation = useHideConversation();
  // The row whose ⋮ is open, and whether it is asking to confirm the delete.
  const [menu, setMenu] = useState<{ userId: string; step: 'menu' | 'confirmDelete' } | null>(null);

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
        <View style={{ marginBottom: SPACING.md }}><Icon name="chat-bubble" size={48} color={colors.textMuted} /></View>
        <Text style={styles.title}>{t('messages:title')}</Text>
        <Text style={styles.subtitle}>{t('messages:loginSubtitle')}</Text>
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => router.push('/login')}
        >
          <Text style={styles.loginText}>{t('messages:loginButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showError = (err: Error) =>
    Alert.alert(i18next.t('common:error'), getErrorMessage(err, (key) => i18next.t(key)));

  const menuActions =
    menu?.step === 'confirmDelete'
      ? [
          {
            key: 'confirm',
            label: t('chat:actions.confirm'),
            destructive: true,
            onPress: () => hideConversation.mutate(menu.userId, { onError: showError }),
          },
        ]
      : [
          {
            key: 'unread',
            label: t('chat:actions.markUnread'),
            onPress: () => menu && markUnread.mutate(menu.userId, { onError: showError }),
          },
          {
            key: 'delete',
            label: t('chat:actions.delete'),
            destructive: true,
            // Same card, next step: closing it (X, outside, back) is the Cancel.
            onPress: () => menu && setMenu({ userId: menu.userId, step: 'confirmDelete' }),
          },
        ];

  const getOtherUser = (msg: Conversation) => {
    // El "otro" en la conversación es quien no soy yo
    if (msg.sender_id === user?.id) {
      return {
        id: msg.receiver_id,
        name: msg.receiver?.name || i18next.t('common:unknownUser'),
      };
    }
    return {
      id: msg.sender_id,
      name: msg.sender?.name || i18next.t('common:unknownUser'),
    };
  };

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return i18next.t('common:timeAgo.now');
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  };

  return (
    <View style={styles.container}>
      {/* Wrapped with ListState (rule #60): a failed `useConversations` used to
          fall through to `ListEmptyComponent` and tell the user "no
          conversations", which is false when we simply could not read them. */}
      <ListState<Conversation[], Conversation>
        query={conversationsQuery}
        loading={
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        }
      >
        {(conversations) => (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const other = getOtherUser(item);
              // From the conversation's count, never its latest message: when I
              // answered last, the latest message is mine and never "unread" for
              // me, even after "mark unread" un-read an earlier one of theirs.
              const isUnread = item.unread_count > 0;
              const preview = `${item.sender_id === user?.id ? t('messages:youPrefix') : ''}${item.content}`;
              // Spelled out instead of left to the children: the dot is a
              // colored circle with no text, so without "unread" here a
              // screen reader could not tell this row from a read one.
              const rowLabel = [
                other.name,
                isUnread ? t('messages:unreadLabel') : null,
                preview,
                getTimeAgo(item.created_at),
              ]
                .filter(Boolean)
                .join(', ');

              return (
                <View style={styles.conversationRow}>
                  <TouchableOpacity
                    style={styles.conversationItem}
                    onPress={() => router.push(`/chat/${other.id}?userName=${encodeURIComponent(other.name)}` as `/${string}`)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={rowLabel}
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
                          {preview}
                        </Text>
                        {isUnread && <View testID="unread-dot" style={styles.unreadDot} />}
                      </View>
                    </View>
                  </TouchableOpacity>
                  {/* A sibling of the row, not inside it: nested in the row's
                      touchable, a screen reader would merge it into the row
                      and never reach it on its own. */}
                  <TouchableOpacity
                    style={styles.menuButton}
                    onPress={() => setMenu({ userId: other.id, step: 'menu' })}
                    accessibilityRole="button"
                    accessibilityLabel={t('chat:actions.menuLabel', { name: other.name })}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  >
                    <Text style={styles.menuButtonText}>⋮</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={colors.primary}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <View style={{ marginBottom: SPACING.md }}><Icon name="inbox" size={48} color={colors.textMuted} /></View>
                <Text style={styles.title}>{t('messages:emptyTitle')}</Text>
                <Text style={styles.subtitle}>{t('messages:emptySubtitle')}</Text>
              </View>
            }
            contentContainerStyle={
              conversations.length === 0 ? { flex: 1 } : undefined
            }
          />
        )}
      </ListState>

      <ActionMenuModal
        visible={menu !== null}
        title={t(menu?.step === 'confirmDelete' ? 'chat:actions.deleteConfirmTitle' : 'chat:options')}
        message={menu?.step === 'confirmDelete' ? t('chat:actions.deleteConfirmBody') : undefined}
        actions={menuActions}
        onClose={() => setMenu(null)}
        closeLabel={t('common:close')}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.surface },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  loginButton: {
    backgroundColor: c.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
  },
  loginText: {
    color: c.onPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
  },
  conversationRow: { flexDirection: 'row', alignItems: 'center' },
  conversationItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  menuButton: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  menuButtonText: { fontSize: 22, color: c.textSecondary },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    color: c.onPrimary,
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
    color: c.textPrimary,
  },
  userNameUnread: { fontWeight: '700' },
  timeText: {
    fontSize: FONTS.sizes.xs,
    color: c.textMuted,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lastMessage: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: c.textSecondary,
  },
  lastMessageUnread: {
    color: c.textPrimary,
    fontWeight: '600',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: c.primary,
    marginLeft: SPACING.sm,
  },
  separator: {
    height: 1,
    backgroundColor: c.border,
    marginLeft: 52 + SPACING.lg + SPACING.md,
  },
});
