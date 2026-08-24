import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateStoryPage } from './CreateStoryPage';

// La query de la URL se configura por test: sin `petId` la pantalla ofrece un
// selector, con `petId` muestra la mascota fija.
let searchParams = new URLSearchParams();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [searchParams],
  };
});

// `mutate`, no `mutateAsync`: la página llama al primero.
const mutate = vi.fn();
let myPets: unknown[] = [];
let reportedPets: unknown[] = [];
vi.mock('@shared/hooks', () => ({
  useCreateStory: () => ({ mutate, isPending: false }),
  useMyPets: () => ({ data: myPets, isLoading: false }),
  useReportedPets: () => ({ data: reportedPets, isLoading: false }),
}));

const encontrada = { id: 'pet-found', name: 'Luna', type: 'perro', status: 'found' };
const perdida = { id: 'pet-lost', name: 'Toby', type: 'gato', status: 'lost' };

beforeEach(() => {
  mutate.mockClear();
  searchParams = new URLSearchParams();
  myPets = [];
  reportedPets = [];
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
  // roto. Que las claves resuelvan sólo se comprueba en un navegador.

  describe('elegir la mascota', () => {
    it('ofrece SOLO las mascotas encontradas', () => {
      myPets = [encontrada, perdida];
      const { container } = render(<CreateStoryPage />, { wrapper });

      const opciones = [...container.querySelectorAll('#story-pet option')].map((o) =>
        o.getAttribute('value')
      );
      // El backend exige status "found" (success_story_service.go:40). Ofrecer
      // una que no lo esté deja al usuario escribir la historia entera para que
      // se la rechacen — o sea el mismo defecto, un paso más adelante.
      expect(opciones).toContain('pet-found');
      expect(opciones).not.toContain('pet-lost');
    });

    it('incluye las callejeras que el usuario REPORTO, no solo las propias', () => {
      myPets = [];
      reportedPets = [encontrada];
      const { container } = render(<CreateStoryPage />, { wrapper });

      // canManagePet autoriza al dueño Y al reportero de una callejera, y son
      // endpoints distintos (/pets/mine vs /pets/reported). Con una sola lista,
      // quien reportó una callejera veía "no tenés mascotas" mientras el
      // backend le habría aceptado la historia.
      const opciones = [...container.querySelectorAll('#story-pet option')].map((o) =>
        o.getAttribute('value')
      );
      expect(opciones).toContain('pet-found');
    });

    it('no duplica una mascota que aparece en las dos listas', () => {
      myPets = [encontrada];
      reportedPets = [encontrada];
      const { container } = render(<CreateStoryPage />, { wrapper });

      const opciones = [...container.querySelectorAll('#story-pet option')].filter(
        (o) => o.getAttribute('value') === 'pet-found'
      );
      expect(opciones).toHaveLength(1);
    });

    it('sin mascota elegida no publica, y lo dice en el campo', () => {
      myPets = [encontrada];
      const { container } = render(<CreateStoryPage />, { wrapper });

      fireEvent.change(container.querySelector('#story-body')!, { target: { value: 'volvió' } });
      fireEvent.submit(container.querySelector('form')!);

      expect(mutate).not.toHaveBeenCalled();
      const select = container.querySelector('#story-pet')!;
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(container.querySelector(`#${select.getAttribute('aria-describedby')}`)).toBeTruthy();
    });
  });

  describe('sin ninguna mascota elegible', () => {
    it('NO muestra el formulario', () => {
      myPets = [perdida];
      const { container } = render(<CreateStoryPage />, { wrapper });

      // El bug del issue #179: se podía escribir la historia entera y recién al
      // enviar aparecía un "ocurrió un error inesperado". Ahora no hay
      // formulario que llenar.
      expect(container.querySelector('form')).toBeNull();
      expect(container.querySelector('#story-body')).toBeNull();
    });

    it('ofrece a donde ir', () => {
      myPets = [];
      render(<CreateStoryPage />, { wrapper });
      expect(screen.getByRole('link')).toBeTruthy();
    });
  });

  describe('con petId en la URL', () => {
    it('fija la mascota y no ofrece selector', () => {
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      myPets = [encontrada];
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(container.querySelector('#story-pet')).toBeNull();
      expect(container.querySelector('form')).toBeTruthy();
    });

    it('corta antes del formulario si esa mascota NO esta encontrada', () => {
      searchParams = new URLSearchParams({ petId: 'pet-lost' });
      myPets = [perdida];
      const { container } = render(<CreateStoryPage />, { wrapper });

      // Validar sólo el camino del selector dejaba este abierto: entrar por URL
      // con una mascota que no califica reproducía el mismo defecto.
      expect(container.querySelector('form')).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
    });
  });

  describe('el formulario', () => {
    beforeEach(() => {
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      myPets = [encontrada];
    });

    it('expone solo los campos que el backend acepta', () => {
      const { container } = render(<CreateStoryPage />, { wrapper });
      expect(container.querySelector('#story-title')).toBeTruthy();
      expect(container.querySelector('#story-body')).toBeTruthy();
      // `hero_name` existe en el tipo de TypeScript y en el render de
      // StoryDetailPage, pero NO en el backend: `rg -i hero backend/` da cero.
      // Gin descarta el campo desconocido sin error, así que un input acá
      // aceptaría texto que no se guarda — la regla #34 exacta.
      expect(container.querySelector('#story-hero')).toBeNull();
    });

    it('marca el relato como obligatorio para tecnologia asistiva', () => {
      const { container } = render(<CreateStoryPage />, { wrapper });
      expect(container.querySelector('#story-body')?.getAttribute('aria-required')).toBe('true');
      expect(container.querySelector('#story-title')?.getAttribute('aria-required')).toBeNull();
    });

    it('al fallar la validacion asocia el mensaje de error con el campo', () => {
      const { container } = render(<CreateStoryPage />, { wrapper });
      fireEvent.submit(container.querySelector('form')!);

      const body = container.querySelector('#story-body')!;
      // No alcanza con que el mensaje aparezca: tiene que estar REFERENCIADO
      // por el control. Sin aria-describedby, role="alert" lo anuncia una vez y
      // después el usuario que vuelve al campo con Tab no escucha nada.
      const describedBy = body.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(body.getAttribute('aria-invalid')).toBe('true');
      expect(container.querySelector(`#${describedBy}`)?.getAttribute('role')).toBe('alert');
      expect(mutate).not.toHaveBeenCalled();
    });

    it('ofrece salir sin publicar ademas de enviar', () => {
      render(<CreateStoryPage />, { wrapper });
      const botones = screen.getAllByRole('button');
      expect(botones.filter((b) => b.getAttribute('type') === 'submit')).toHaveLength(1);
      expect(botones.filter((b) => b.getAttribute('type') === 'button')).toHaveLength(1);
    });
  });
});
