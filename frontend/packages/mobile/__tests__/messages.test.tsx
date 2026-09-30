// Messages (conversation list) screen smoke test
import React from 'react';
import { render } from '@testing-library/react-native';
import MessagesScreen from '../app/(tabs)/messages';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Tabs: { Screen: () => null },
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

// Mutable auth state so a single mock can cover the authenticated and
// unauthenticated branches.
let mockAuthState: { isAuthenticated: boolean; user: { id: string; name: string } | null };

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) =>
    typeof selector === 'function' ? selector(mockAuthState) : mockAuthState,
}));

const mockUseConversations = jest.fn();

jest.mock('../../shared/hooks', () => ({
  useConversations: () => mockUseConversations(),
  useWebSocket: () => ({ sendEnvelope: jest.fn() }),
}));

const mockConversation = {
  id: 'msg-1',
  sender_id: 'user-2',
  receiver_id: 'user-1',
  content: 'Encontré a tu perro',
  is_read: false,
  created_at: '2024-01-01T10:30:00Z',
  sender: { id: 'user-2', name: 'Alice' },
};

beforeEach(() => {
  mockAuthState = { isAuthenticated: true, user: { id: 'user-1', name: 'Me' } };
  mockUseConversations.mockReturnValue({
    data: undefined,
    isLoading: false,
    refetch: jest.fn(),
    isRefetching: false,
  });
});

describe('MessagesScreen', () => {
  it('muestra el prompt de login cuando el usuario no está autenticado', () => {
    mockAuthState = { isAuthenticated: false, user: null };
    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText(/messages:loginButton/i)).toBeTruthy();
  });

  it('renderiza el spinner mientras cargan las conversaciones', () => {
    mockUseConversations.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const { toJSON } = render(<MessagesScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('lista las conversaciones con el nombre del otro usuario y el último mensaje', () => {
    mockUseConversations.mockReturnValue({
      data: [mockConversation],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText('Alice')).toBeTruthy();
    expect(queryByText('Encontré a tu perro')).toBeTruthy();
  });

  // Rule #60: a failed query must never render like an empty list.
  it('la consulta caída sin datos muestra el cartel de error, no el vacío de "sin conversaciones"', () => {
    mockUseConversations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isPaused: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText('common:loadErrorTitle')).toBeTruthy();
    expect(queryByText('messages:emptyTitle')).toBeNull();
  });

  // Rule #60: offline (isPaused) must not render like the empty state either
  // — ListState checks `isPaused` before `isError`/`isPending` precisely so a
  // first load with no connection doesn't say "no conversations".
  it('sin caché y offline (isPaused), muestra el estado offline en vez del vacío de "sin conversaciones"', () => {
    mockUseConversations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isPaused: true,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText('common:offlineTitle')).toBeTruthy();
    expect(queryByText('messages:emptyTitle')).toBeNull();
  });

  it('con conversaciones cacheadas y un refetch fallido, la lista sigue en pantalla', () => {
    mockUseConversations.mockReturnValue({
      data: [mockConversation],
      isLoading: false,
      isError: true,
      isPaused: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText('Alice')).toBeTruthy();
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  it('muestra el nombre del receptor cuando el usuario actual envió el último mensaje', () => {
    mockUseConversations.mockReturnValue({
      data: [
        {
          id: 'msg-2',
          sender_id: 'user-1',
          receiver_id: 'user-3',
          content: 'Vi a tu gata cerca del parque',
          is_read: true,
          created_at: '2024-01-01T10:30:00Z',
          sender: { id: 'user-1', name: 'Me' },
          receiver: { id: 'user-3', name: 'Carla' },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText('Carla')).toBeTruthy();
    expect(queryByText(/unknownUser/)).toBeNull();
  });
});
