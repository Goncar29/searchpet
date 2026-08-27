import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// El perfil que se monta. Antes este archivo dejaba `usePublicProfile` en
// `isLoading: true` para siempre, así que la página no pasaba nunca de su
// esqueleto: la lista de reseñas —lo único que este archivo prueba— no llegaba
// a renderizarse ni una vez.
const profileState = vi.hoisted(() => ({
  current: {
    id: 'user-456',
    name: 'Ana',
    city: 'Montevideo',
    profile_photo_url: '',
    total_points: 12,
    total_reports: 1,
    found_count: 0,
    share_count: 0,
    badges: [],
    avg_rating: 0,
    review_count: 0,
  } as Record<string, unknown> | null,
}));

// Y el cuerpo de `useUserReviews` era `{ data: [] }`, una forma que el endpoint
// no devuelve: la página lee `data.reviews`. Pasaba en verde porque el `?? []`
// que este cambio borra tapaba la diferencia.
const reviewsState = vi.hoisted(() => ({ reviews: [] as unknown[], isError: false }));

vi.mock('@shared/hooks', () => ({
  usePublicProfile: () => ({ data: profileState.current, isLoading: false, error: null }),
  useUserReviews: () => ({
    // Un `UseQueryResult` con la relación real entre las banderas de v5
    // (`isLoading` = `isPending && isFetching`).
    data: reviewsState.isError ? undefined : { reviews: reviewsState.reviews },
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: reviewsState.isError,
    error: reviewsState.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
  useCreateReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

function review(overrides: Record<string, unknown>) {
  return {
    id: 'rev-1',
    reviewer_id: 'user-1',
    reviewer_name: 'Carlos',
    stars: 5,
    text: 'Muy buena onda',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('UserProfilePage', () => {
  beforeEach(() => {
    reviewsState.reviews = [];
    reviewsState.isError = false;
  });

  it('renderiza sin lanzar errores', () => {
    render(<UserProfilePage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // La pantalla no sabe si el usuario tiene reseñas cuando no pudo leerlas.
  // "Aún no hay reseñas" es una afirmación sobre su reputación, y decirla sin
  // haber leído nada es exactamente la mentira que este trabajo persigue.
  it('con las resenas caidas NO dice que no hay ninguna', () => {
    reviewsState.isError = true;
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText('Aún no hay reseñas.')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // La otra mitad: sin reseñas de verdad, el texto se queda. Es un hecho, no
  // una suposición.
  it('sin resenas y sin error, sigue diciendo que no hay ninguna', () => {
    render(<UserProfilePage />, { wrapper });

    expect(screen.getByText('Aún no hay reseñas.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con resenas las lista', () => {
    reviewsState.reviews = [review({ id: 'r1', text: 'Me ayudó a encontrar a Bruno' })];
    render(<UserProfilePage />, { wrapper });

    expect(screen.getByText('Me ayudó a encontrar a Bruno')).toBeInTheDocument();
    expect(screen.queryByText('Aún no hay reseñas.')).not.toBeInTheDocument();
  });
});
