// Messages (conversation list) screen smoke test
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import MessagesScreen from '../app/(tabs)/messages';
import { drawnIcons, emojiTexts } from './support/icons';

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
const mockMarkUnreadMutate = jest.fn();
const mockHideMutate = jest.fn();

jest.mock('../../shared/hooks', () => ({
  useConversations: () => mockUseConversations(),
  useMarkConversationUnread: () => ({ mutate: mockMarkUnreadMutate, isPending: false }),
  useHideConversation: () => ({ mutate: mockHideMutate, isPending: false }),
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

  // The unread dot comes from the conversation's unread_count, never from its
  // latest message: "mark unread" un-reads the latest RECEIVED message, older
  // than my own reply when I answered last.
  describe('punto de no leído', () => {
    function renderWith(conversation: Record<string, unknown>) {
      mockUseConversations.mockReturnValue({
        data: [conversation],
        isLoading: false,
        refetch: jest.fn(),
        isRefetching: false,
      });
      return render(<MessagesScreen />);
    }

    it('aparece aunque el último mensaje sea mío, si la conversación tiene no leídos', () => {
      const { queryByTestId } = renderWith({
        ...mockConversation,
        sender_id: 'user-1',
        receiver_id: 'user-2',
        is_read: true,
        sender: { id: 'user-1', name: 'Me' },
        receiver: { id: 'user-2', name: 'Alice' },
        unread_count: 1,
      });
      expect(queryByTestId('unread-dot')).toBeTruthy();
    });

    it('no aparece si la conversación no tiene no leídos, diga lo que diga el último mensaje', () => {
      const { queryByTestId } = renderWith({ ...mockConversation, is_read: false, unread_count: 0 });
      expect(queryByTestId('unread-dot')).toBeNull();
    });

    // The dot is a colored circle with no text: the row's accessible name is
    // what tells a screen reader the conversation has unread messages.
    it('la fila con no leídos lo dice en su nombre accesible', () => {
      const { getByRole } = renderWith({ ...mockConversation, unread_count: 2 });
      expect(getByRole('button', { name: /Alice.*messages:unreadLabel/ })).toBeTruthy();
    });

    it('la fila sin no leídos no lo dice', () => {
      const { getByRole, queryByRole } = renderWith({ ...mockConversation, unread_count: 0 });
      expect(getByRole('button', { name: /Alice/ })).toBeTruthy();
      expect(queryByRole('button', { name: /messages:unreadLabel/ })).toBeNull();
    });

    it('aparece si el último mensaje es del otro y la conversación tiene no leídos', () => {
      const { queryByTestId } = renderWith({ ...mockConversation, unread_count: 2 });
      expect(queryByTestId('unread-dot')).toBeTruthy();
    });
  });

  it('draws the chat bubble for a signed-out visitor and the inbox for an empty list', () => {
    mockAuthState = { isAuthenticated: false, user: null };
    const out = render(<MessagesScreen />);
    expect(drawnIcons(out)).toEqual(['chat-bubble']);
    expect(emojiTexts(out)).toEqual([]);
    out.unmount();

    mockAuthState = { isAuthenticated: true, user: { id: 'user-1', name: 'Me' } };
    mockUseConversations.mockReturnValue({ data: [], isLoading: false, refetch: jest.fn(), isRefetching: false });
    const empty = render(<MessagesScreen />);
    expect(drawnIcons(empty)).toEqual(['inbox']);
    expect(emojiTexts(empty)).toEqual([]);
  });
});

// Each row has a ⋮ with "mark as unread" and "delete conversation", as the web
// list does. Before this the app had neither, so #353 (the unread dot from
// unread_count) could only be exercised from the web.
describe('MessagesScreen — menú ⋮ de cada conversación', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockMarkUnreadMutate.mockClear();
    mockHideMutate.mockClear();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockUseConversations.mockReturnValue({
      data: [
        mockConversation,
        {
          ...mockConversation,
          id: 'msg-2',
          sender_id: 'user-1',
          receiver_id: 'user-3',
          sender: { id: 'user-1', name: 'Me' },
          receiver: { id: 'user-3', name: 'Bruno' },
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
      isRefetching: false,
    });
  });

  afterEach(() => alertSpy.mockRestore());

  // Rows are in order: Alice (user-2), then Bruno (user-3).
  function openMenu(row: number) {
    render(<MessagesScreen />);
    fireEvent.press(screen.getAllByRole('button', { name: 'chat:actions.menuLabel' })[row]);
  }

  it('cada fila tiene su botón ⋮', () => {
    render(<MessagesScreen />);
    expect(screen.getAllByRole('button', { name: 'chat:actions.menuLabel' })).toHaveLength(2);
  });

  it('el ⋮ ofrece marcar como no leída y borrar', () => {
    openMenu(0);
    expect(screen.getByRole('button', { name: 'chat:actions.markUnread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'chat:actions.delete' })).toBeTruthy();
    expect(mockMarkUnreadMutate).not.toHaveBeenCalled();
    expect(mockHideMutate).not.toHaveBeenCalled();
  });

  it('"Marcar como no leída" marca la conversación de ESA fila', () => {
    openMenu(1);
    fireEvent.press(screen.getByRole('button', { name: 'chat:actions.markUnread' }));
    expect(mockMarkUnreadMutate).toHaveBeenCalledTimes(1);
    expect(mockMarkUnreadMutate.mock.calls[0][0]).toBe('user-3');
  });

  it('"Borrar" pide confirmación antes de borrar', () => {
    openMenu(0);
    fireEvent.press(screen.getByRole('button', { name: 'chat:actions.delete' }));

    expect(screen.getByText('chat:actions.deleteConfirmTitle')).toBeTruthy();
    expect(screen.getByText('chat:actions.deleteConfirmBody')).toBeTruthy();
    expect(mockHideMutate).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'chat:actions.confirm' }));
    expect(mockHideMutate).toHaveBeenCalledTimes(1);
    expect(mockHideMutate.mock.calls[0][0]).toBe('user-2');
  });

  it('cerrar la confirmación no borra nada', () => {
    openMenu(0);
    fireEvent.press(screen.getByRole('button', { name: 'chat:actions.delete' }));
    fireEvent.press(screen.getByTestId('action-menu-backdrop'));
    expect(mockHideMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('chat:actions.deleteConfirmTitle')).toBeNull();
  });

  it('si la API falla, lo avisa', () => {
    openMenu(0);
    fireEvent.press(screen.getByRole('button', { name: 'chat:actions.markUnread' }));
    const { onError } = mockMarkUnreadMutate.mock.calls[0][1];
    onError(new Error('boom'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('tocar la fila sigue abriendo la conversación, sin abrir el menú', () => {
    render(<MessagesScreen />);
    fireEvent.press(screen.getByText('Alice'));
    expect(screen.queryByRole('button', { name: 'chat:actions.markUnread' })).toBeNull();
  });
});
