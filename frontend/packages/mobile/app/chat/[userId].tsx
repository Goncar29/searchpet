// ============================================================
// SearchPet - Chat Screen (Conversación con usuario)
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useAuthStore } from '../../store';
import {
  useConversation,
  useSendMessageTo,
  useMarkAsRead,
  useBlockUser,
  useBlockStatus,
  useBlockedUsers,
  useUnblockUser,
  useSubmitAbuseReport,
  useWebSocket,
} from '../../../shared/hooks';
import type { WsEnvelope, WsChatMessage, WsTypingEvent } from '../../../shared/hooks';
import { ListState } from '../../components/list/ListState';
import { SPACING, FONTS, RADIUS, type ThemeColors } from '../../constants';
import { useTheme, useThemedStyles } from '../../hooks/useTheme';
import { Icon } from '../../components/Icon';
import { ActionMenuModal, type MenuAction } from '../../components/ActionMenuModal';
import type { Message } from '../../../shared/types';
import { showAlert } from '../../components/appAlert';
import { getErrorMessage } from '../../../shared/utils/apiErrors';

export default function ChatScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation(['messages', 'common']);
  const { userId, userName } = useLocalSearchParams<{ userId: string; userName?: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [isTyping, setIsTyping] = useState(false); // other user is typing
  // Which card is open: the ⋮ menu, or the report reasons it leads to.
  const [sheet, setSheet] = useState<null | 'menu' | 'report'>(null);
  const flatListRef = useRef<FlatList>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conversationQuery = useConversation(userId);
  const { data: messages, isLoading } = conversationQuery;
  const { mutate: sendMessage, isPending: isSending } = useSendMessageTo();
  const markAsRead = useMarkAsRead();
  const blockUser = useBlockUser();
  const submitAbuseReport = useSubmitAbuseReport();
  const { isBlocked: isBidirectionalBlocked } = useBlockStatus(userId);
  const isBlocked = isBidirectionalBlocked;

  // Handle incoming WS envelopes for this conversation.
  const handleWsMessage = useCallback((envelope: WsEnvelope) => {
    if (envelope.type === 'chat_message') {
      const msg = envelope.payload as WsChatMessage;
      // Only process messages belonging to this conversation.
      if (msg.from !== userId && msg.to !== userId) return;

      queryClient.setQueryData<Message[]>(['messages', userId], (old) => {
        if (!old) return old;
        if (old.some((m) => m.id === msg.id)) return old; // dedup
        const newMsg: Message = {
          id: msg.id,
          sender_id: msg.from,
          receiver_id: msg.to,
          content: msg.body ?? '',
          is_read: false,
          created_at: msg.timestamp,
        };
        return [...old, newMsg];
      });
    }

    if (envelope.type === 'typing_start') {
      const ev = envelope.payload as WsTypingEvent;
      if (ev.from === userId) {
        setIsTyping(true);
        // Auto-clear after 4s if no typing_stop arrives.
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setIsTyping(false), 4000);
      }
    }

    if (envelope.type === 'typing_stop') {
      const ev = envelope.payload as WsTypingEvent;
      if (ev.from === userId) {
        setIsTyping(false);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      }
    }
  }, [userId, queryClient]);

  const { sendEnvelope } = useWebSocket({
    enabled: !!user,
    onMessage: handleWsMessage,
  });

  // Cleanup typing timer on unmount.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  const handleBlockUser = () => {
    blockUser.mutate(
      { userId },
      {
        onSuccess: () => {
          showAlert(i18next.t('pet_detail:blockedSuccess'), i18next.t('chat:blockedCannotMessage'));
        },
        onError: () => {
          showAlert(i18next.t('common:error'), i18next.t('pet_detail:blockError'));
        },
      },
    );
  };

  // Whether *I* blocked them: block-status is bidirectional, and when they
  // blocked me there is nothing of mine to undo here.
  const { data: blockedByMe } = useBlockedUsers();
  const iBlockedThem = blockedByMe?.some((b) => b.blocked_id === userId) ?? false;
  const unblockUser = useUnblockUser();

  const handleUnblockUser = () => {
    unblockUser.mutate(userId, {
      onError: (err) => showAlert(i18next.t('common:error'), getErrorMessage(err, i18next.t)),
    });
  };

  const reportReasons: MenuAction[] = (
    ['spam', 'fake', 'abuse', 'inappropriate', 'other'] as const
  ).map((reason) => ({
    key: reason,
    label: i18next.t(`pet_detail:${reason}`),
    onPress: () =>
      submitAbuseReport.mutate(
        { target_user_id: userId, reason },
        {
          onSuccess: () => showAlert(i18next.t('chat:reportSuccess'), i18next.t('chat:reportSuccessText')),
          onError: () => showAlert(i18next.t('common:error'), i18next.t('chat:reportError')),
        },
      ),
  }));

  // The public profile needs no session: it lets the other person be checked
  // (reviews, badges, other posts), as the conversation menu does on the web.
  const handleViewProfile = () => router.push(`/users/${userId}`);

  // A card, not Alert.alert or an action sheet: on Android an Alert shows at
  // most three buttons, so Cancel + these three dropped Report. Report swaps
  // the same card's content to the reasons instead of opening a second Modal.
  const menuActions: MenuAction[] = [
    { key: 'profile', label: i18next.t('chat:actions.viewProfile'), onPress: handleViewProfile },
    // Unblock where you blocked: before, the only way back was Profile →
    // Blocked users, and this menu kept offering Block.
    iBlockedThem
      ? { key: 'unblock', label: i18next.t('chat:actions.unblock'), onPress: handleUnblockUser }
      : { key: 'block', label: i18next.t('chat:blockUser'), onPress: handleBlockUser, destructive: true },
    { key: 'report', label: i18next.t('chat:report'), onPress: () => setSheet('report') },
  ];

  // Set header title immediately from route param (before messages load)
  useEffect(() => {
    if (userName) {
      navigation.setOptions({ title: userName });
    }
  }, [navigation, userName]);

  // Obtener el nombre del otro usuario desde el primer mensaje donde sea sender
  // (fallback when userName param is not available)
  useEffect(() => {
    const headerRight = () => (
      // Same touch area as the conversation list's ⋮: the glyph alone was
      // hard to hit (reported on the 1.3.0 APK).
      <TouchableOpacity
        onPress={() => setSheet('menu')}
        accessibilityRole="button"
        accessibilityLabel={i18next.t('chat:options')}
        style={{ paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={{ fontSize: 22, color: colors.textSecondary }}>⋮</Text>
      </TouchableOpacity>
    );

    if (messages && messages.length > 0) {
      // Buscar un mensaje donde el otro usuario sea sender (tiene .sender preloaded)
      const msgFromOther = messages.find((m) => m.sender_id !== user?.id);
      if (!userName && msgFromOther?.sender?.name) {
        navigation.setOptions({ title: msgFromOther.sender.name, headerRight });
      } else {
        navigation.setOptions({ headerRight });
      }
    } else {
      navigation.setOptions({ headerRight });
    }
    // `user?.id` picks which message names the other person, and `userName`
    // is the route param the title comes from. headerRight only calls
    // setSheet, which keeps its identity; the menu itself renders in this
    // screen, so it always follows the current `userId`. `colors` repaints
    // the ⋮ when the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, user?.id, userId, userName, colors]);

  // Mark unread received messages as read when conversation loads.
  // Depends on the user's id, not the user object: a new object with the same
  // id (a profile refresh) must not re-POST messages the cache still shows as
  // unread. `mutate` is taken out of the mutation result because the result
  // is a new object every render, while react-query keeps `mutate` stable.
  const markAsReadMutate = markAsRead.mutate;
  const currentUserId = user?.id;
  useEffect(() => {
    if (!messages || !currentUserId) return;
    messages
      .filter((m) => m.receiver_id === currentUserId && !m.is_read)
      .forEach((m) => markAsReadMutate(m.id));
  }, [messages, currentUserId, markAsReadMutate]);

  const handleTyping = useCallback((value: string) => {
    setText(value);
    if (!user || !userId) return;
    if (value.length > 0) {
      sendEnvelope({ type: 'typing_start', payload: { from: user.id, to: userId } });
    } else {
      sendEnvelope({ type: 'typing_stop', payload: { from: user.id, to: userId } });
    }
  }, [user, userId, sendEnvelope]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isSending || isBlocked) return;

    // Send typing_stop before the message so the other user's indicator clears.
    sendEnvelope({ type: 'typing_stop', payload: { from: user?.id ?? '', to: userId } });

    sendMessage(
      { receiverID: userId, senderID: user?.id ?? '', content: trimmed },
      { onSuccess: () => setText('') },
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.sender_id === user?.id;

    return (
      <View
        style={[
          styles.bubbleWrapper,
          isMine ? styles.bubbleWrapperMine : styles.bubbleWrapperOther,
        ]}
      >
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {item.content}
          </Text>
        </View>
        <Text style={[styles.bubbleTime, isMine && styles.bubbleTimeMine]}>
          {formatTime(item.created_at)}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Wrapped with ListState (rule #60): a failed `useConversation` used to
          fall through to `ListEmptyComponent` and invite the user to "start
          the conversation" — false when we simply could not read the
          history. The composer below stays reachable either way: not
          knowing the history is not a reason to stop someone from sending a
          new message. */}
      <ListState<Message[], Message>
        query={conversationQuery}
        loading={
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        }
      >
        {(items) => (
          <FlatList
            ref={flatListRef}
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              <View style={styles.center}>
                <View style={{ marginBottom: SPACING.md }}><Icon name="chat-bubble" size={48} color={colors.textMuted} /></View>
                <Text style={styles.emptyText}>
                  {t('chat:startConversation')}
                </Text>
              </View>
            }
          />
        )}
      </ListState>

      {/* Typing indicator */}
      {isTyping && (
        <View style={styles.typingIndicator}>
          <Text style={styles.typingText}>{t('chat:typing_indicator')}</Text>
        </View>
      )}

      {/* Blocked banner */}
      {isBlocked && (
        <View style={styles.blockedBanner}>
          <Text style={styles.blockedBannerText}>{t('chat:blockedBanner')}</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={[styles.input, isBlocked && styles.inputDisabled]}
          value={text}
          onChangeText={handleTyping}
          placeholder={t('chat:inputPlaceholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={1000}
          returnKeyType="default"
          editable={!isBlocked}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!text.trim() || isSending || isBlocked) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || isSending || isBlocked}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t('chat:send')}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <View style={styles.sendIcon}><Icon name="send" size={18} color={colors.onPrimary} /></View>
          )}
        </TouchableOpacity>
      </View>

      <ActionMenuModal
        visible={sheet !== null}
        title={i18next.t(sheet === 'report' ? 'chat:reportReason' : 'chat:options')}
        actions={sheet === 'report' ? reportReasons : menuActions}
        onClose={() => setSheet(null)}
        closeLabel={i18next.t('common:close')}
      />
    </KeyboardAvoidingView>
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  messagesList: {
    padding: SPACING.md,
    paddingBottom: SPACING.sm,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    color: c.textSecondary,
    textAlign: 'center',
  },

  // Burbujas
  bubbleWrapper: {
    marginVertical: 4,
    maxWidth: '78%',
  },
  bubbleWrapperMine: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  bubbleWrapperOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
  },
  bubbleMine: {
    backgroundColor: c.primary,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: c.card,
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleText: {
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    lineHeight: 20,
  },
  bubbleTextMine: {
    color: c.onPrimary,
  },
  bubbleTime: {
    fontSize: FONTS.sizes.xs,
    color: c.textMuted,
    marginTop: 2,
    marginHorizontal: 4,
  },
  bubbleTimeMine: {
    color: c.textMuted,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.md : SPACING.sm,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: c.background,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: FONTS.sizes.md,
    color: c.textPrimary,
    maxHeight: 100,
    minHeight: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: c.border,
  },
  sendIcon: {
    marginLeft: 2,
  },
  typingIndicator: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
  },
  typingText: {
    fontSize: FONTS.sizes.xs,
    color: c.textMuted,
    fontStyle: 'italic',
  },
  blockedBanner: {
    backgroundColor: c.dangerSoftBg,
    borderTopWidth: 1,
    borderTopColor: c.dangerSoftBorder,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  blockedBannerText: {
    fontSize: FONTS.sizes.sm,
    color: c.dangerSoftText,
    fontWeight: '500',
  },
  inputDisabled: {
    opacity: 0.5,
  },
});
