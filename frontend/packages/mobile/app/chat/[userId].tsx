// ============================================================
// SearchPet - Chat Screen (Conversación con usuario)
// ============================================================

import { useState, useRef, useEffect } from 'react';
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
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useAuthStore } from '../../store';
import { useConversation, useSendMessageTo } from '../../../shared/hooks';
import { COLORS, SPACING, FONTS, RADIUS } from '../../constants';
import type { Message } from '../../../shared/types';

export default function ChatScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const { data: messages, isLoading } = useConversation(userId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessageTo();

  // Obtener el nombre del otro usuario desde el primer mensaje donde sea sender
  useEffect(() => {
    if (messages && messages.length > 0) {
      // Buscar un mensaje donde el otro usuario sea sender (tiene .sender preloaded)
      const msgFromOther = messages.find((m) => m.sender_id !== user?.id);
      if (msgFromOther?.sender?.name) {
        navigation.setOptions({ title: msgFromOther.sender.name });
      }
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setText('');
    sendMessage({ receiverID: userId, text: trimmed });
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
            {item.text}
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
              Comenzá la conversación enviando un mensaje
            </Text>
          </View>
        }
      />

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Escribí un mensaje..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={1000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[styles.sendButton, (!text.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || isSending}
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
});
