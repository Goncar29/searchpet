import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfilePage } from './UserProfilePage';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useParams: () => ({ id: 'user-456' }) };
});

vi.mock('@shared/hooks', () => ({
  usePublicProfile: () => ({ data: null, isLoading: true }),
  useUserReviews: () => ({ data: [] }),
  useCreateReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBlockUser: () => ({ mutate: vi.fn(), isPending: false }),
  useBlockedUsers: () => ({ data: [] }),
  useUnblockUser: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitAbuseReport: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/types')>();
  return { ...actual, BADGE_META: {} };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('UserProfilePage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<UserProfilePage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
