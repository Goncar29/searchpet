import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatPage } from './ChatPage';

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
  useWebSocket: vi.fn(() => ({ connectionState: 'connected', sendEnvelope: vi.fn() })),
}));

import { useConversation, useWebSocket } from '@shared/hooks';

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ChatPage', () => {
  it('renderiza sin lanzar errores', () => {
    vi.mocked(useConversation).mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useConversation>);
    render(<ChatPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra indicador de carga cuando isLoading es true', () => {
    vi.mocked(useConversation).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useConversation>);
    render(<ChatPage />, { wrapper });
    expect(screen.getByText('chat:loadingMessages')).toBeTruthy();
  });

  it('renderiza lista de mensajes cuando hay datos', () => {
    vi.mocked(useConversation).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-1',
          receiver_id: 'user-2',
          content: 'Hola',
          is_read: true,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Buenas!',
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useConversation>);

    render(<ChatPage />, { wrapper });

    expect(screen.getByText('Hola')).toBeTruthy();
    expect(screen.getByText('Buenas!')).toBeTruthy();
  });

  it('renderiza mensajes propios y del otro participante', () => {
    vi.mocked(useConversation).mockReturnValue({
      data: [
        {
          id: 'msg-1',
          sender_id: 'user-1',
          receiver_id: 'user-2',
          content: 'Mensaje propio',
          is_read: true,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          sender_id: 'user-2',
          receiver_id: 'user-1',
          content: 'Mensaje del otro',
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useConversation>);

    render(<ChatPage />, { wrapper });

    expect(screen.getByText('Mensaje propio')).toBeTruthy();
    expect(screen.getByText('Mensaje del otro')).toBeTruthy();
  });

  it('muestra indicador de escritura cuando useWebSocket captura typing_start', async () => {
    let capturedOnMessage: ((env: { type: string; payload: unknown }) => void) | null = null;

    vi.mocked(useWebSocket).mockImplementationOnce(
      ({ onMessage }: { onMessage: (env: unknown) => void }) => {
        capturedOnMessage = onMessage as (env: { type: string; payload: unknown }) => void;
        return { connectionState: 'connected', sendEnvelope: vi.fn() };
      }
    );

    vi.mocked(useConversation).mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useConversation>);

    render(<ChatPage />, { wrapper });

    await act(async () => {
      capturedOnMessage?.({ type: 'typing_start', payload: { from: 'user-2', to: 'user-1' } });
    });

    expect(screen.getByText('chat:typing')).toBeTruthy();
  });
});
