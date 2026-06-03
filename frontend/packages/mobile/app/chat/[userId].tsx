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
  Alert,
  ActionSheetIOS,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
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
  useSubmitAbuseReport,
  useWebSocket,
} from '../../../shared/hooks';
import type { WsEnvelope, WsChatMessage, WsTypingEvent } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import type { Message } from '../../../shared/types';

export default function ChatScreen() {
  const { t } = useTranslation(['messages', 'common']);
  const { userId, userName } = useLocalSearchParams<{ userId: string; userName?: string }>();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [isTyping, setIsTyping] = useState(false); // other user is typing
  const flatListRef = useRef<FlatList>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: messages, isLoading } = useConversation(userId);
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
          Alert.alert(i18next.t('pet_detail:blockedSuccess'), i18next.t('chat:blockedCannotMessage'));
        },
        onError: () => {
          Alert.alert(i18next.t('common:error'), i18next.t('pet_detail:blockError'));
        },
      },
    );
  };

  const handleReportUser = () => {
    const reasons: Array<{ label: string; value: string }> = [
      { label: i18next.t('pet_detail:spam'), value: 'spam' },
      { label: i18next.t('pet_detail:fake'), value: 'fake' },
      { label: i18next.t('pet_detail:abuse'), value: 'abuse' },
      { label: i18next.t('pet_detail:inappropriate'), value: 'inappropriate' },
      { label: i18next.t('pet_detail:other'), value: 'other' },
    ];
    Alert.alert(
      i18next.t('chat:reportReason'),
      '',
      [
        ...reasons.map((r) => ({
          text: r.label,
          onPress: () => {
            submitAbuseReport.mutate(
              { target_user_id: userId, reason: r.value as 'spam' | 'fake' | 'abuse' | 'inappropriate' | 'other' },
              {
                onSuccess: () => Alert.alert(i18next.t('chat:reportSuccess'), i18next.t('chat:reportSuccessText')),
                onError: () => Alert.alert(i18next.t('common:error'), i18next.t('chat:reportError')),
              },
            );
          },
        })),
        { text: i18next.t('common:cancel'), style: 'cancel' },
      ],
    );
  };

  const showKebabSheet = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [i18next.t('common:cancel'), i18next.t('chat:blockUser'), i18next.t('chat:report')],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
        },
        (idx) => {
          if (idx === 1) handleBlockUser();
          if (idx === 2) handleReportUser();
        },
      );
    } else {
      Alert.alert(i18next.t('chat:options'), '', [
        { text: i18next.t('common:cancel'), style: 'cancel' },
        { text: i18next.t('chat:blockUser'), style: 'destructive', onPress: handleBlockUser },
        { text: i18next.t('chat:report'), onPress: handleReportUser },
      ]);
    }
  };

  // Set header title immediately from route param (before messages load)
  useEffect(() => {
    if (userName) {
      navigation.setOptions({ title: userName });
    }
  }, [userName]);

  // Obtener el nombre del otro usuario desde el primer mensaje donde sea sender
  // (fallback when userName param is not available)
  useEffect(() => {
    const headerRight = () => (
      <TouchableOpacity onPress={showKebabSheet}>
        <Text style={{ paddingRight: 16, fontSize: 22 }}>⋮</Text>
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
  }, [messages]);

  // Mark unread received messages as read when conversation loads
  useEffect(() => {
    if (!messages || !user) return;
    messages
      .filter((m) => m.receiver_id === user.id && !m.is_read)
      .forEach((m) => markAsRead.mutate(m.id));
  }, [messages]);

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
        <ActivityIndicator size="large" color={COLORS.primary} />
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
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>💬</Text>
            <Text style={styles.emptyText}>
              {t('chat:startConversation')}
            </Text>
          </View>
        }
      />

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
          placeholderTextColor={COLORS.textMuted}
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
        >
          {isSending ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.sendIcon}>➤</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${mins}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
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
    color: COLORS.textSecondary,
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
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: COLORS.white,
    borderBottomLeftRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  bubbleText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  bubbleTextMine: {
    color: COLORS.white,
  },
  bubbleTime: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    marginTop: 2,
    marginHorizontal: 4,
  },
  bubbleTimeMine: {
    color: COLORS.textMuted,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.md : SPACING.sm,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    maxHeight: 100,
    minHeight: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  sendIcon: {
    color: COLORS.white,
    fontSize: 16,
    marginLeft: 2,
  },
  typingIndicator: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
  },
  typingText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  blockedBanner: {
    backgroundColor: '#fef2f2',
    borderTopWidth: 1,
    borderTopColor: '#fecaca',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  blockedBannerText: {
    fontSize: FONTS.sizes.sm,
    color: '#dc2626',
    fontWeight: '500',
  },
  inputDisabled: {
    opacity: 0.5,
  },
});
