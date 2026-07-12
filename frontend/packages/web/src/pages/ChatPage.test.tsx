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
}
let capturedMenuProps: CapturedMenuProps | null = null;

vi.mock('../components/ConversationActionsMenu', () => ({
  ConversationActionsMenu: (props: CapturedMenuProps) => {
    capturedMenuProps = props;
    return <button aria-label="chat:actions.menuLabel">menu</button>;
  },
}));

import { useConversation, useWebSocket } from '@shared/hooks';

// Helper to build a minimal mock return value for useConversation
// Cast through unknown to satisfy TS6's stricter overlap checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConversation = (data: any[], isLoading: boolean) =>
  ({ data, isLoading }) as unknown as ReturnType<typeof useConversation>;

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
    usePublicProfileMock.mockReturnValue({ data: { id: 'user-2', name: 'Alice' } });
    useBlockStatusMock.mockReturnValue({ isBlocked: false, isLoading: false });
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
});
