import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupDetailPage } from './GroupDetailPage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ id: 'group-123' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@shared/hooks', () => ({
  useGroup: () => ({ data: null, isLoading: true }),
  useGroupMembers: () => ({ data: [] }),
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

describe('GroupDetailPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<GroupDetailPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
