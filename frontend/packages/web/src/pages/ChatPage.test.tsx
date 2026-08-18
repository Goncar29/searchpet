import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatPage } from './ChatPage';
import type { WsEnvelope, WsConnectionState, UseWebSocketOptions } from '@shared/hooks';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'user-1', name: 'Me' },
  }),
}));

const navigateMock = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ userId: 'user-2' }),
    useNavigate: () => navigateMock,
  };
});

const usePublicProfileMock = vi.fn();
const useBlockStatusMock = vi.fn();
const sendMessageToMutateMock = vi.fn();

vi.mock('@shared/hooks', () => ({
  useConversation: vi.fn(),
  // `useConversations` (en plural) no lo llama ChatPage sino el `MessagesShell`
  // que ahora la envuelve: la lista de la izquierda y el hilo comparten
  // pantalla. Un hook que aparece en el árbol y no en este mock no rompe con un
  // error de assert sino con "No export is defined on the mock", que tira TODOS
  // los tests del archivo — incluido el que sólo dice "renderiza sin lanzar
  // errores". Mismo contrato que los smoke tests de mobile (regla #17).
  useConversations: vi.fn(() => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() })),
  useSendMessageTo: () => ({ mutate: sendMessageToMutateMock, isPending: false }),
  useWebSocket: vi.fn(() => ({ connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() })),
  usePublicProfile: (...args: unknown[]) => usePublicProfileMock(...args),
  useBlockStatus: (...args: unknown[]) => useBlockStatusMock(...args),
}));

// Stub that captures the props ChatPage passes to the menu, so tests can
// assert the integration (ids, onHidden wiring) without re-testing the
// menu's internals (covered in ConversationActionsMenu.test.tsx).
interface CapturedMenuProps {
  otherUserId: string;
  otherUserName: string;
  onHidden?: () => void;
  showMarkUnread?: boolean;
}
let capturedMenuProps: CapturedMenuProps | null = null;
// Ademas del ultimo, TODOS: desde que la lista comparte pantalla con el hilo hay
// varios menus a la vez (uno por fila + el de la cabecera), y "el ultimo" no
// alcanza para afirmar nada sobre una fila en particular.
let capturedMenuList: CapturedMenuProps[] = [];

vi.mock('../components/ConversationActionsMenu', () => ({
  ConversationActionsMenu: (props: CapturedMenuProps) => {
    capturedMenuProps = props;
    capturedMenuList.push(props);
    return <button aria-label="chat:actions.menuLabel">menu</button>;
  },
}));

import { useConversation, useConversations, useWebSocket } from '@shared/hooks';

// Helper to build a minimal mock return value for useConversation
// Cast through unknown to satisfy TS6's stricter overlap checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConversation = (data: any[], isLoading: boolean, extra: object = {}) =>
  ({ data, isLoading, isError: false, refetch: vi.fn(), ...extra }) as unknown as ReturnType<
    typeof useConversation
  >;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ChatPage', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    sendMessageToMutateMock.mockReset();
    capturedMenuProps = null;
    capturedMenuList = [];
    usePublicProfileMock.mockReturnValue({ data: { id: 'user-2', name: 'Alice' } });
    useBlockStatusMock.mockReturnValue({ isBlocked: false, isLoading: false });
    // La lista del shell vuelve a vacio en cada test. Sin esto, el unico que la
    // puebla con `mockReturnValue` se la deja puesta a todos los que siguen —
    // no rompe nada hoy, pero es la clase de acoplamiento entre tests que se
    // cobra cuando alguien reordena el archivo.
    vi.mocked(useConversations).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('renderiza sin lanzar errores', () => {
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));
    render(<ChatPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra indicador de carga cuando isLoading es true', () => {
    vi.mocked(useConversation).mockReturnValue(mockConversation([], true));
    render(<ChatPage />, { wrapper });
    expect(screen.getByText('chat:loadingMessages')).toBeTruthy();
  });

  it('renderiza lista de mensajes cuando hay datos', () => {
    vi.mocked(useConversation).mockReturnValue(mockConversation([
      { id: 'msg-1', sender_id: 'user-1', receiver_id: 'user-2', content: 'Hola', is_read: true, created_at: new Date().toISOString() },
      { id: 'msg-2', sender_id: 'user-2', receiver_id: 'user-1', content: 'Buenas!', is_read: false, created_at: new Date().toISOString() },
    ], false));

    render(<ChatPage />, { wrapper });

    expect(screen.getByText('Hola')).toBeTruthy();
    expect(screen.getByText('Buenas!')).toBeTruthy();
  });

  it('renderiza mensajes propios y del otro participante', () => {
    vi.mocked(useConversation).mockReturnValue(mockConversation([
      { id: 'msg-1', sender_id: 'user-1', receiver_id: 'user-2', content: 'Mensaje propio', is_read: true, created_at: new Date().toISOString() },
      { id: 'msg-2', sender_id: 'user-2', receiver_id: 'user-1', content: 'Mensaje del otro', is_read: false, created_at: new Date().toISOString() },
    ], false));

    render(<ChatPage />, { wrapper });

    expect(screen.getByText('Mensaje propio')).toBeTruthy();
    expect(screen.getByText('Mensaje del otro')).toBeTruthy();
  });

  it('muestra indicador de escritura cuando useWebSocket captura typing_start', async () => {
    let capturedOnMessage: ((env: WsEnvelope) => void) | null = null;

    vi.mocked(useWebSocket).mockImplementationOnce(
      ({ onMessage }: UseWebSocketOptions) => {
        capturedOnMessage = onMessage;
        return { connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() };
      }
    );

    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    await act(async () => {
      capturedOnMessage?.({ type: 'typing_start', payload: { from: 'user-2', to: 'user-1' } });
    });

    expect(screen.getByText('chat:typing')).toBeTruthy();
  });

  it('muestra el nombre de la contraparte como link al perfil publico', () => {
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    const link = screen.getByText('Alice').closest('a');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/users/user-2');
  });

  it('muestra el boton del menu de acciones con las props de la conversacion; onHidden navega a /messages', () => {
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    expect(screen.getByLabelText('chat:actions.menuLabel')).toBeTruthy();
    expect(capturedMenuProps?.otherUserId).toBe('user-2');
    expect(capturedMenuProps?.otherUserName).toBe('Alice');

    capturedMenuProps?.onHidden?.();
    expect(navigateMock).toHaveBeenCalledWith('/messages');
  });

  it('muestra estado de error con botón de reintento cuando la conversación no carga', () => {
    const refetchMock = vi.fn();
    vi.mocked(useConversation).mockReturnValue(
      mockConversation([], false, { data: undefined, isError: true, refetch: refetchMock })
    );

    render(<ChatPage />, { wrapper });

    expect(screen.getByText('chat:loadError')).toBeTruthy();
    // The error state must not masquerade as an empty thread.
    expect(screen.queryByText('chat:empty')).toBeNull();

    fireEvent.click(screen.getByText('chat:retry'));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('muestra un toast de error y restaura el texto escrito cuando el envío falla', () => {
    sendMessageToMutateMock.mockImplementation(
      (_data: unknown, opts?: { onError?: (err: Error) => void }) =>
        opts?.onError?.(new Error('boom'))
    );
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    const textarea = screen.getByPlaceholderText('chat:inputPlaceholder') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hola' } });
    fireEvent.submit(textarea.closest('form')!);

    // getErrorMessage falls back to errors:unknown_error for plain Errors.
    expect(screen.getByRole('status').textContent).toBe('errors:unknown_error');
    // The typed text is restored so the user can retry.
    expect(textarea.value).toBe('Hola');
  });

  it('no muestra toast de error cuando el envío es exitoso', () => {
    sendMessageToMutateMock.mockImplementation(
      (_data: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
    );
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    const textarea = screen.getByPlaceholderText('chat:inputPlaceholder') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hola' } });
    fireEvent.submit(textarea.closest('form')!);

    expect(sendMessageToMutateMock).toHaveBeenCalledWith(
      { receiverID: 'user-2', senderID: 'user-1', content: 'Hola' },
      expect.anything()
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(textarea.value).toBe('');
  });

  it('oculta el input y muestra el banner de bloqueo cuando useBlockStatus indica isBlocked true', () => {
    useBlockStatusMock.mockReturnValue({ isBlocked: true, isLoading: false });
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    expect(screen.queryByPlaceholderText('chat:inputPlaceholder')).toBeNull();
    expect(screen.getByText('chat:actions.blockedBanner')).toBeTruthy();
  });

  it('cuando el chequeo de bloqueo falla, el formulario se muestra y no aparece el banner de bloqueo', () => {
    // Contract: on block-status error the check must not pretend it
    // succeeded. The form still renders (the backend enforces blocking with
    // 403, surfaced by the send-error toast) and no blocked banner shows.
    useBlockStatusMock.mockReturnValue({ isBlocked: false, isLoading: false, isError: true });
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    expect(screen.getByPlaceholderText('chat:inputPlaceholder')).toBeTruthy();
    expect(screen.queryByText('chat:actions.blockedBanner')).toBeNull();
  });

  it('no muestra ni el input ni el banner mientras el estado de bloqueo carga', () => {
    useBlockStatusMock.mockReturnValue({ isBlocked: false, isLoading: true });
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    expect(screen.queryByPlaceholderText('chat:inputPlaceholder')).toBeNull();
    expect(screen.queryByText('chat:actions.blockedBanner')).toBeNull();
  });

  // ── Lo que trajo el rediseño ──

  it('el boton de enviar quedo sin texto, asi que su nombre accesible tiene que venir del aria-label', () => {
    // El diseño lo dibuja como un circulo con un avioncito. Un boton cuyo unico
    // contenido es un <svg aria-hidden> se anuncia como "boton" y nada mas: el
    // aria-label ES el nombre accesible, no un extra.
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    const enviar = screen.getByRole('button', { name: 'chat:send' });
    expect(enviar.getAttribute('type')).toBe('submit');
  });

  it('agrupa por dia: un separador por dia, no uno por mensaje', () => {
    const hoy = new Date();
    const anteayer = new Date(hoy);
    anteayer.setDate(hoy.getDate() - 2);

    vi.mocked(useConversation).mockReturnValue(mockConversation([
      { id: 'msg-1', sender_id: 'user-2', receiver_id: 'user-1', content: 'viejo A', is_read: true, created_at: anteayer.toISOString() },
      { id: 'msg-2', sender_id: 'user-1', receiver_id: 'user-2', content: 'viejo B', is_read: true, created_at: anteayer.toISOString() },
      { id: 'msg-3', sender_id: 'user-2', receiver_id: 'user-1', content: 'nuevo', is_read: false, created_at: hoy.toISOString() },
    ], false));

    render(<ChatPage />, { wrapper });

    // Se cuentan los SEPARADORES, no las etiquetas "hoy".
    //
    // La primera version de este test afirmaba `getAllByText('chat:today')`
    // con largo 1 y **quedaba verde con el bug puesto**: con un separador por
    // mensaje hay TRES, pero solo uno dice "hoy" — los otros dos son la fecha
    // de anteayer. Verificado en rojo recien despues de cambiarlo: la asercion
    // vieja no medía lo que su nombre decía (regla #41).
    expect(screen.getAllByTestId('day-divider')).toHaveLength(2);
    expect(screen.getAllByText('chat:today')).toHaveLength(1);
    // Anteayer no es "ayer", asi que cae en la fecha formateada.
    expect(screen.queryByText('chat:yesterday')).toBeNull();
  });

  it('cada burbuja dice de quien es y a que hora', () => {
    const ahora = new Date();
    vi.mocked(useConversation).mockReturnValue(mockConversation([
      { id: 'msg-1', sender_id: 'user-1', receiver_id: 'user-2', content: 'mio', is_read: true, created_at: ahora.toISOString() },
      { id: 'msg-2', sender_id: 'user-2', receiver_id: 'user-1', content: 'suyo', is_read: false, created_at: ahora.toISOString() },
    ], false));

    render(<ChatPage />, { wrapper });

    // La hora se arma con toLocaleTimeString, asi que el string exacto depende
    // del runner; lo que importa es de quien dice que es cada mensaje.
    // 'Alice' sale del perfil publico mockeado en beforeEach.
    expect(screen.getByText(/^chat:you ·/)).toBeTruthy();
    expect(screen.getByText(/^Alice ·/)).toBeTruthy();
  });

  it('la fila abierta se marca con aria-current, no solo con un color', () => {
    // En escritorio las dos columnas comparten pantalla, asi que hay que poder
    // saber CUAL esta abierta. El diseño lo resuelve con una barra naranja: eso
    // es invisible para un lector de pantalla y para quien no distingue ese
    // color. `aria-current="page"` es la version que si se anuncia.
    vi.mocked(useConversations).mockReturnValue({
      data: [
        { id: 'c-1', sender_id: 'user-2', receiver_id: 'user-1', content: 'hola', is_read: false, created_at: new Date().toISOString(), sender: { id: 'user-2', name: 'Alice' } },
        { id: 'c-2', sender_id: 'user-9', receiver_id: 'user-1', content: 'otra', is_read: true, created_at: new Date().toISOString(), sender: { id: 'user-9', name: 'Otro' } },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    render(<ChatPage />, { wrapper });

    // `useParams` esta mockeado a user-2, asi que esa fila es la abierta.
    const abiertas = screen.getAllByRole('link', { current: 'page' });
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0].getAttribute('href')).toBe('/messages/user-2');

    // Y "marcar como no leida" no se ofrece en NINGUN menu de la conversacion
    // abierta —ni el de la cabecera ni el de su fila—, porque mirarla la vuelve
    // a marcar leida en cada refetch y la accion se deshace sola. La fila que NO
    // esta abierta si lo ofrece.
    const deLaAbierta = capturedMenuList.filter((p) => p.otherUserId === 'user-2');
    expect(deLaAbierta.length).toBeGreaterThan(0);
    expect(deLaAbierta.every((p) => p.showMarkUnread === false)).toBe(true);
    expect(capturedMenuList.find((p) => p.otherUserId === 'user-9')?.showMarkUnread).toBe(true);
  });

  it('un mensaje entrante refresca TAMBIEN la lista de la izquierda, no solo el hilo', () => {
    // La lista y el hilo ahora comparten pantalla. `['messages', userId]` sola
    // dejaria la fila de al lado mostrando el mensaje anterior como ultimo, y
    // eso no se ve como un bug: se ve como una fila desactualizada.
    let capturedOnMessage: ((env: WsEnvelope) => void) | null = null;
    vi.mocked(useWebSocket).mockImplementationOnce(({ onMessage }: UseWebSocketOptions) => {
      capturedOnMessage = onMessage;
      return { connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() };
    });
    vi.mocked(useConversation).mockReturnValue(mockConversation([], false));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ChatPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Dentro de `act`, como el test del indicador de escritura: ademas de ser lo
    // correcto para un handler que puede tocar estado, es lo que evita que TS
    // estreche `capturedOnMessage` a `null` — la asignacion ocurre adentro de un
    // callback que el analisis de flujo no ve.
    act(() => {
      capturedOnMessage?.({
        type: 'chat_message',
        payload: { id: 'm', from: 'user-2', to: 'user-1', body: 'hola', timestamp: '' },
      });
    });

    const claves = spy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(claves).toContain(JSON.stringify({ queryKey: ['messages', 'user-2'] }));
    expect(claves).toContain(JSON.stringify({ queryKey: ['messages'], exact: true }));
  });
});
