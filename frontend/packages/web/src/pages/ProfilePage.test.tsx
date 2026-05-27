import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfilePage } from './ProfilePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Carlos', email: 'carlos@example.com', is_verified: false, created_at: '' },
    refreshUser: vi.fn(),
  }),
}));

vi.mock('@shared/hooks', () => ({
  useUpdateMe: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadProfilePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMyBadges: () => ({ data: [] }),
  useVerificationStatus: () => ({ data: null }),
  useSendEmailOTP: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmEmailOTP: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublicProfile: () => ({ data: null, isLoading: false }),
}));

vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/types')>();
  return { ...actual, BADGE_META: {} };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

describe('ProfilePage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<ProfilePage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
