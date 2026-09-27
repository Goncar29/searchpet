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
 * El socket se abre ACÁ, y no porque cueste: desde que `useWebSocket`
 * comparte UNA sola conexión por sesión (ver `shared/hooks/useWebSocket.ts`),
 * sumar un suscriptor más acá es gratis — no abre un segundo socket. Se abre
 * acá porque esta pantalla necesita reaccionar a `badge_update` para refrescar
 * la lista, y `MainLayout` (que también está suscrito mientras hay sesión) NO
 * lo hace: su `onMessage` sólo actualiza el contador de no leídos ante ese
 * evento. Ver el encabezado de `MessagesShell`.
 */
export function MessagesPage() {
  const { t } = useTranslation(['messages']);
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const onMessage = (envelope: WsEnvelope) => {
    // `chat_message` NO invalida nada acá: `MainLayout` ya invalida el
    // PREFIJO `['messages']` ante cada `chat_message` (lista y todos los
    // hilos), y esta pantalla se monta SIEMPRE dentro de `MainLayout` (ver
    // `App.tsx` y el guard en `App.routeNesting.test.tsx`). Repetirlo acá
    // sería la misma consulta dos veces.
    if (envelope.type === 'badge_update') {
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
