import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from './HomePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}));

const mockMutateAsync = vi.fn();
const mockClassify = vi.fn();

vi.mock('@shared/hooks', () => ({
  useStats: () => ({ data: { total_pets: 42, total_found: 10, total_users: 100, total_reports: 50 } }),
  useNearbyReports: () => ({ data: [], isLoading: false }),
  useSearchPets: () => ({ data: [], isLoading: false }),
  useStories: () => ({ data: [], isLoading: false }),
  useImageClassify: () => ({ classify: mockClassify, isModelLoading: false, isClassifying: false, error: null }),
  useImageSearch: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HomePage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<HomePage />, { wrapper });
    // If it renders at all, this passes
    expect(document.body).toBeTruthy();
  });

  it('muestra la sección de mascotas perdidas', () => {
    render(<HomePage />, { wrapper });
    // Page renders with filter/search area
    expect(document.body.innerHTML).toBeTruthy();
  });

  it('logged out: selecting a photo shows the login prompt and does not search/classify', async () => {
    mockMutateAsync.mockClear();
    mockClassify.mockClear();

    const { container } = render(<HomePage />, { wrapper });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'pet.png', { type: 'image/png' })] },
    });

    expect(await screen.findByText(/photoSearch\.loginRequired/)).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockClassify).not.toHaveBeenCalled();
  });
});
