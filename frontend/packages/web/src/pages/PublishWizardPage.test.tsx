import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { PublishWizardPage } from './PublishWizardPage';
import { useMyPets } from '@shared/hooks';

vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => ({
    t: (key: string) => `${Array.isArray(ns) ? ns[0] : ns}:${key}`,
    i18n: { language: 'es' },
  }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'user-1', name: 'Carlos' }, login: vi.fn(), register: vi.fn() }),
}));

vi.mock('@shared/hooks', () => ({
  useMyPets: vi.fn(() => ({ data: [], isLoading: false })),
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
    expect(screen.getByText('publish:lostPet.empty')).toBeInTheDocument();
  });

  it('selecting the stray intent advances to the stray-form step', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));
    expect(screen.getByText('publish:strayForm.title')).toBeInTheDocument();
  });
});

describe('PublishWizardPage — lost path', () => {
  it('shows the empty state with a link to /pets/create when there are no eligible pets', () => {
    vi.mocked(useMyPets).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useMyPets>);
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    expect(screen.getByText('publish:lostPet.empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publish:lostPet.emptyAction' })).toHaveAttribute('href', '/pets/create');
  });

  it('lists only registered pets and selecting one advances to the location step', () => {
    vi.mocked(useMyPets).mockReturnValue({
      data: [
        { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] },
        { id: 'pet-2', name: 'Michi', type: 'gato', status: 'lost', photos: [] },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));

    expect(screen.getByText('Firulais')).toBeInTheDocument();
    expect(screen.queryByText('Michi')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Firulais'));
    expect(screen.getByText('publish:location.title')).toBeInTheDocument();
  });
});

describe('PublishWizardPage — stray path', () => {
  it('blocks continuing without a photo or type, then advances to location once both are set', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    fireEvent.click(screen.getByText('publish:strayForm.next'));
    expect(screen.getByText('publish:strayForm.photoRequired')).toBeInTheDocument();
    expect(screen.getByText('publish:strayForm.typeRequired')).toBeInTheDocument();

    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('publish:strayForm.photoLabel') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'perro' } });

    fireEvent.click(screen.getByText('publish:strayForm.next'));
    expect(screen.getByText('publish:location.title')).toBeInTheDocument();
  });
});
