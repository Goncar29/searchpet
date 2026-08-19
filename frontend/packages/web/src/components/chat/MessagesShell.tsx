import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useConversations } from '@shared/hooks';
import type { Message } from '@shared/types';
import { useAuth } from '../../context/AuthContext';
import { Icon } from '../Icon';
import { ConversationActionsMenu } from '../ConversationActionsMenu';

/**
 * Alto de los dos paneles, en un solo lugar.
 *
 * Va acá y no repetido en cada uno porque si divergen NO se ve como un bug: se
 * ve como una columna un poco más alta que la otra, y nadie lo mira dos veces.
 *
 * `dvh` y no `vh`: en un celular la barra de direcciones se colapsa al scrollear
 * y `100vh` mide el viewport SIN colapsar, así que el panel queda más alto que
 * la pantalla y el compositor de mensajes se va abajo del pliegue — justo en el
 * dispositivo desde el que se usa un chat. Si el navegador no entiende `dvh` la
 * declaración entera es inválida y la altura queda en `auto`: el panel crece con
 * su contenido en vez de desaparecer (regla #29, fallar abierto).
 *
 * 7rem = 4rem del navbar (`h-16`, sticky) + 3rem del `py-6` del contenedor.
 */
const PANE_HEIGHT = 'h-[calc(100dvh-7rem)]';

const PANE_BASE =
  'flex flex-col overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm';

export interface ConversationRow {
  otherUserId: string;
  otherUserName: string;
  preview: string;
  createdAt: string;
  unread: boolean;
  /** El último mensaje lo escribí yo. Decide el prefijo "Vos:" del preview. */
  fromMe: boolean;
  /**
   * Fila sintética: la conversación está ABIERTA pero todavía no tiene ni un
   * mensaje, así que el backend no la devuelve. No tiene fecha ni acciones.
   */
  isNew?: boolean;
}

/**
 * Convierte la respuesta del endpoint —un mensaje por contraparte— en las filas
 * que dibuja la lista.
 *
 * Está afuera del componente porque es la única parte con reglas de negocio: de
 * quién es el mensaje, contra quién es la conversación, y si está sin leer. El
 * resto del panel es marcado.
 */
export function deriveConversationRows(
  conversations: Message[],
  currentUserId: string | undefined,
  unknownName: string,
): ConversationRow[] {
  return conversations.map((msg) => {
    const iAmSender = msg.sender_id === currentUserId;
    const other = iAmSender ? msg.receiver : msg.sender;
    return {
      otherUserId: iAmSender ? msg.receiver_id : msg.sender_id,
      otherUserName: other?.name ?? unknownName,
      preview: msg.content,
      createdAt: msg.created_at,
      // Sin leer sólo si soy YO el destinatario: un mensaje propio nunca está
      // "sin leer" para quien lo escribió.
      unread: !msg.is_read && msg.receiver_id === currentUserId,
      fromMe: iAmSender,
    };
  });
}

export function timeAgo(dateStr: string, t: (key: string, opts?: object) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return t('common:timeAgo.daysAgo', { count: days });
  if (hours > 0) return t('common:timeAgo.hoursAgo', { count: hours });
  return t('common:timeAgo.minutesAgo', { count: Math.max(1, minutes) });
}

interface MessagesShellProps {
  /** Conversación abierta, si la hay. Decide qué panel se ve en celular. */
  selectedUserId?: string;
  /**
   * Nombre de la contraparte abierta. Lo sabe la página (lo trae de
   * `usePublicProfile`), no el shell, y hace falta para dibujar la fila de una
   * conversación que todavía no tiene mensajes.
   */
  selectedUserName?: string;
  /** Panel derecho: la conversación, o el cartel de "elegí una". */
  children: ReactNode;
}

/**
 * Las dos columnas de Mensajes: la lista a la izquierda, la conversación a la
 * derecha, como en el diseño de Stitch.
 *
 * LAS DOS RUTAS SE CONSERVAN. `/messages` y `/messages/:userId` siguen
 * existiendo y siendo enlazables — el detalle de una mascota linkea directo a la
 * segunda. Lo que cambia es que en escritorio cada una dibuja las DOS columnas y
 * en celular sólo la que corresponde. Colapsarlas en una sola ruta habría roto
 * los links de afuera y el botón de atrás del celular, que es el único gesto que
 * tiene un usuario para volver de una conversación.
 *
 * ESTE COMPONENTE NO ABRE EL WEBSOCKET, y no es un olvido: `useWebSocket` abre
 * una conexión POR MONTAJE (lo dice su propio encabezado), así que si el shell
 * llamara al hook además de la página, cada pantalla de chat sostendría DOS
 * sockets contra un backend gratuito. La página dueña de la ruta abre uno solo y
 * su `onMessage` invalida tanto `['messages']` (esta lista) como
 * `['messages', userId]` (el hilo). Si alguna vez hace falta refrescar la lista
 * desde acá, se agrega una prop — no un segundo hook.
 */
export function MessagesShell({ selectedUserId, selectedUserName, children }: MessagesShellProps) {
  const { t } = useTranslation(['messages', 'common']);
  const { user } = useAuth();
  const [query, setQuery] = useState('');

  // Misma clave que usa la página: React Query comparte la caché, así que
  // montar el shell en las dos rutas no agrega un solo request.
  const { data: conversations, isLoading, isError, refetch } = useConversations();

  const reales = useMemo(
    () => deriveConversationRows(conversations ?? [], user?.id, t('common:unknownUser')),
    [conversations, user?.id, t],
  );

  /**
   * La conversación abierta SIEMPRE tiene su fila, aunque todavía no exista.
   *
   * EL INVARIANTE ES "la fila marcada es con quién estás hablando", y sin esto
   * tenía una excepción justo donde más duele. Se llega a `/messages/:userId`
   * desde el detalle de una mascota —"Contactar al dueño" y "Contactar al
   * reportero"— con alguien con quien nunca hablaste, así que la lista no lo
   * contiene y NINGUNA fila queda marcada. Entonces el único nombre en negrita
   * de la pantalla es el de OTRA persona, y la identidad real del hilo queda en
   * un renglón chico de la cabecera, al lado de un compositor listo para enviar.
   *
   * Le pasó a una usuaria de verdad y el mensaje salió a quien no era: entró por
   * una callejera, la lista mostraba sólo "Admin Local" sin marcar, escribió, y
   * el mensaje se fue al reportero de la mascota. Antes del rediseño esto no
   * podía pasar porque esta pantalla no mostraba ninguna lista.
   *
   * La fila va ARRIBA y entra al mismo filtro y al mismo render que las reales:
   * un camino aparte para "la de arriba" es cómo se cuela la próxima excepción.
   */
  const rows = useMemo(() => {
    if (!selectedUserId || reales.some((r) => r.otherUserId === selectedUserId)) return reales;
    return [
      {
        otherUserId: selectedUserId,
        otherUserName: selectedUserName || t('common:unknownUser'),
        preview: t('messages:newConversation'),
        createdAt: '',
        unread: false,
        fromMe: false,
        isNew: true,
      },
      ...reales,
    ];
  }, [reales, selectedUserId, selectedUserName, t]);

  // El filtro es del lado del cliente A PROPÓSITO: la lista ya está entera en
  // memoria (el endpoint devuelve un mensaje por contraparte, no hay paginado),
  // así que buscar en el servidor sería un request por tecla para recortar algo
  // que ya tenemos. Busca por nombre Y por contenido: quien busca "collar"
  // se acuerda de lo que escribió, no de con quién.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return { filas: rows, coincidencias: rows.length };

    const coinciden = rows.filter(
      (row) =>
        row.otherUserName.toLowerCase().includes(needle) ||
        row.preview.toLowerCase().includes(needle),
    );

    // LA FILA ABIERTA NO SE FILTRA NUNCA.
    //
    // El buscador elige QUÉ CONVERSACIONES MIRÁS, no EN CUÁL ESTÁS. Sin esta
    // excepción, buscar un nombre que no es el de la conversación abierta deja
    // la pantalla en el estado exacto que causó el incidente: un solo nombre en
    // negrita —el de OTRA persona—, la identidad real del hilo en un renglón
    // chico de la cabecera, y el compositor armado. Medido: con el hilo de Ana
    // abierto, buscar "bruno" dejaba `aria-current` en CERO filas.
    //
    // Le pasa igual a una conversación real que a una recién estrenada, así que
    // la exención va acá —después de filtrar, sobre `rows`— y no dentro de la
    // rama que arma la fila sintética: ahí sólo cubriría la mitad de los casos.
    //
    // Va primero y no en su lugar natural porque cuando el filtro la descarta,
    // su papel deja de ser "un resultado más" y pasa a ser "acá estás parado".
    if (selectedUserId && !coinciden.some((r) => r.otherUserId === selectedUserId)) {
      const abierta = rows.find((r) => r.otherUserId === selectedUserId);
      if (abierta) return { filas: [abierta, ...coinciden], coincidencias: coinciden.length };
    }

    return { filas: coinciden, coincidencias: coinciden.length };
  }, [rows, query, selectedUserId]);

  const { filas, coincidencias } = filtered;

  /**
   * "Ninguna conversación coincide" mira las COINCIDENCIAS, no las filas.
   *
   * Desde que la fila abierta se fija, la lista nunca queda vacía mientras haya
   * una conversación abierta — así que atarlo a `filas.length === 0` habría
   * dejado el cartel mudo justo cuando hace falta: el usuario buscaría algo que
   * no existe, vería una sola fila, y creería que ESA es el resultado.
   */
  const sinCoincidencias = query.trim() !== '' && coincidencias === 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ── Panel izquierdo: la lista ──
            En celular se esconde cuando hay una conversación abierta. Si la
            media query no aplicara, el peor caso es ver una sola columna: o sea
            exactamente el comportamiento que la app tenía antes de esto. */}
        <aside
          className={`${PANE_BASE} ${PANE_HEIGHT} ${selectedUserId ? 'hidden lg:flex' : 'flex'}`}
        >
          <div className="shrink-0 border-b border-gray-100 dark:border-gray-800 p-4">
            <h1 className="font-display text-headline text-gray-900 dark:text-gray-100 mb-3">
              {t('messages:title')}
            </h1>
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t('messages:searchLabel')}
                placeholder={t('messages:searchPlaceholder')}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('messages:loading')}
                </p>
              </div>
            ) : isError ? (
              <div className="py-12 text-center">
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                  {t('messages:loadError')}
                </p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  {t('messages:retry')}
                </button>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center px-4">
                <Icon
                  name="chat-bubble"
                  className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600"
                />
                <p className="font-semibold text-gray-900 dark:text-gray-100">
                  {t('messages:emptyTitle')}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t('messages:emptySubtitle')}
                </p>
              </div>
            ) : (
              <>
                {/* Lista con datos pero filtro sin resultados. Es un estado
                    distinto del vacío de verdad: acá el usuario SÍ tiene
                    conversaciones y lo que falla es su búsqueda, así que el
                    texto tiene que decir eso y no "todavía no tenés mensajes".
                    Va ARRIBA y no en lugar de la lista, porque debajo puede
                    quedar la fila de la conversación abierta, que no es un
                    resultado de la búsqueda sino dónde estás parado. */}
                {sinCoincidencias && (
                  <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    {t('messages:noResults', { query: query.trim() })}
                  </p>
                )}
                <ul className="flex flex-col gap-1">
                  {filas.map((row) => {
                  const active = row.otherUserId === selectedUserId;
                  return (
                    /* Keyed by counterpart, not msg.id: the conversations query
                       refetches (poll + WS) and msg.id changes with every new
                       message, which would remount the row and silently destroy
                       the actions menu's state (open menu, dialogs, half-typed
                       report). The endpoint returns one message per counterpart,
                       so otherUserId is unique per row. */
                    <li
                      key={row.otherUserId}
                      className={`flex items-center gap-1 rounded-xl pr-1 transition-colors ${
                        active
                          ? 'bg-primary/10 border-l-4 border-primary'
                          : 'border-l-4 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <Link
                        to={`/messages/${row.otherUserId}`}
                        aria-current={active ? 'page' : undefined}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3"
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-lg font-bold uppercase text-primary"
                        >
                          {row.otherUserName.charAt(0)}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold text-gray-900 dark:text-gray-100">
                              {row.otherUserName}
                            </span>
                            {/* Una conversación sin mensajes no tiene "hace
                                cuánto": inventar una fecha ahí seria afirmar que
                                paso algo que no paso. */}
                            {row.createdAt && (
                              <span className="shrink-0 whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
                                {timeAgo(row.createdAt, t as (key: string, opts?: object) => string)}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2">
                            {/* "Vos:" cuando el ultimo mensaje es propio. La
                                clave ya existia traducida en los tres idiomas y
                                la usaba mobile; la web mostraba el texto pelado,
                                asi que la fila decia lo mismo lo hubiera escrito
                                cualquiera de los dos. */}
                            <span
                              className={`flex-1 truncate text-sm ${
                                row.isNew
                                  ? 'italic text-gray-400 dark:text-gray-500'
                                  : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              {row.fromMe ? t('messages:youPrefix') : ''}
                              {row.preview}
                            </span>
                            {row.unread && (
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                            )}
                          </span>
                        </span>
                      </Link>
                      {/* "Marcar como no leída" se oculta en la fila ABIERTA, y
                          es el mismo motivo por el que ya estaba oculta en la
                          cabecera de la conversación: tenerla a la vista la
                          re-marca leída en cada refetch, así que la acción se
                          deshace sola y en silencio. Antes no hacía falta
                          pensarlo porque la lista y el hilo vivían en pantallas
                          distintas y nunca coincidían; con las dos columnas
                          juntas, la fila abierta es exactamente ese caso. */}
                      {/* La conversación que todavía no existe no lleva menú:
                          "borrar conversación" y "marcar como no leída" no
                          tienen sobre qué operar, y bloquear o denunciar ya
                          están en el menú de la cabecera, que es de esa misma
                          persona. Dos menús para el mismo par serían dos. */}
                      {!row.isNew && (
                        <ConversationActionsMenu
                          otherUserId={row.otherUserId}
                          otherUserName={row.otherUserName}
                          showMarkUnread={!active}
                        />
                      )}
                    </li>
                  );
                  })}
                </ul>
              </>
            )}
          </div>
        </aside>

        {/* ── Panel derecho: la conversación ──
            Escondido en celular mientras no haya ninguna abierta; ahí la lista
            ocupa la pantalla entera, que es lo que se ve hoy. */}
        <section
          className={`${PANE_BASE} ${PANE_HEIGHT} ${selectedUserId ? 'flex' : 'hidden lg:flex'}`}
        >
          {children}
        </section>
      </div>
    </div>
  );
}
