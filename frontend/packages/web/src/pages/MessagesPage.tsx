import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useConversations, useWebSocket } from '@shared/hooks';
import type { WsEnvelope } from '@shared/hooks';
import type { Message } from '@shared/types';
import { useAuth } from '../context/AuthContext';
import { ConversationActionsMenu } from '../components/ConversationActionsMenu';

function timeAgo(dateStr: string, t: (key: string, opts?: object) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return t('common:timeAgo.daysAgo', { count: days });
  if (hours > 0) return t('common:timeAgo.hoursAgo', { count: hours });
  return t('common:timeAgo.minutesAgo', { count: Math.max(1, minutes) });
}

export function MessagesPage() {
  const { t } = useTranslation(['messages', 'common']);
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data: conversations, isLoading } = useConversations();

  const onMessage = (envelope: WsEnvelope) => {
    if (envelope.type === 'chat_message' || envelope.type === 'badge_update') {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    }
  };

  useWebSocket({ enabled: isAuthenticated, onMessage });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        {t('messages:title')}
      </h1>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">{t('messages:loading')}</p>
        </div>
      ) : !conversations || conversations.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-5xl mb-4">💬</p>
          <p className="text-gray-600 dark:text-gray-400">{t('messages:empty')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((msg: Message) => {
            const iAmSender = msg.sender_id === user?.id;
            const otherUserId = iAmSender ? msg.receiver_id : msg.sender_id;
            const otherUser = iAmSender ? msg.receiver : msg.sender;
            const otherUserName = otherUser?.name ?? t('common:unknownUser');
            const unread = !msg.is_read && msg.receiver_id === user?.id;

            return (
              <li
                key={msg.id}
                className="flex items-center gap-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 pr-2 hover:shadow-md transition-shadow"
              >
                <Link
                  to={`/messages/${otherUserId}`}
                  className="flex items-center gap-4 flex-1 min-w-0 px-4 py-3"
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg uppercase">
                    {otherUserName.charAt(0)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {otherUserName}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
                        {timeAgo(msg.created_at, t as (key: string, opts?: object) => string)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate flex-1">
                        {msg.content}
                      </p>
                      {unread && (
                        <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                  </div>
                </Link>
                <ConversationActionsMenu otherUserId={otherUserId} otherUserName={otherUserName} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
