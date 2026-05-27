import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BlockedUsersPage } from './BlockedUsersPage';

vi.mock('@shared/hooks', () => ({
  useBlockedUsers: () => ({ data: [], isLoading: false }),
  useUnblockUser: () => ({ mutate: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe('BlockedUsersPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<BlockedUsersPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
