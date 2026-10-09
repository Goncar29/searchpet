// Chat screen smoke test
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
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
const mockReportMutate = jest.fn();
const mockUnblockMutate = jest.fn();
let mockBlockedByMe: { blocked_id: string }[] = [];

// The screen imports hooks via the relative '../../../shared/hooks'; from this
// test that same module resolves through '../../shared/hooks'. Jest dedups by
// absolute path, so this intercepts the screen's import.
jest.mock('../../shared/hooks', () => ({
  useConversation: (...args: unknown[]) => mockUseConversation(...args),
  useSendMessageTo: () => ({ mutate: jest.fn(), isPending: false }),
  useMarkAsRead: () => ({ mutate: mockMarkAsReadMutate }),
  useBlockUser: () => ({ mutate: mockBlockMutate, isPending: false }),
  useBlockStatus: () => ({ isBlocked: false }),
  useBlockedUsers: () => ({ data: mockBlockedByMe }),
  useUnblockUser: () => ({ mutate: mockUnblockMutate, isPending: false }),
  useSubmitAbuseReport: () => ({ mutate: mockReportMutate, isPending: false }),
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
  mockReportMutate.mockClear();
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
// "report" keep doing their job. It is a card (ActionMenuModal), never an
// Alert: on Android an Alert shows at most three buttons, so Cancel + three
// actions dropped Report, and the six-button reasons dropped most reasons.
// Both platforms are pinned: Android is the one the distributed APK runs.
// Options are picked by label, never by position.
describe.each(['ios', 'android'] as const)('ChatScreen — menú ⋮ en %s', (os) => {
  let alertSpy: jest.SpyInstance;

  // Renders the chat and presses ⋮. Returns the chat's render result.
  function openMenu() {
    const { ActionSheetIOS, Platform } = require('react-native');
    const appAlert = require('../components/appAlert');
    jest.replaceProperty(Platform, 'OS', os);
    alertSpy = jest.spyOn(appAlert, 'showAlert').mockImplementation(() => {});
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    // i18next is not initialised in this harness and `t` returns undefined, so
    // every menu label would be the same. Echoing the key tells them apart.
    jest.spyOn(require('i18next'), 't').mockImplementation((k: unknown) => k as string);
    mockUseConversation.mockReturnValue({ data: [mockMessage], isLoading: false });

    const ui = render(<ChatScreen />);
    const withHeader = mockSetOptions.mock.calls.filter(([o]) => o.headerRight);
    const HeaderRight = withHeader[withHeader.length - 1][0].headerRight as () => React.ReactElement;
    // Pressed through its props, not a second render(): with the header
    // rendered as its own tree, every later press on the chat's tree was a
    // silent no-op (observed with RNTL 13; the menu tests passed vacuously).
    act(() => {
      HeaderRight().props.onPress();
    });
    return ui;
  }

  afterEach(() => {
    expect(alertSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('el ⋮ del encabezado tiene un área de toque como el de la lista de conversaciones', () => {
    openMenu();
    const withHeader = mockSetOptions.mock.calls.filter(([o]) => o.headerRight);
    const HeaderRight = withHeader[withHeader.length - 1][0].headerRight as () => React.ReactElement;
    const { hitSlop, style } = HeaderRight().props as {
      hitSlop?: { top: number; bottom: number; left: number; right: number };
      style?: { paddingHorizontal?: number; paddingVertical?: number };
    };
    const { SPACING } = require('../constants');
    // Reported on the 1.3.0 APK: the header ⋮ was only the glyph plus 16px on
    // the right, hard to hit next to the list's ⋮ (padding md + hitSlop).
    expect(style?.paddingHorizontal).toBeGreaterThanOrEqual(SPACING.md);
    expect(style?.paddingVertical).toBeGreaterThanOrEqual(SPACING.sm);
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      expect(hitSlop?.[side]).toBeGreaterThanOrEqual(8);
    }
  });

  it('muestra las tres acciones a la vez, Denunciar incluida', () => {
    const ui = openMenu();
    for (const label of ['chat:actions.viewProfile', 'chat:blockUser', 'chat:report']) {
      expect(ui.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('"Ver perfil" abre el perfil público del otro usuario', () => {
    const ui = openMenu();
    fireEvent.press(ui.getByRole('button', { name: 'chat:actions.viewProfile' }));

    expect(mockRouterPush).toHaveBeenCalledWith('/users/user-2');
  });

  it('"Bloquear" bloquea al otro usuario', () => {
    const ui = openMenu();
    fireEvent.press(ui.getByRole('button', { name: 'chat:blockUser' }));

    expect(mockBlockMutate).toHaveBeenCalledTimes(1);
    expect(mockBlockMutate.mock.calls[0][0]).toEqual({ userId: 'user-2' });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  describe('con el usuario bloqueado por mí', () => {
    beforeEach(() => {
      mockBlockedByMe = [{ blocked_id: 'user-2' }];
      mockUnblockMutate.mockClear();
      mockBlockMutate.mockClear();
    });
    afterEach(() => {
      mockBlockedByMe = [];
    });

    // Reported on the 1.4.0 APK: after blocking someone from the chat, the
    // only way back was Profile → Blocked users; the menu kept offering Block.
    it('ofrece Desbloquear en vez de Bloquear', () => {
      const ui = openMenu();
      expect(ui.getByRole('button', { name: 'chat:actions.unblock' })).toBeTruthy();
      expect(ui.queryByRole('button', { name: 'chat:blockUser' })).toBeNull();
    });

    it('"Desbloquear" desbloquea a ese usuario y no lo vuelve a bloquear', () => {
      const ui = openMenu();
      fireEvent.press(ui.getByRole('button', { name: 'chat:actions.unblock' }));

      expect(mockUnblockMutate).toHaveBeenCalledTimes(1);
      expect(mockUnblockMutate.mock.calls[0][0]).toBe('user-2');
      expect(mockBlockMutate).not.toHaveBeenCalled();
    });
  });

  it('si desbloquear falla, lo dice en vez de quedarse callado', () => {
    mockBlockedByMe = [{ blocked_id: 'user-2' }];
    mockUnblockMutate.mockImplementation((_id: string, opts: { onError: (e: Error) => void }) =>
      opts.onError(new Error('boom')),
    );
    const ui = openMenu();
    alertSpy.mockClear();
    fireEvent.press(ui.getByRole('button', { name: 'chat:actions.unblock' }));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('common:error');
    // The menu's afterEach asserts no alert; this one is expected.
    alertSpy.mockClear();
    mockUnblockMutate.mockReset();
    mockBlockedByMe = [];
  });

  it('si fui yo el bloqueado (no él), sigue ofreciendo Bloquear: no hay nada mío que deshacer', () => {
    mockBlockedByMe = [{ blocked_id: 'someone-else' }];
    const ui = openMenu();
    expect(ui.getByRole('button', { name: 'chat:blockUser' })).toBeTruthy();
    expect(ui.queryByRole('button', { name: 'chat:actions.unblock' })).toBeNull();
    mockBlockedByMe = [];
  });

  it('"Denunciar" muestra los cinco motivos, y elegir uno envía la denuncia', () => {
    const ui = openMenu();
    fireEvent.press(ui.getByRole('button', { name: 'chat:report' }));

    expect(ui.getByText('chat:reportReason')).toBeTruthy();
    for (const k of ['spam', 'fake', 'abuse', 'inappropriate', 'other']) {
      expect(ui.getByRole('button', { name: `pet_detail:${k}` })).toBeTruthy();
    }
    expect(mockReportMutate).not.toHaveBeenCalled();

    fireEvent.press(ui.getByRole('button', { name: 'pet_detail:fake' }));
    expect(mockReportMutate).toHaveBeenCalledTimes(1);
    expect(mockReportMutate.mock.calls[0][0]).toEqual({ target_user_id: 'user-2', reason: 'fake' });
    expect(mockBlockMutate).not.toHaveBeenCalled();
  });
});
