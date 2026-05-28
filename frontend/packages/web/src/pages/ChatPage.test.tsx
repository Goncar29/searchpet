import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ userId: 'user-2' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@shared/hooks', () => ({
  useConversation: vi.fn(),
  useSendMessageTo: () => ({ mutate: vi.fn(), isPending: false }),
  useWebSocket: vi.fn(() => ({ connectionState: 'connected' as WsConnectionState, sendEnvelope: vi.fn() })),
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
});
