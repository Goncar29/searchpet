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
  useAuthStore: (selector) =>
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
});
