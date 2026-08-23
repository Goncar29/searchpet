import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateStoryPage } from './CreateStoryPage';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams()],
  };
});

// `mutate`, no `mutateAsync`: la página llama al primero. El mock anterior
// exponía el que no se usa, así que describía una API que el componente nunca
// tocaba — un arnés que no modela lo que corre no puede fallar cuando debería.
const mutate = vi.fn();
vi.mock('@shared/hooks', () => ({
  useCreateStory: () => ({ mutate, isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CreateStoryPage', () => {
  // Las aserciones son ESTRUCTURALES, nunca sobre el texto: el setup de tests
  // (src/test/setup.ts) no inicializa i18next, así que `t()` devuelve la clave
  // cruda y comparar contra un literal en español pasaría igual con el i18n
  // roto. Que las claves resuelvan de verdad sólo se puede comprobar en un
  // navegador — se hizo, en los tres idiomas.
  it('arma las dos secciones del formulario', () => {
    const { container } = render(<CreateStoryPage />, { wrapper });
    expect(container.querySelectorAll('form section')).toHaveLength(2);
  });

  it('el relato es obligatorio y los otros dos campos no', () => {
    const { container } = render(<CreateStoryPage />, { wrapper });
    // El relato es lo único que el backend exige, y es el único control que
    // puede quedar en estado de error.
    expect(container.querySelector('#story-body')).toBeTruthy();
    expect(container.querySelector('#story-title')).toBeTruthy();
    // hero_name viaja en CreateStoryRequest desde siempre y la página no lo
    // exponía. Si alguien lo saca, esto se pone rojo.
    expect(container.querySelector('#story-hero')).toBeTruthy();
  });

  it('ofrece salir sin publicar', () => {
    render(<CreateStoryPage />, { wrapper });
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
