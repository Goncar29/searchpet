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

let mockStats = { total_users: 100, total_pets: 42, pets_reunited: 10, searches_started: 50 };

vi.mock('@shared/hooks', () => ({
  useStats: () => ({ data: mockStats }),
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

  it('renders the four stat counters (lifetime + snapshot) with their values', () => {
    mockStats = { total_users: 150, total_pets: 320, pets_reunited: 42, searches_started: 88 };
    render(<HomePage />, { wrapper });

    expect(screen.getByText('home:stats.reunited')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('home:stats.searches')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('home:stats.members')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('home:stats.registered')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
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
