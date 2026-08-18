import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessagesPage } from './MessagesPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'user-1', name: 'Me' } }),
}));

vi.mock('@shared/hooks', () => ({
  useConversations: vi.fn(),
  useWebSocket: () => ({ connectionState: 'connected', sendEnvelope: vi.fn() }),
}));

// Import after mock registration so vi.fn() is in place
import { useConversations } from '@shared/hooks';

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
          sender: { id: 'user-2', name: 'Juan' } as any,
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

    // `showMarkUnread: true` en las dos porque en `/messages` no hay ninguna
    // conversacion abierta. La fila ABIERTA lo recibe en false — su guard vive
    // en ChatPage.test.tsx, que es donde hay una.
    expect(capturedMenuProps).toEqual({
      'user-2': { otherUserId: 'user-2', otherUserName: 'Juan', showMarkUnread: true },
      'user-3': { otherUserId: 'user-3', otherUserName: 'Carla', showMarkUnread: true },
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
});
