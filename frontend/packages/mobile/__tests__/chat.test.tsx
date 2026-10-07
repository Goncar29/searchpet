// Chat screen smoke test
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ChatScreen from '../app/chat/[userId]';
import { COLORS } from '../constants';
import { drawnIcons, emojiTexts, fillsOf } from './support/icons';

// expo-router: this conversation is with userId 'user-2'.
// useNavigation must expose setOptions — the screen calls it on mount, and the
// ⋮ menu reaches the header through it (`headerRight`). Both functions are
// shared so a test can read them back.
const mockRouterPush = jest.fn();
const mockSetOptions = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ userId: 'user-2', userName: 'Alice' }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

// useQueryClient is called directly in the component; mock the methods the
// WS callbacks touch so it never needs a real QueryClientProvider.
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

// Read on every render, so a test can hand the screen a new user object.
let mockUser: { id: string; name: string } = { id: 'user-1', name: 'Me' };

jest.mock('../store', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      user: mockUser,
      token: 'tok',
      isAuthenticated: true,
      isLoading: false,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useLocationStore: () => ({ latitude: null, longitude: null, setLocation: jest.fn() }),
}));

const mockUseConversation = jest.fn();
// One function for every render, like react-query's `mutate`.
const mockMarkAsReadMutate = jest.fn();
const mockBlockMutate = jest.fn();

// The screen imports hooks via the relative '../../../shared/hooks'; from this
// test that same module resolves through '../../shared/hooks'. Jest dedups by
// absolute path, so this intercepts the screen's import.
jest.mock('../../shared/hooks', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useSendMessageTo: () => ({ mutate: jest.fn(), isPending: false }),
  useMarkAsRead: () => ({ mutate: mockMarkAsReadMutate }),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
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
  mockMarkAsReadMutate.mockClear();
  mockRouterPush.mockClear();
  mockBlockMutate.mockClear();
  mockSetOptions.mockClear();
  mockUser = { id: 'user-1', name: 'Me' };
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

  // Rule #60: a failed query must never render like an empty list.
  it('la consulta caída sin datos muestra un cartel de error, no la invitación a escribir', () => {
    mockUseConversation.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isPaused: false,
      refetch: jest.fn(),
    });
    const { queryByText } = render(<ChatScreen />);
    expect(queryByText('common:loadErrorTitle')).toBeTruthy();
    expect(queryByText(/chat:startConversation/i)).toBeNull();
  });

  // Rule #60: offline (isPaused) must not render like the empty state either.
  it('sin caché y offline (isPaused), muestra el estado offline en vez de la invitación a escribir', () => {
    mockUseConversation.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isPaused: true,
      refetch: jest.fn(),
    });
    const { queryByText } = render(<ChatScreen />);
    expect(queryByText('common:offlineTitle')).toBeTruthy();
    expect(queryByText(/chat:startConversation/i)).toBeNull();
  });

  it('con mensajes cacheados y un refetch fallido, la conversación sigue en pantalla', () => {
    mockUseConversation.mockReturnValue({
      data: [mockMessage],
      isLoading: false,
      isError: true,
      isPaused: false,
      refetch: jest.fn(),
    });
    const { queryByText } = render(<ChatScreen />);
    expect(queryByText('Hola, vi a tu mascota')).toBeTruthy();
    expect(queryByText('common:loadErrorTitle')).toBeNull();
  });

  // The mark-as-read effect depends on the user's id, not the user object.
  // Until the conversation refetches, the cache still shows the message as
  // unread, so re-running on a new object would POST it again.
  it('no vuelve a marcar como leído si el usuario cambia de objeto pero no de id', () => {
    mockUseConversation.mockReturnValue({ data: [mockMessage], isLoading: false });
    const { rerender } = render(<ChatScreen />);
    expect(mockMarkAsReadMutate).toHaveBeenCalledTimes(1);

    mockUser = { id: 'user-1', name: 'Me (renamed)' };
    rerender(<ChatScreen />);

    expect(mockMarkAsReadMutate).toHaveBeenCalledTimes(1);
  });

  it('vuelve a evaluar los mensajes si cambia el id del usuario', () => {
    mockUseConversation.mockReturnValue({
      data: [mockMessage, { ...mockMessage, id: 'msg-2', receiver_id: 'user-3' }],
      isLoading: false,
    });
    const { rerender } = render(<ChatScreen />);
    expect(mockMarkAsReadMutate).toHaveBeenCalledWith('msg-1');

    mockMarkAsReadMutate.mockClear();
    mockUser = { id: 'user-3', name: 'Other' };
    rerender(<ChatScreen />);

    expect(mockMarkAsReadMutate).toHaveBeenCalledTimes(1);
    expect(mockMarkAsReadMutate).toHaveBeenCalledWith('msg-2');
  });

  it('draws the send arrow as an icon with an accessible label, and no emoji', () => {
    mockUseConversation.mockReturnValue({ data: [mockMessage], isLoading: false });
    const ui = render(<ChatScreen />);
    expect(drawnIcons(ui)).toContain('send');
    expect(fillsOf(ui, 'send')).toEqual([COLORS.white]);
    expect(ui.getByLabelText('chat:send')).toBeTruthy();
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('draws the chat bubble in the empty conversation, and not once there are messages', () => {
    mockUseConversation.mockReturnValue({ data: [], isLoading: false });
    const empty = render(<ChatScreen />);
    expect(drawnIcons(empty)).toContain('chat-bubble');
    expect(emojiTexts(empty)).toEqual([]);
    empty.unmount();

    mockUseConversation.mockReturnValue({ data: [mockMessage], isLoading: false });
    const full = render(<ChatScreen />);
    expect(drawnIcons(full)).not.toContain('chat-bubble');
  });
});

// The ⋮ menu: "view profile" opens the other person's public profile (it needs
// no session), as the conversation menu does on the web, and "block" and
// "report" keep doing their job. iOS shows an action sheet and Android an
// Alert, and jest defaults to iOS, so each platform is pinned explicitly:
// otherwise the Android branch (the one the distributed APK runs) goes
// unproved. Options are picked by label, never by position, so a test still
// means the same thing when an option is added or moved.
describe.each(['ios', 'android'] as const)('ChatScreen — menú ⋮ en %s', (os) => {
  // Opens the menu and presses the option with this label (an i18n key).
  function choose(label: string) {
    const { Alert, ActionSheetIOS, Platform } = require('react-native');
    jest.replaceProperty(Platform, 'OS', os);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const sheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => {});
    // i18next is not initialised in this harness and `t` returns undefined, so
    // every menu label would be the same. Echoing the key tells them apart.
    jest.spyOn(require('i18next'), 't').mockImplementation((k: unknown) => k as string);
    mockUseConversation.mockReturnValue({ data: [mockMessage], isLoading: false });

    render(<ChatScreen />);
    const withHeader = mockSetOptions.mock.calls.filter(([o]) => o.headerRight);
    const HeaderRight = withHeader[withHeader.length - 1][0].headerRight as () => React.ReactElement;
    fireEvent.press(render(<HeaderRight />).getByText('⋮'));

    if (os === 'ios') {
      expect(alertSpy).not.toHaveBeenCalled();
      const [config, onSelect] = sheetSpy.mock.calls[0] as [
        { options: string[]; destructiveButtonIndex: number },
        (i: number) => void,
      ];
      expect(config.options).toContain(label);
      onSelect(config.options.indexOf(label));
      return { alertSpy, config };
    }
    expect(sheetSpy).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as { text: string; style?: string; onPress?: () => void }[];
    const button = buttons.find((b) => b.text === label);
    expect(button).toBeDefined();
    button?.onPress?.();
    return { alertSpy, buttons };
  }

  afterEach(() => jest.restoreAllMocks());

  it('"Ver perfil" abre el perfil público del otro usuario', () => {
    choose('chat:actions.viewProfile');

    expect(mockRouterPush).toHaveBeenCalledWith('/users/user-2');
  });

  it('"Bloquear" bloquea al otro usuario, y es la opción marcada como destructiva', () => {
    const result = choose('chat:blockUser');

    expect(mockBlockMutate).toHaveBeenCalledTimes(1);
    expect(mockBlockMutate.mock.calls[0][0]).toEqual({ userId: 'user-2' });
    expect(mockRouterPush).not.toHaveBeenCalled();
    if (result.config) {
      expect(result.config.options[result.config.destructiveButtonIndex]).toBe('chat:blockUser');
    } else {
      expect(result.buttons?.find((b) => b.text === 'chat:blockUser')).toMatchObject({ style: 'destructive' });
    }
  });

  it('"Denunciar" abre la elección del motivo', () => {
    const { alertSpy } = choose('chat:report');

    expect(alertSpy).toHaveBeenLastCalledWith('chat:reportReason', '', expect.any(Array));
    expect(mockBlockMutate).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
