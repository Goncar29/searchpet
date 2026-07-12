import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  useConversation,
  useSendMessageTo,
  useWebSocket,
  usePublicProfile,
  useBlockStatus,
} from '@shared/hooks';
import type { WsEnvelope, WsChatMessage, WsTypingEvent } from '@shared/hooks';
import type { Message } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { useAuth } from '../context/AuthContext';
import { ConversationActionsMenu } from '../components/ConversationActionsMenu';

const TYPING_IDLE_MS = 2_000;
const SEND_ERROR_TOAST_MS = 3000;

export function ChatPage() {
  const { t } = useTranslation(['chat', 'common', 'errors']);
  const { userId } = useParams<{ userId: string }>();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: messages, isLoading } = useConversation(userId!);
  const sendMessageTo = useSendMessageTo();
  const { data: profile } = usePublicProfile(userId!);
  const { isBlocked, isLoading: isBlockStatusLoading } = useBlockStatus(userId);
  const otherName = profile?.name ?? t('common:unknownUser');

  const [input, setInput] = useState('');
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const inputSnapshotRef = useRef('');
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending send-error toast timer on unmount.
  useEffect(() => {
    return () => {
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
    };
  }, []);

  const showSendError = (text: string) => {
    if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
    setSendError(text);
    sendErrorTimerRef.current = setTimeout(() => setSendError(null), SEND_ERROR_TOAST_MS);
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onMessage = (envelope: WsEnvelope) => {
    if (envelope.type === 'chat_message') {
      const payload = envelope.payload as WsChatMessage;
      if (payload.from === userId || payload.to === userId) {
        queryClient.invalidateQueries({ queryKey: ['messages', userId] });
      }
    }

    if (envelope.type === 'typing_start') {
      const payload = envelope.payload as WsTypingEvent;
      if (payload.from === userId) {
        setRemoteTyping(true);
      }
    }

    if (envelope.type === 'typing_stop') {
      const payload = envelope.payload as WsTypingEvent;
      if (payload.from === userId) {
        setRemoteTyping(false);
      }
    }
  };

  const { sendEnvelope } = useWebSocket({ enabled: isAuthenticated, onMessage });

  const stopTyping = () => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      sendEnvelope({ type: 'typing_stop', payload: { from: user?.id, to: userId } });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      sendEnvelope({ type: 'typing_start', payload: { from: user?.id, to: userId } });
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      stopTyping();
    }, TYPING_IDLE_MS);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || !userId || !user) return;

    // Stop typing indicator before sending
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    stopTyping();

    // Snapshot for rollback on error
    inputSnapshotRef.current = content;
    setInput('');

    sendMessageTo.mutate(
      { receiverID: userId, senderID: user.id, content },
      {
        onError: (err: Error) => {
          setInput(inputSnapshotRef.current);
          showSendError(getErrorMessage(err, t));
        },
      }
    );
  };

  // Send typing_stop on unmount if still typing
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      stopTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-4rem)]">
      {/* Conversation header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
        <Link to={`/users/${userId}`} className="flex items-center gap-3 min-w-0">
          <div
            aria-hidden="true"
            className="flex-shrink-0 h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold uppercase"
          >
            {otherName.charAt(0)}
          </div>
          <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{otherName}</span>
        </Link>
        {/* Mark-unread is hidden here: viewing this page re-marks the
            conversation read on every refetch, which would silently undo it. */}
        <ConversationActionsMenu
          otherUserId={userId!}
          otherUserName={otherName}
          showMarkUnread={false}
          onHidden={() => navigate('/messages')}
        />
      </div>

      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2"
      >
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">{t('chat:loadingMessages')}</p>
          </div>
        ) : !messages?.length ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
            {t('chat:empty')}
          </div>
        ) : (
          messages.map((msg: Message) => {
            const isOwn = msg.sender_id === user?.id;
            return (
              <div
                key={msg.id}
                className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
                    isOwn
                      ? 'bg-primary text-white rounded-br-none'
                      : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-100 dark:border-gray-700 rounded-bl-none'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            );
          })
        )}

        {/* Remote typing indicator */}
        {remoteTyping && (
          <div className="flex justify-start">
            <div className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none text-sm text-gray-500 dark:text-gray-400 italic">
              {t('chat:typing')}
            </div>
          </div>
        )}
      </div>

      {/* Send form (or blocked banner). While the block status loads we
          render neither, to avoid flashing the form at a blocked user. */}
      {isBlockStatusLoading ? null : isBlocked ? (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('chat:actions.blockedBanner')}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 flex gap-3 items-end"
        >
          <textarea
            value={input}
            onChange={handleInputChange}
            placeholder={t('chat:inputPlaceholder')}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || sendMessageTo.isPending}
            className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {t('chat:send')}
          </button>
        </form>
      )}

      {sendError && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-xl bg-red-600 text-white text-sm px-4 py-2 shadow-lg"
        >
          {sendError}
        </div>
      )}
    </div>
  );
}
