import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from '@shared/hooks';
import type { WsEnvelope } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';
import { MessagesShell } from '../components/chat/MessagesShell';

/**
 * `/messages` — la lista de conversaciones.
 *
 * En escritorio dibuja las dos columnas del diseño con la derecha en blanco; en
 * celular sólo la lista. La conversación en sí vive en `/messages/:userId`
 * (`ChatPage`), que monta el mismo shell con la columna derecha llena.
 *
 * El socket se abre ACÁ y no en el shell: `useWebSocket` abre una conexión por
 * montaje, así que el hook va una vez por ruta. Ver el encabezado de
 * `MessagesShell`.
 */
export function MessagesPage() {
  const { t } = useTranslation(['messages']);
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const onMessage = (envelope: WsEnvelope) => {
    if (envelope.type === 'chat_message' || envelope.type === 'badge_update') {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    }
  };

  useWebSocket({ enabled: isAuthenticated, onMessage });

  return (
    <MessagesShell>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Icon name="chat-bubble" className="mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" />
        <p className="font-display text-headline text-gray-900 dark:text-gray-100">
          {t('messages:selectPrompt')}
        </p>
        <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
          {t('messages:selectPromptSubtitle')}
        </p>
      </div>
    </MessagesShell>
  );
}
