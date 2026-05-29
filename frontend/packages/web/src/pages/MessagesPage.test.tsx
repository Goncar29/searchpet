import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MessagesPage', () => {
  it('renderiza sin lanzar errores', () => {
    vi.mocked(useConversations).mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra indicador de carga cuando isLoading es true', () => {
    vi.mocked(useConversations).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
    expect(screen.getByText('messages:loading')).toBeTruthy();
  });

  it('muestra estado vacío cuando no hay conversaciones', () => {
    vi.mocked(useConversations).mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useConversations>);
    render(<MessagesPage />, { wrapper });
    expect(screen.getByText('messages:empty')).toBeTruthy();
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
    } as ReturnType<typeof useConversations>);

    render(<MessagesPage />, { wrapper });

    expect(screen.getByText('Juan')).toBeTruthy();
    expect(screen.getByText('Hola, encontré tu perro')).toBeTruthy();
  });
});
