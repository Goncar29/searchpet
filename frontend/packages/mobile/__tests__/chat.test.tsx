// Chat screen smoke test
import React from 'react';
import { render } from '@testing-library/react-native';
import ChatScreen from '../app/chat/[userId]';

// expo-router: this conversation is with userId 'user-2'.
// useNavigation must expose setOptions — the screen calls it on mount.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ userId: 'user-2', userName: 'Alice' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

// useQueryClient is called directly in the component; mock the methods the
// WS callbacks touch so it never needs a real QueryClientProvider.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

jest.mock('../store', () => ({
  useAuthStore: (selector) => {
    const state = {
      user: { id: 'user-1', name: 'Me' },
      token: 'tok',
      isAuthenticated: true,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: () => ({ latitude: null, longitude: null, setLocation: jest.fn() }),
}));

const mockUseConversation = jest.fn();

// The screen imports hooks via the relative '../../../shared/hooks'; from this
// test that same module resolves through '../../shared/hooks'. Jest dedups by
// absolute path, so this intercepts the screen's import.
jest.mock('../../shared/hooks', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useSendMessageTo: () => ({ mutate: jest.fn(), isPending: false }),
  useMarkAsRead: () => ({ mutate: jest.fn() }),
  useBlockUser: () => ({ mutate: jest.fn(), isPending: false }),
  useBlockStatus: () => ({ isBlocked: false }),
  useSubmitAbuseReport: () => ({ mutate: jest.fn(), isPending: false }),
  useWebSocket: () => ({ sendEnvelope: jest.fn() }),
}));

const mockMessage = {
  id: 'msg-1',
  sender_id: 'user-2',
  receiver_id: 'user-1',
  content: 'Hola, vi a tu mascota',
  is_read: false,
  created_at: '2024-01-01T10:30:00Z',
};

beforeEach(() => {
  mockUseConversation.mockReturnValue({ data: undefined, isLoading: true });
});

describe('ChatScreen', () => {
  it('renderiza sin lanzar errores (estado de carga)', () => {
    const { toJSON } = render(<ChatScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('muestra el contenido de los mensajes de la conversación', () => {
    mockUseConversation.mockReturnValue({ data: [mockMessage], isLoading: false });
    const { queryByText } = render(<ChatScreen />);
    expect(queryByText('Hola, vi a tu mascota')).toBeTruthy();
  });

  it('muestra el estado vacío cuando no hay mensajes', () => {
    mockUseConversation.mockReturnValue({ data: [], isLoading: false });
    const { queryByText } = render(<ChatScreen />);
    expect(queryByText(/chat:startConversation/i)).toBeTruthy();
  });
});
