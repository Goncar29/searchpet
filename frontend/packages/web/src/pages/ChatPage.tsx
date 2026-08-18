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
import { Icon } from '../components/Icon';
import { ConversationActionsMenu } from '../components/ConversationActionsMenu';
import { MessagesShell } from '../components/chat/MessagesShell';

const TYPING_IDLE_MS = 2_000;
const SEND_ERROR_TOAST_MS = 3000;

/** Identidad del día civil de una fecha, para agrupar los mensajes. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * `/messages/:userId`.
 *
 * Sólo lee el parámetro y monta la conversación CON `key={userId}`. Esa key es
 * el arreglo entero, y el motivo es de peso:
 *
 * React Router **no remonta** un componente cuando lo único que cambia es el
 * parámetro de la ruta. Desde que la lista comparte pantalla con el hilo, saltar
 * de una conversación a otra es un click en la fila de al lado — y sin la key,
 * todo el `useState` de la conversación anterior sobrevive al salto. Medido en
 * el browser antes de arreglarlo: un borrador escrito mirando a Ana quedaba en
 * el compositor de Bruno, y al apretar Enter el POST salía con
 * `receiver_id` de **Bruno**. Un mensaje escrito para una persona, entregado a
 * otra. En la base quedó la fila que lo prueba.
 *
 * Antes de este rediseño el salto no existía: para cambiar de conversación había
 * que pasar por `/messages`, que desmontaba esta pantalla y limpiaba todo. El
 * camino nuevo es el que estrena el problema.
 *
 * Va por `key` y NO por un efecto que resetee los campos, porque un efecto es
 * una LISTA que alguien tiene que acordarse de ampliar: hoy serían `input`,
 * `remoteTyping`, `sendError` y cuatro refs con timers adentro, y el estado
 * nuevo que se agregue mañana entra sin resetearse y sin que nada avise. La key
 * los cubre a todos por construcción, incluidos los que todavía no existen.
 *
 * Efecto lateral y deseado: el `typing_stop` del cleanup ahora se dispara al
 * cambiar de conversación, y sale con el `userId` VIEJO — que es a quien hay que
 * avisarle. Sin remontar, ese aviso se lo habría comido el destinatario nuevo.
 */
export function ChatPage() {
  const { userId } = useParams<{ userId: string }>();
  return <Conversation key={userId} userId={userId!} />;
}

function Conversation({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation(['chat', 'common', 'errors']);
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: messages, isLoading, isError, refetch } = useConversation(userId);
  const sendMessageTo = useSendMessageTo();
  const { data: profile } = usePublicProfile(userId);
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
        // Y la lista de la izquierda, que ahora se dibuja en esta misma
        // pantalla: sin esto el hilo se actualiza y la fila de al lado sigue
        // mostrando el mensaje viejo como último. Antes no hacía falta porque
        // la lista vivía en otra ruta.
        queryClient.invalidateQueries({ queryKey: ['messages'], exact: true });
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

  /**
   * Etiqueta del separador de día.
   *
   * "Hoy" y "Ayer" se traducen; el resto sale de `toLocaleDateString` con el
   * idioma ACTIVO de i18next y no el del navegador, que son dos cosas distintas:
   * la app deja elegir idioma en la barra, así que alguien con Chrome en inglés
   * y SearchPet en español vería "August 18" arriba de un chat en español.
   */
  const dayLabel = (iso: string): string => {
    const key = dayKey(iso);
    const now = new Date();
    if (key === dayKey(now.toISOString())) return t('chat:today');
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (key === dayKey(yesterday.toISOString())) return t('chat:yesterday');
    return new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' });
  };

  const timeLabel = (iso: string): string =>
    new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <MessagesShell selectedUserId={userId}>
      {/* ── Cabecera de la conversación ── */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Volver a la lista. Sólo hace falta en celular, donde la lista está
              escondida; en escritorio está al lado. Si la media query fallara se
              vería una flecha de más, nunca una pantalla sin salida. */}
          <Link
            to="/messages"
            aria-label={t('chat:backToList')}
            className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 lg:hidden"
          >
            <Icon name="chevron-left" className="h-5 w-5" />
          </Link>

          <Link to={`/users/${userId}`} className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 font-bold uppercase text-primary"
            >
              {otherName.charAt(0)}
            </span>
            <span className="truncate font-display font-semibold text-gray-900 dark:text-gray-100">
              {otherName}
            </span>
          </Link>
        </div>

        {/* Mark-unread is hidden here: viewing this page re-marks the
            conversation read on every refetch, which would silently undo it. */}
        <ConversationActionsMenu
          otherUserId={userId}
          otherUserName={otherName}
          showMarkUnread={false}
          onHidden={() => navigate('/messages')}
        />
      </div>

      {/* ── Los mensajes ── */}
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-1 overflow-y-auto bg-gray-50 px-4 py-4 dark:bg-gray-950/40"
      >
        {isLoading ? (
          <div className="py-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">{t('chat:loadingMessages')}</p>
          </div>
        ) : isError ? (
          <div className="py-12 text-center">
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('chat:loadError')}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              {t('chat:retry')}
            </button>
          </div>
        ) : !messages?.length ? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('chat:empty')}
          </div>
        ) : (
          messages.map((msg: Message, i: number) => {
            const isOwn = msg.sender_id === user?.id;
            // El separador se dibuja cuando cambia el día respecto del mensaje
            // anterior; el primero siempre lo lleva.
            const prev = i > 0 ? messages[i - 1] : undefined;
            const showDay = !prev || dayKey(prev.created_at) !== dayKey(msg.created_at);

            return (
              <div key={msg.id}>
                {showDay && (
                  <div className="my-3 flex justify-center" data-testid="day-divider">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-400">
                      {dayLabel(msg.created_at)}
                    </span>
                  </div>
                )}

                <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                  <span className="mb-1 px-1 text-xs text-gray-400 dark:text-gray-500">
                    {isOwn ? t('chat:you') : otherName} · {timeLabel(msg.created_at)}
                  </span>
                  <div
                    className={`max-w-xs whitespace-pre-wrap break-words px-4 py-2 text-sm lg:max-w-md ${
                      isOwn
                        ? 'rounded-2xl rounded-br-md bg-primary text-white'
                        : 'rounded-2xl rounded-bl-md border border-gray-100 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Remote typing indicator */}
        {remoteTyping && (
          <div className="mt-1 flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-gray-100 bg-white px-4 py-2 text-sm italic text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
              {t('chat:typing')}
            </div>
          </div>
        )}
      </div>

      {/* Send form (or blocked banner). While the block status loads we
          render neither, to avoid flashing the form at a blocked user. */}
      {isBlockStatusLoading ? null : isBlocked ? (
        <div className="shrink-0 border-t border-gray-100 px-4 py-4 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {t('chat:actions.blockedBanner')}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex shrink-0 items-end gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800"
        >
          <textarea
            value={input}
            onChange={handleInputChange}
            placeholder={t('chat:inputPlaceholder')}
            rows={1}
            className="flex-1 resize-none rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
          />
          {/* El botón queda sin texto visible, así que el nombre accesible sale
              del `aria-label`: sin él un lector de pantalla anuncia "botón" y
              nada más. El ícono va `aria-hidden` desde el propio componente. */}
          <button
            type="submit"
            disabled={!input.trim() || sendMessageTo.isPending}
            aria-label={t('chat:send')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            <Icon name="send" className="h-5 w-5" />
          </button>
        </form>
      )}

      {sendError && (
        <div
          role="status"
          // bottom-16: ConversationActionsMenu's toast owns the bottom-4 slot;
          // both can be visible within the same 3s window and must not overlap.
          className="fixed bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
        >
          {sendError}
        </div>
      )}
    </MessagesShell>
  );
}
