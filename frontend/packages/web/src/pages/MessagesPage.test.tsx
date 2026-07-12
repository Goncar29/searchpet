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
    expect(screen.getByText('messages:empty')).toBeTruthy();
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
});
