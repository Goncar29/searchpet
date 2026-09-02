import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateStoryPage } from './CreateStoryPage';
import { MY_PETS_ROUTE } from '../routes';

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
const uploadPhotoMutate = vi.fn();
let historiaExistente: unknown = undefined;
let myPets: unknown[] = [];
let reportedPets: unknown[] = [];
// Una query que FALLA devuelve `data: undefined`, no una lista vacía. El mock
// tiene que poder representar esa diferencia, o el arnés no puede ver el bug.
let mineFailed = false;
let reportedFailed = false;
// `isPending` (nunca hubo dato) e `isFetching` (hay un pedido en vuelo, aunque
// ya haya caché) son ESTADOS DISTINTOS, y el mock tiene que poder separarlos:
// con caché stale, `isLoading` de React Query v5 ya es false y la pantalla
// decidiría sobre datos viejos.
let refetching = false;
const refetchMine = vi.fn();
const refetchReported = vi.fn();
vi.mock('@shared/hooks', () => ({
  useCreateStory: () => ({ mutate, isPending: false }),
  // Todo hook nuevo usado por la pantalla tiene que estar acá: el mock es
  // exhaustivo, así que olvidarse no da un error claro — tira las 20 pruebas
  // del archivo con "is not a function" (regla #17).
  useUploadStoryPhoto: () => ({ mutate: uploadPhotoMutate, isPending: false }),
  // El endpoint devuelve 404 cuando NO hay historia, así que la ausencia llega
  // como ERROR y no como `data: null`. El mock tiene que poder representar los
  // TRES estados o el arnés no puede ver la diferencia que importa.
  useStoryByPetID: () => ({
    data: historiaExistente,
    isError: !historiaExistente,
  }),
  useMyPets: () => ({
    data: mineFailed ? undefined : myPets,
    isPending: false,
    isFetching: refetching,
    isError: mineFailed,
    refetch: refetchMine,
  }),
  useReportedPets: () => ({
    data: reportedFailed ? undefined : reportedPets,
    isPending: false,
    isFetching: refetching,
    isError: reportedFailed,
    refetch: refetchReported,
  }),
}));

const encontrada = { id: 'pet-found', name: 'Luna', type: 'perro', status: 'found' };
const perdida = { id: 'pet-lost', name: 'Toby', type: 'gato', status: 'lost' };

beforeEach(() => {
  mutate.mockClear();
  uploadPhotoMutate.mockClear();
  historiaExistente = undefined;
  refetchMine.mockClear();
  refetchReported.mockClear();
  searchParams = new URLSearchParams();
  myPets = [];
  reportedPets = [];
  mineFailed = false;
  reportedFailed = false;
  refetching = false;
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

    /**
     * El CTA se sigue hasta el DESTINO, no se le mira el `href`.
     *
     * `routes.ts` documenta por qué: un link a `/my-pets` —que no es ruta de
     * esta app— dejaba la página en blanco, y lo que dejó pasar el defecto fue
     * un test que afirmaba el string del href en vez del destino. La versión
     * anterior de este test hacía `getByRole('link')` y nada más: habría pasado
     * en verde con el link apuntando a cualquier lado.
     *
     * La aserción NO puede ser sobre texto que rendericen las dos pantallas.
     * Se monta MyPetsPage como destino y se afirma sobre su barra de pestañas,
     * que es de ella y de nadie más.
     */
    it('el CTA lleva a una ruta que EXISTE', () => {
      myPets = [];
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/stories/create']}>
            <Routes>
              <Route path="/stories/create" element={<CreateStoryPage />} />
              <Route path={MY_PETS_ROUTE} element={<div data-testid="destino-mis-mascotas" />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByRole('link'));
      expect(screen.getByTestId('destino-mis-mascotas')).toBeTruthy();
    });
  });

  describe('cuando una lista no se pudo cargar', () => {
    it('NO dice que el usuario no tiene mascotas', () => {
      // El bug: `data ?? []` vuelve una query fallida indistinguible de una
      // lista vacía, así que quien tiene una mascota elegible y se come un 500
      // lee "todavía no tenés ninguna" — falso, sin reintento y sin pista de
      // que hubo un fallo. Convención del repo: MyShelterPage.tsx:76.
      reportedFailed = true;
      myPets = [];
      const { container } = render(<CreateStoryPage />, { wrapper });

      const h2 = container.querySelector('h2')?.textContent ?? '';
      expect(h2).toContain('loadError');
      expect(h2).not.toContain('noEligible');
    });

    it('ofrece reintentar, y reintenta LAS DOS', () => {
      mineFailed = true;
      render(<CreateStoryPage />, { wrapper });

      fireEvent.click(screen.getByRole('button'));
      // Cualquiera de las dos pudo ser la que falló, y el usuario no sabe cuál.
      expect(refetchMine).toHaveBeenCalled();
      expect(refetchReported).toHaveBeenCalled();
    });

    it('tampoco afirma nada sobre una mascota pedida por URL', () => {
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      mineFailed = true;
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(container.querySelector('h2')?.textContent ?? '').toContain('loadError');
    });
  });

  describe('con datos viejos en la cache', () => {
    it('NO emite un veredicto negativo mientras se esta refrescando', () => {
      // El camino real: marcar una mascota como encontrada invalida ['pets']
      // pero NO refetchea (esa query no esta montada), y el nudge navega del
      // lado del cliente, asi que la cache sobrevive. Esta pantalla monta con
      // la fila VIEJA en 'lost' — y en React Query v5 `isLoading` ya es false
      // porque hay cache. Decidir ahi le dice al usuario "todavia no esta
      // marcada como encontrada" segundos despues de marcarla.
      searchParams = new URLSearchParams({ petId: 'pet-lost' });
      myPets = [perdida];
      refetching = true;
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.querySelector('form')).toBeNull();
    });

    it('el veredicto POSITIVO si puede salir de la cache', () => {
      // Mostrar el formulario de mas no le miente a nadie: si la mascota
      // resulta no calificar, el backend lo dice. Bloquear la pantalla en cada
      // refetch de fondo seria peor.
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      myPets = [encontrada];
      refetching = true;
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(container.querySelector('form')).toBeTruthy();
    });
  });

  describe('cuando una lista falla pero la otra alcanza', () => {
    it('deja escribir igual si la mascota pedida ya esta cargada', () => {
      // Ese camino funcionaba antes de este PR: negar la pantalla entera
      // cuando /pets/mine YA trajo la mascota es peor que el problema.
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      myPets = [encontrada];
      reportedFailed = true;
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(container.querySelector('form')).toBeTruthy();
      // Pero se avisa que la lista puede estar incompleta.
      expect(container.querySelector('[role="status"]')).toBeTruthy();
    });

    it('bloquea solo cuando no queda nada que ofrecer', () => {
      myPets = [];
      reportedFailed = true;
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(container.querySelector('form')).toBeNull();
      expect(container.querySelector('h2')?.textContent ?? '').toContain('loadError');
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
      const alerta = container.querySelector('[role="alert"]')?.textContent ?? '';
      // La mascota SI está en sus listas, así que el motivo es el estado.
      expect(alerta).toContain('petNotEligible');
    });

    it('no afirma el estado de una mascota que no esta en sus listas', () => {
      searchParams = new URLSearchParams({ petId: 'de-otro-usuario' });
      myPets = [encontrada];
      const { container } = render(<CreateStoryPage />, { wrapper });

      // Decir "todavía no está marcada como encontrada" sobre una mascota que
      // no conocemos es afirmar algo que el código no puede sostener — y con un
      // id ajeno, contarle al usuario el estado de una mascota que ni siquiera
      // puede ver.
      const alerta = container.querySelector('[role="alert"]')?.textContent ?? '';
      expect(alerta).toContain('petNotFound');
      expect(alerta).not.toContain('petNotEligible');
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
      // `#story-hero` AHORA SÍ, y la historia de esta línea vale contarla.
      //
      // Antes decía `toBeNull()`, y estaba bien: `hero_name` vivía en el tipo de
      // TypeScript y en el render de StoryDetailPage, pero NO en el backend
      // —`rg -i hero backend/` daba cero—, así que un input acá habría aceptado
      // texto que Gin descarta sin error y nunca se guarda. Este test impidió
      // que alguien agregara el campo mientras la columna no existía.
      //
      // La columna ya existe (`success_stories.hero_name`, size:255) y viaja de
      // punta a punta, con su propio guard en
      // `TestSuccessStoryCreate_heroNameViajaDePuntaAPunta`. Así que el guard se
      // da vuelta: ahora protege que el campo ESTÉ.
      expect(container.querySelector('#story-hero')).toBeTruthy();
    });

    // La otra mitad: que lo escrito llegue al payload. Sin esto, el input podría
    // existir y no mandarse — exactamente el estado que el test de arriba
    // impedía, sólo que con un campo de más en pantalla en vez de uno de menos.
    it('el agradecimiento viaja en el payload, recortado', () => {
      const { container } = render(<CreateStoryPage />, { wrapper });

      fireEvent.change(container.querySelector('#story-hero')!, {
        target: { value: '  la vecina del kiosco  ' },
      });
      fireEvent.change(container.querySelector('#story-body')!, { target: { value: 'volvió' } });
      fireEvent.submit(container.querySelector('form')!);

      expect(mutate.mock.calls[0][0].hero_name).toBe('la vecina del kiosco');
    });

    // Vacío se manda `undefined` y no `""`: es opcional, y una cadena vacía
    // ocuparía la columna con nada en vez de dejarla ausente.
    it('sin agradecimiento no manda el campo', () => {
      const { container } = render(<CreateStoryPage />, { wrapper });

      fireEvent.change(container.querySelector('#story-body')!, { target: { value: 'volvió' } });
      fireEvent.submit(container.querySelector('form')!);

      expect(mutate.mock.calls[0][0].hero_name).toBeUndefined();
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

  // ============================================================
  // La foto del reencuentro — OPCIONAL
  // ============================================================
  describe('la foto del reencuentro', () => {
    function completarYEnviar(container: HTMLElement) {
      fireEvent.change(screen.getByLabelText(/create.bodyLabel/), {
        target: { value: 'La encontramos en la esquina' },
      });
      fireEvent.submit(container.querySelector('form')!);
    }

    function elegirArchivo(file: File) {
      const input = document.getElementById('story-photo') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
    }

    const jpg = () => new File(['x'], 'reencuentro.jpg', { type: 'image/jpeg' });

    it('sin foto publica igual: es opcional', () => {
      myPets = [encontrada];
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      const { container } = render(<CreateStoryPage />, { wrapper });

      completarYEnviar(container);

      expect(uploadPhotoMutate).not.toHaveBeenCalled();
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0][0].photo_after).toBeUndefined();
    });

    // El orden importa: primero sube, y la historia se crea con la URL que
    // devuelve. Al revés quedaría una historia sin su foto.
    it('con foto sube primero y publica con la URL que vuelve', () => {
      myPets = [encontrada];
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      uploadPhotoMutate.mockImplementation((_vars, opts) =>
        opts.onSuccess({ url: 'https://cloudinary/ok.webp' }),
      );
      const { container } = render(<CreateStoryPage />, { wrapper });

      elegirArchivo(jpg());
      completarYEnviar(container);

      expect(uploadPhotoMutate).toHaveBeenCalledTimes(1);
      expect(uploadPhotoMutate.mock.calls[0][0]).toMatchObject({ petId: 'pet-found' });
      expect(mutate.mock.calls[0][0].photo_after).toBe('https://cloudinary/ok.webp');
    });

    // La decision de diseño que este test protege: si la foto falla, la historia
    // NO se publica. Publicarla sin foto dejaria al usuario creyendo que subio
    // una imagen que no esta — y no tendria como enterarse.
    it('si la foto falla NO publica la historia, y lo dice', async () => {
      myPets = [encontrada];
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      uploadPhotoMutate.mockImplementation((_vars, opts) => opts.onError(new Error('boom')));
      const { container } = render(<CreateStoryPage />, { wrapper });

      elegirArchivo(jpg());
      completarYEnviar(container);

      expect(mutate).not.toHaveBeenCalled();
      expect(await screen.findByText(/create.photoUploadFailed/)).toBeInTheDocument();
    });

    // Se rechaza en el cliente ANTES de gastar una subida. El backend valida
    // igual —y es la autoridad, porque detecta el MIME leyendo los bytes— pero
    // enterarse recien al enviar cuesta el borrador entero.
    it('rechaza un archivo que no es imagen sin intentar subirlo', () => {
      myPets = [encontrada];
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      const { container } = render(<CreateStoryPage />, { wrapper });

      elegirArchivo(new File(['x'], 'notas.pdf', { type: 'application/pdf' }));
      expect(screen.getByText(/create.photoWrongType/)).toBeInTheDocument();

      completarYEnviar(container);
      expect(uploadPhotoMutate).not.toHaveBeenCalled();
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0][0].photo_after).toBeUndefined();
    });

    it('rechaza una foto de mas de 5 MB', () => {
      myPets = [encontrada];
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      render(<CreateStoryPage />, { wrapper });

      const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.jpg', {
        type: 'image/jpeg',
      });
      elegirArchivo(grande);

      expect(screen.getByText(/create.photoTooLarge/)).toBeInTheDocument();
    });
  });

  // ============================================================
  // Una mascota, una historia
  // ============================================================
  describe('cuando la mascota ya tiene su historia', () => {
    beforeEach(() => {
      searchParams = new URLSearchParams({ petId: 'pet-found' });
      myPets = [encontrada];
    });

    // El backend rechaza la segunda con 409. Sin este aviso el usuario escribe
    // el relato entero para que se lo devuelvan — el mismo defecto que esta
    // pantalla ya cerraba para el estado `found`, por otra causa.
    it('avisa ANTES de escribir y no deja publicar', () => {
      historiaExistente = { id: 'st-1', pet_id: 'pet-found' };
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(screen.getByText(/create.alreadyHasStory/)).toBeInTheDocument();
      const submit = [...container.querySelectorAll('button')].find(
        (b) => b.getAttribute('type') === 'submit',
      );
      expect(submit).toBeDisabled();
    });

    it('ni siquiera intenta publicar si se fuerza el submit', () => {
      historiaExistente = { id: 'st-1', pet_id: 'pet-found' };
      const { container } = render(<CreateStoryPage />, { wrapper });

      fireEvent.change(container.querySelector('#story-body')!, { target: { value: 'otra vez' } });
      fireEvent.submit(container.querySelector('form')!);

      expect(mutate).not.toHaveBeenCalled();
      expect(uploadPhotoMutate).not.toHaveBeenCalled();
    });

    // La distincion que importa: 404 significa "no tiene", no "fallo".
    // Bloquear ante cualquier error le negaria la pantalla a alguien por un 500
    // pasajero, y el backend rechaza igual con un mensaje claro.
    it('sin historia (404) deja escribir con normalidad', () => {
      historiaExistente = undefined;
      const { container } = render(<CreateStoryPage />, { wrapper });

      expect(screen.queryByText(/create.alreadyHasStory/)).toBeNull();
      fireEvent.change(container.querySelector('#story-body')!, { target: { value: 'volvio' } });
      fireEvent.submit(container.querySelector('form')!);

      expect(mutate).toHaveBeenCalledTimes(1);
    });
  });
});
