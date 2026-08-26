import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdoptPage } from './AdoptPage';
import type { Pet } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

// `useAdoptions` se desestructura como `const { data }` y la pagina lee
// `data?.data` (AdoptPage.tsx:40), o sea que el hook devuelve un SOBRE
// paginado, no el array. Devolver el array deja la grilla vacia y el test
// falla sin que haya nada roto en la pagina.
const state = vi.hoisted(() => ({
  data: { data: [] as unknown[], total: 0 } as
    | { data: unknown[] | null; total?: number }
    | undefined,
  isError: false,
}));

vi.mock('@shared/hooks', () => ({
  useAdoptions: () => ({
    data: state.data,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isError: state.isError,
    error: state.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const FOTO =
  'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';

function pet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pet-1',
    name: 'Bruno',
    type: 'perro',
    status: 'adoption',
    photos: [{ url: FOTO }],
    ...overrides,
  } as unknown as Pet;
}

describe('AdoptPage', () => {
  beforeEach(() => {
    state.data = { data: [], total: 0 };
    state.isError = false;
  });

  it('con la query caida NO dice que no hay mascotas en adopcion', () => {
    state.data = undefined;
    state.isError = true;

    render(<AdoptPage />, { wrapper });

    expect(screen.queryByText('adoption:section.empty')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // El contador vive FUERA de la rama que se envuelve, asi que el port no lo
  // toca solo: con la query caida `data?.total ?? pets.length` daba CERO y el
  // encabezado afirmaba "0 mascotas" al lado del cartel que dice que no
  // pudimos leer nada. Es la misma mentira un piso mas arriba.
  it('con la query caida NO afirma un conteo de resultados', () => {
    state.data = undefined;
    state.isError = true;

    render(<AdoptPage />, { wrapper });

    expect(screen.queryByText(/resultCount/)).not.toBeInTheDocument();
  });

  // La otra mitad de la distincion. Sin esto, `count` degradado a `undefined`
  // para siempre —o el bloque `{count !== undefined && ...}` borrado— deja los
  // cuatro tests en verde mientras TODO usuario pierde el encabezado.
  it('con datos el conteo SI se afirma', () => {
    state.data = { data: [pet()], total: 1 };

    render(<AdoptPage />, { wrapper });

    expect(screen.getByText('adoption:section.resultCount')).toBeInTheDocument();
  });

  // El backend arma sus slices con `make(...)` y `Total` no lleva `omitempty`,
  // asi que hoy las dos mitades del sobre siempre viajan. Pero el codigo previo
  // decia `data?.total ?? (data?.data ?? []).length` y ese `?? []` blindaba la
  // tajada interna: al reescribir el contador se perdio. Un `data: null` es
  // JSON valido —y es exactamente la forma de un slice `nil` de Go— y tiraba en
  // pleno render, dejando en blanco la pantalla que todo esto viene a proteger.
  it('un sobre con la tajada en null no rompe el render', () => {
    state.data = { data: null };

    render(<AdoptPage />, { wrapper });

    expect(screen.getByText('adoption:section.empty')).toBeInTheDocument();
  });

  // Esta pantalla es la unica que llega a CUATRO columnas (`xl:grid-cols-4`),
  // asi que su tarjeta mide ~286x192 y es casi cuadrada. Pedir la variante del
  // feed —600x300, mas apaisada— no se veria roto: se veria igual y recortaria
  // con la proporcion de otra pantalla. Por eso el guard fija el numero.
  it('la tarjeta pide la variante adopt, no la del feed', () => {
    state.data = { data: [pet()], total: 1 };

    render(<AdoptPage />, { wrapper });

    const img = screen.getByAltText('Bruno') as HTMLImageElement;
    expect(img.src).toContain('w_450,h_300,c_lfill,g_auto');
  });

  it('una foto que no es de Cloudinary se dibuja intacta', () => {
    // El seed usa hosts ajenos. Recortar una URL que no es nuestra romperia la
    // imagen en vez de achicarla.
    const ajena = 'https://picsum.photos/seed/foo/800/600';
    state.data = { data: [pet({ photos: [{ url: ajena }] })], total: 1 };

    render(<AdoptPage />, { wrapper });

    expect((screen.getByAltText('Bruno') as HTMLImageElement).src).toBe(ajena);
  });
});
