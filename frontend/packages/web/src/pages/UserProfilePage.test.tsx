import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfilePage } from './UserProfilePage';

// `t` devuelve la clave, como el resto de los tests de páginas. Las opciones se
// serializan al lado a propósito: el aviso de lista recortada existe para NO
// mentir sobre los números, así que un test que sólo mira si el cartel aparece
// no prueba lo que importa. Con esto se pueden afirmar los valores.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: 'es' },
  }),
}));

// Mutable: `myReview` sólo se calcula si `canReview` (sesión abierta y perfil
// ajeno), así que con el anónimo de siempre esa línea ni se ejecuta.
const authState = vi.hoisted(() => ({
  current: { user: null as Record<string, unknown> | null, isAuthenticated: false },
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState.current,
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
const reviewsState = vi.hoisted(() => ({
  reviews: [] as unknown[] | null,
  isError: false,
}));

// `useUserPets` devuelve un SOBRE `{data, total}`, no el array pelado: `total`
// es el conteo real sin tope y `data` viene acotado a 50 por el backend.
// Devolver el array acá dejaría las dos secciones vacías sin que nada esté roto
// en la página.
const petsState = vi.hoisted(() => ({
  pets: [] as unknown[],
  total: null as number | null,
  isError: false,
}));

vi.mock('@shared/hooks', () => ({
  usePublicProfile: () => ({ data: profileState.current, isLoading: false, error: null }),
  useUserPets: () => ({
    data: petsState.isError
      ? undefined
      : { data: petsState.pets, total: petsState.total ?? petsState.pets.length },
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: petsState.isError,
    error: petsState.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
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

function pet(overrides: Record<string, unknown>) {
  return {
    id: 'pet-1',
    name: 'Bruno',
    type: 'dog',
    status: 'lost',
    photos: [],
    ...overrides,
  };
}

describe('UserProfilePage', () => {
  beforeEach(() => {
    reviewsState.reviews = [];
    reviewsState.isError = false;
    petsState.pets = [];
    petsState.total = null;
    petsState.isError = false;
    profileState.current = {
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
    };
    authState.current = { user: null, isAuthenticated: false };
  });

  it('renderiza sin lanzar errores', () => {
    render(<UserProfilePage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // ── Publicaciones ──────────────────────────────────────────────────────────

  it('lista las publicaciones y manda las de adopcion a su propia seccion', () => {
    petsState.pets = [
      pet({ id: 'p1', name: 'Bruno', status: 'lost' }),
      pet({ id: 'p2', name: 'Kira', status: 'adoption' }),
    ];
    render(<UserProfilePage />, { wrapper });

    const adopcion = screen.getByText('profile:public.adoption').closest('section');
    expect(adopcion).not.toBeNull();
    // Kira está en "En adopción" y Bruno NO: si el corte se hiciera al revés
    // (o no se hiciera) las dos aparecerían acá.
    expect(within(adopcion!).getByText('Kira')).toBeInTheDocument();
    expect(within(adopcion!).queryByText('Bruno')).not.toBeInTheDocument();

    const publicaciones = screen.getByText('profile:public.posts').closest('section');
    expect(within(publicaciones!).getByText('Bruno')).toBeInTheDocument();
    expect(within(publicaciones!).queryByText('Kira')).not.toBeInTheDocument();
  });

  it('sin nada en adopcion, esa seccion no existe', () => {
    petsState.pets = [pet({ id: 'p1', name: 'Bruno', status: 'lost' })];
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText('profile:public.adoption')).not.toBeInTheDocument();
  });

  // La pantalla no sabe qué publicó esta persona cuando no pudo leer la lista.
  // "No tiene publicaciones activas" es una afirmación sobre alguien más, y
  // decirla sin haber leído nada es la mentira que `ListState` existe para
  // matar.
  it('con las publicaciones caidas NO las dibuja como lista vacia', () => {
    petsState.isError = true;
    render(<UserProfilePage />, { wrapper });

    expect(screen.getByText('profile:public.postsError')).toBeInTheDocument();
    expect(screen.queryByText('profile:public.postsEmpty')).not.toBeInTheDocument();
    // Y la sección de adopción tampoco inventa un segundo cartel para el mismo
    // fallo: una falla, un mensaje. Se cuentan los `alert` porque el segundo
    // cartel NO trae encabezado propio — mirar sólo el título de la sección lo
    // dejaría pasar.
    expect(screen.queryByText('profile:public.adoption')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  // ── Aviso de lista recortada ───────────────────────────────────────────────

  it('avisa cuando la lista viene recortada, con los dos numeros del mismo conjunto', () => {
    petsState.pets = [
      pet({ id: 'p1', name: 'Bruno' }),
      pet({ id: 'p2', name: 'Kira', status: 'adoption' }),
      pet({ id: 'p3', name: 'Lola' }),
    ];
    petsState.total = 12;
    render(<UserProfilePage />, { wrapper });

    // `shown` cuenta las TRES filas devueltas (las dos secciones juntas), no
    // las dos de "Publicaciones": `total` incluye las de adopción, así que
    // emparejarlo con una sola sección afirmaría una resta que nadie hizo.
    const aviso = screen.getByText(/profile:public\.postsCapped/);
    expect(aviso.textContent).toContain('"shown":3');
    expect(aviso.textContent).toContain('"total":12');
  });

  // La otra mitad, y es la que se olvida: un cartel que se dibuja siempre pasa
  // el test de arriba igual.
  it('sin recorte, no avisa nada', () => {
    petsState.pets = [pet({ id: 'p1', name: 'Bruno' }), pet({ id: 'p2', name: 'Lola' })];
    petsState.total = 2;
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText(/profile:public\.postsCapped/)).not.toBeInTheDocument();
  });

  it('con la lista caida tampoco avisa de un recorte que no puede conocer', () => {
    petsState.isError = true;
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText(/profile:public\.postsCapped/)).not.toBeInTheDocument();
  });

  // Prueba que `petsTruncated` es `total > shown` y NO `total !== shown`: con
  // `!==`, este mismo escenario (COUNT caído → `total: 0` con una lista NO
  // vacía) inventaría un recorte de "0 publicaciones". `petsState.total = 0`
  // pasa el `?? petsState.pets.length` del mock porque `??` sólo atrapa
  // `null`/`undefined`, no `0`.
  it('con el total perdido (COUNT caido) no inventa un recorte', () => {
    petsState.pets = [pet({ id: 'p1', name: 'Bruno' }), pet({ id: 'p2', name: 'Lola' })];
    petsState.total = 0;
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText(/profile:public\.postsCapped/)).not.toBeInTheDocument();
  });

  // ── Reseñas ────────────────────────────────────────────────────────────────

  // La pantalla no sabe si el usuario tiene reseñas cuando no pudo leerlas.
  // "Aún no hay reseñas" es una afirmación sobre su reputación, y decirla sin
  // haber leído nada es exactamente la mentira que este trabajo persigue.
  it('con las resenas caidas NO dice que no hay ninguna', () => {
    reviewsState.isError = true;
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText('profile:public.reviewsEmpty')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('profile:public.reviewsError')).toBeInTheDocument();
  });

  // La otra mitad: sin reseñas de verdad, el texto se queda. Es un hecho, no
  // una suposición.
  it('sin resenas y sin error, sigue diciendo que no hay ninguna', () => {
    render(<UserProfilePage />, { wrapper });

    expect(screen.getByText('profile:public.reviewsEmpty')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // `myReview` se calcula FUERA del `ListState`, así que el blindaje contra
  // `null` de la primitiva no lo alcanza: un cuerpo `{"reviews": null}` tiraba
  // en pleno render y dejaba la pantalla en blanco vía `ErrorBoundary` — la
  // falla exacta que todo este trabajo existe para evitar.
  it('un cuerpo con reviews en null NO deja la pantalla en blanco', () => {
    authState.current = {
      user: { id: 'user-1', name: 'Carlos' },
      isAuthenticated: true,
    };
    reviewsState.reviews = null;
    render(<UserProfilePage />, { wrapper });

    // La pantalla sigue en pie: el perfil se ve y la lista cae a su vacío.
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('profile:public.reviewsEmpty')).toBeInTheDocument();
  });

  it('con resenas las lista', () => {
    reviewsState.reviews = [review({ id: 'r1', text: 'Me ayudó a encontrar a Bruno' })];
    render(<UserProfilePage />, { wrapper });

    expect(screen.getByText('Me ayudó a encontrar a Bruno')).toBeInTheDocument();
    expect(screen.queryByText('profile:public.reviewsEmpty')).not.toBeInTheDocument();
  });

  // Sin reseñas, el resumen dibujaba `—` en `text-3xl font-bold`: en pantalla
  // se leía como una barra negra suelta al lado de cinco estrellas grises.
  it('sin calificaciones no dibuja un promedio vacio', () => {
    render(<UserProfilePage />, { wrapper });

    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.getByText('profile:public.noRating')).toBeInTheDocument();
  });

  it('con calificaciones dibuja el promedio', () => {
    profileState.current = { ...profileState.current!, avg_rating: 4.25, review_count: 4 };
    render(<UserProfilePage />, { wrapper });

    expect(screen.getByText('4.3')).toBeInTheDocument();
    expect(screen.queryByText('profile:public.noRating')).not.toBeInTheDocument();
  });
});
