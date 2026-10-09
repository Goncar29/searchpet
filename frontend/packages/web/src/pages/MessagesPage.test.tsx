import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessagesPage } from './MessagesPage';
import type { WsEnvelope, WsConnectionState, UseWebSocketOptions } from '@shared/hooks';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'user-1', name: 'Me' } }),
}));

vi.mock('@shared/hooks', () => ({
  useConversations: vi.fn(),
  useWebSocket: vi.fn(() => ({ connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() })),
}));

// Import after mock registration so vi.fn() is in place
import { useConversations, useWebSocket } from '@shared/hooks';

// Props-capturing stub, mirroring ChatPage.test.tsx's pattern: asserts the
// per-row integration (which ids/names reach the menu, and that the button
// lives outside the row Link) without re-testing the menu's own internals
// (covered in ConversationActionsMenu.test.tsx).
interface CapturedMenuProps {
  otherUserId: string;
  otherUserName: string;
}
// Keyed by otherUserId (last render wins) so extra re-renders never break
// the assertions — pushing to an array would.
let capturedMenuProps: Record<string, CapturedMenuProps> = {};

vi.mock('../components/ConversationActionsMenu', () => ({
  ConversationActionsMenu: (props: CapturedMenuProps) => {
    capturedMenuProps[props.otherUserId] = props;
    return <button aria-label={`chat:actions.menuLabel-${props.otherUserId}`}>menu</button>;
  },
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/messages']}>
        {children}
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  capturedMenuProps = {};
});

describe('MessagesPage', () => {
  it('renderiza sin lanzar errores', () => {
    vi.mocked(useConversations).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra indicador de carga cuando isLoading es true', () => {
    vi.mocked(useConversations).mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
    expect(screen.getByText('messages:loading')).toBeTruthy();
  });

  it('muestra estado vacío cuando no hay conversaciones', () => {
    vi.mocked(useConversations).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
    // `emptyTitle`/`emptySubtitle` en vez del `empty` pelado de antes: las dos
    // claves ya existian traducidas en los tres idiomas y las usaba mobile; la
    // web era la unica que mostraba una linea sola.
    expect(screen.getByText('messages:emptyTitle')).toBeTruthy();
    expect(screen.getByText('messages:emptySubtitle')).toBeTruthy();
  });

  it('el vacio de verdad y el filtro sin resultados son estados DISTINTOS', () => {
    // Con la lista vacia el cartel dice "todavia no tenes mensajes"; con datos
    // y un filtro que no matchea tiene que decir otra cosa, porque el usuario SI
    // tiene conversaciones y lo que fallo fue su busqueda. Reusar el mismo texto
    // le mentiria justo a quien mas contexto necesita.
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Hola',
          is_read: false,
          created_at: new Date().toISOString(),
          sender: { id: 'user-2', name: 'Juan' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    fireEvent.change(screen.getByLabelText('messages:searchLabel'), {
      target: { value: 'no-existe' },
    });

    expect(screen.getByText('messages:noResults')).toBeTruthy();
    expect(screen.queryByText('messages:emptyTitle')).toBeNull();
    expect(screen.queryByText('Juan')).toBeNull();
  });

  it('el buscador filtra por nombre Y por contenido del mensaje', () => {
    // Por contenido tambien, no solo por nombre: quien busca se acuerda de lo
    // que escribio ("el collar rojo"), no siempre de con quien lo hablo.
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'tenia un collar rojo',
          is_read: false,
          created_at: new Date().toISOString(),
          sender: { id: 'user-2', name: 'Juan' },
        },
        {
          id: 'msg-2',
          sender_id: 'user-3',
          receiver_id: 'user-1',
          content: 'lo vi en la plaza',
          is_read: true,
          created_at: new Date().toISOString(),
          sender: { id: 'user-3', name: 'Carla' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });
    const search = screen.getByLabelText('messages:searchLabel');

    // Por nombre, y con mayusculas distintas de las tipeadas.
    fireEvent.change(search, { target: { value: 'cAr' } });
    expect(screen.getByText('Carla')).toBeTruthy();
    expect(screen.queryByText('Juan')).toBeNull();

    // Por contenido: "collar" no aparece en ningun nombre.
    fireEvent.change(search, { target: { value: 'collar' } });
    expect(screen.getByText('Juan')).toBeTruthy();
    expect(screen.queryByText('Carla')).toBeNull();
  });

  it('muestra estado de error con botón de reintento cuando la query falla', () => {
    const refetchMock = vi.fn();
    vi.mocked(useConversations).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    expect(screen.getByText('messages:loadError')).toBeTruthy();
    // The error state must not masquerade as an empty inbox.
    expect(screen.queryByText('messages:empty')).toBeNull();

    fireEvent.click(screen.getByText('messages:retry'));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renderiza filas de conversaciones cuando hay datos', () => {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Hola, encontré tu perro',
          is_read: false,
          created_at: new Date().toISOString(),
          sender: { id: 'user-2', name: 'Juan' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    expect(screen.getByText('Juan')).toBeTruthy();
    expect(screen.getByText('Hola, encontré tu perro')).toBeTruthy();
  });

  it('muestra el nombre del receptor cuando el usuario actual envió el último mensaje', () => {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-1',
          receiver_id: 'user-2',
          content: 'Hola, vi a tu gata',
          is_read: true,
          created_at: new Date().toISOString(),
          sender: { id: 'user-1', name: 'Me' },
          receiver: { id: 'user-2', name: 'Carla' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    // The counterpart is the receiver — never the current user's own name,
    // and never the raw UUID.
    expect(screen.getByText('Carla')).toBeTruthy();
    expect(screen.queryByText('Me')).toBeNull();
    expect(screen.queryByText('user-2')).toBeNull();
  });

  it('marca con "Vos:" el preview cuando el ultimo mensaje es propio, y no cuando es del otro', () => {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-1',
          receiver_id: 'user-2',
          content: 'yo escribi esto',
          is_read: true,
          created_at: new Date().toISOString(),
          sender: { id: 'user-1', name: 'Me' },
          receiver: { id: 'user-2', name: 'Carla' },
        },
        {
          id: 'msg-2',
          sender_id: 'user-3',
          receiver_id: 'user-1',
          content: 'esto lo escribio el',
          is_read: false,
          created_at: new Date().toISOString(),
          sender: { id: 'user-3', name: 'Juan' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    // Sin el prefijo, las dos filas se leen igual y no hay forma de saber si
    // el otro contesto o si el ultimo turno sigue siendo tuyo.
    expect(screen.getByText('messages:youPrefixyo escribi esto')).toBeTruthy();
    expect(screen.getByText('esto lo escribio el')).toBeTruthy();
  });

  it('el buscador ignora el prefijo "Vos:" y busca en el texto real', () => {
    // El prefijo es decoracion del render, no parte del mensaje: si entrara al
    // filtro, tipear "vos" devolveria todas las conversaciones propias como si
    // alguien hubiera escrito esa palabra.
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-1',
          receiver_id: 'user-2',
          content: 'ya voy para alla',
          is_read: true,
          created_at: new Date().toISOString(),
          sender: { id: 'user-1', name: 'Me' },
          receiver: { id: 'user-2', name: 'Carla' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    fireEvent.change(screen.getByLabelText('messages:searchLabel'), {
      target: { value: 'youPrefix' },
    });

    expect(screen.getByText('messages:noResults')).toBeTruthy();
  });

  it('cae a common:unknownUser si el backend no trae el usuario', () => {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Hola',
          is_read: true,
          created_at: new Date().toISOString(),
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    expect(screen.getByText('common:unknownUser')).toBeTruthy();
    expect(screen.queryByText('user-2')).toBeNull();
  });

  it('renderiza un botón de menú de acciones por cada fila de conversación', () => {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Hola',
          is_read: false,
          created_at: new Date().toISOString(),
          sender: { id: 'user-2', name: 'Juan' },
        },
        {
          id: 'msg-2',
          sender_id: 'user-1',
          receiver_id: 'user-3',
          content: 'Vi a tu gata',
          is_read: true,
          created_at: new Date().toISOString(),
          sender: { id: 'user-1', name: 'Me' },
          receiver: { id: 'user-3', name: 'Carla' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    // Las dos filas llevan menu porque en `/messages` no hay ninguna
    // conversacion abierta. La fila ABIERTA no lleva ninguno —su menu es el de
    // la cabecera— y ese guard vive en ChatPage.test.tsx, que es donde hay una.
    expect(capturedMenuProps).toEqual({
      'user-2': { otherUserId: 'user-2', otherUserName: 'Juan' },
      'user-3': { otherUserId: 'user-3', otherUserName: 'Carla' },
    });
    expect(screen.getByLabelText('chat:actions.menuLabel-user-2')).toBeTruthy();
    expect(screen.getByLabelText('chat:actions.menuLabel-user-3')).toBeTruthy();
  });

  it('el clic en el menú de acciones no navega a la conversación (no burbujea al Link de la fila)', () => {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Hola',
          is_read: false,
          created_at: new Date().toISOString(),
          sender: { id: 'user-2', name: 'Juan' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    fireEvent.click(screen.getByLabelText('chat:actions.menuLabel-user-2'));

    expect(screen.getByTestId('location').textContent).toBe('/messages');
  });

  it('un chat_message NO invalida la lista: lo cubre el prefijo de MainLayout', () => {
    // ANTES esta pantalla invalidaba `['messages']` (sin exact) ante
    // chat_message Y badge_update, por su cuenta. Desde que useWebSocket
    // comparte UNA sola conexion por sesion, MainLayout esta SIEMPRE suscrito
    // mientras hay sesion y su propio onMessage ya invalida ese mismo prefijo
    // ante chat_message — repetirlo aca era la misma consulta dos veces.
    // Depender de MainLayout es seguro solo porque esta pantalla se monta
    // SIEMPRE dentro de el (ver el guard de nesting en
    // App.routeNesting.test.tsx).
    let capturedOnMessage: ((env: WsEnvelope) => void) | null = null;
    vi.mocked(useWebSocket).mockImplementationOnce(({ onMessage }: UseWebSocketOptions) => {
      capturedOnMessage = onMessage;
      return { connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() };
    });
    vi.mocked(useConversations).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useConversations
    >);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/messages']}>
          <MessagesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    act(() => {
      capturedOnMessage?.({
        type: 'chat_message',
        payload: { id: 'm', from: 'user-2', to: 'user-1', body: 'hola', timestamp: '' },
      });
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('un badge_update SI invalida la lista, y es lo UNICO que invalida', () => {
    // La mitad que NO cambio: MainLayout no toca la lista ante un
    // badge_update (solo el contador de no leidos), asi que MessagesPage
    // sigue siendo quien tiene que hacerlo.
    let capturedOnMessage: ((env: WsEnvelope) => void) | null = null;
    vi.mocked(useWebSocket).mockImplementationOnce(({ onMessage }: UseWebSocketOptions) => {
      capturedOnMessage = onMessage;
      return { connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() };
    });
    vi.mocked(useConversations).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useConversations
    >);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/messages']}>
          <MessagesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    act(() => {
      capturedOnMessage?.({ type: 'badge_update', payload: { count: 3 } } as unknown as WsEnvelope);
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['messages'] });
  });
});

// The unread dot is a colored circle with no text: a screen reader had no way
// to tell an unread conversation from a read one. The row's link now carries a
// visually hidden "unread" label, only on the rows that have unread messages.
describe('MessagesPage — punto de no leído accesible', () => {
  function renderWith(unreadCount: number) {
    vi.mocked(useConversations).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Hola',
          is_read: unreadCount === 0,
          unread_count: unreadCount,
          created_at: new Date().toISOString(),
          sender: { id: 'user-2', name: 'Juan' },
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
  }

  it('la fila con no leídos lo dice en su nombre accesible', () => {
    renderWith(2);
    expect(screen.getByRole('link', { name: /Juan.*messages:unreadLabel/ })).toBeTruthy();
  });

  it('la fila sin no leídos no lo dice', () => {
    renderWith(0);
    expect(screen.getByRole('link', { name: /Juan/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /messages:unreadLabel/ })).toBeNull();
  });
});
