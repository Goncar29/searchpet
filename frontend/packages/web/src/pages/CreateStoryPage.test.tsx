import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

beforeEach(() => {
  mutate.mockClear();
});

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

  it('expone los tres campos, incluido el de agradecimientos', () => {
    const { container } = render(<CreateStoryPage />, { wrapper });
    expect(container.querySelector('#story-body')).toBeTruthy();
    expect(container.querySelector('#story-title')).toBeTruthy();
    // hero_name viaja en CreateStoryRequest desde siempre y la página no lo
    // exponía. Si alguien lo saca, esto se pone rojo.
    expect(container.querySelector('#story-hero')).toBeTruthy();
  });

  it('marca el relato como obligatorio para tecnología asistiva', () => {
    const { container } = render(<CreateStoryPage />, { wrapper });
    // El asterisco es decorativo (aria-hidden). Lo que un lector de pantalla
    // lee es esto, y sin esto la obligatoriedad no existe para quien no ve.
    expect(container.querySelector('#story-body')?.getAttribute('aria-required')).toBe('true');
    expect(container.querySelector('#story-title')?.getAttribute('aria-required')).toBeNull();
  });

  it('al fallar la validación asocia el mensaje de error con el campo', () => {
    const { container } = render(<CreateStoryPage />, { wrapper });
    fireEvent.submit(container.querySelector('form')!);

    const body = container.querySelector('#story-body')!;
    // No alcanza con que el mensaje aparezca: tiene que estar REFERENCIADO por
    // el control. Sin aria-describedby, role="alert" lo anuncia una vez y
    // después el usuario que vuelve al campo con Tab no escucha nada.
    const describedBy = body.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(body.getAttribute('aria-invalid')).toBe('true');
    const mensaje = container.querySelector(`#${describedBy}`);
    expect(mensaje).toBeTruthy();
    expect(mensaje?.getAttribute('role')).toBe('alert');
    expect(mensaje?.textContent).toBeTruthy();

    // Y no se publicó nada.
    expect(mutate).not.toHaveBeenCalled();
  });

  it('ofrece salir sin publicar además de enviar', () => {
    render(<CreateStoryPage />, { wrapper });
    // Por tipo, no por conteo: contar botones se rompe si alguien agrega uno y
    // pasa igual si "Cancelar" se cambia por otra cosa.
    const botones = screen.getAllByRole('button');
    expect(botones.filter((b) => b.getAttribute('type') === 'submit')).toHaveLength(1);
    expect(botones.filter((b) => b.getAttribute('type') === 'button')).toHaveLength(1);
  });
});
