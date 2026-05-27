import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupsPage } from './GroupsPage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@shared/hooks', () => ({
  useGroups: () => ({ data: [], isLoading: false }),
  useJoinGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useLeaveGroup: () => ({ mutate: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GroupsPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<GroupsPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
