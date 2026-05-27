import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LeaderboardPage } from './LeaderboardPage';

vi.mock('@shared/hooks', () => ({
  useLeaderboard: () => ({ data: [], isLoading: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LeaderboardPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<LeaderboardPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
