import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { PublishWizardPage } from './PublishWizardPage';

vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string) => ({ t: (key: string) => `${ns}:${key}`, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'user-1', name: 'Carlos' }, login: vi.fn(), register: vi.fn() }),
}));

vi.mock('@shared/hooks', () => ({
  useMyPets: () => ({ data: [], isLoading: false }),
  usePublishLost: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePublishStray: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PublishWizardPage', () => {
  it('renders the intent step first with two cards', () => {
    render(<PublishWizardPage />, { wrapper });
    expect(screen.getByText('publish:intent.lostTitle')).toBeInTheDocument();
    expect(screen.getByText('publish:intent.strayTitle')).toBeInTheDocument();
  });

  it('selecting the lost intent advances to the lost-pet step', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    expect(screen.getByText('publish:lostPet.title')).toBeInTheDocument();
  });

  it('selecting the stray intent advances to the stray-form step', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));
    expect(screen.getByText('publish:strayForm.title')).toBeInTheDocument();
  });
});
