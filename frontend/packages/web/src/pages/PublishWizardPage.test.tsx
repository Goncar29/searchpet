import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { PublishWizardPage } from './PublishWizardPage';
import { useMyPets, useCreatePet } from '@shared/hooks';
import { apiClient } from '@shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => ({
    t: (key: string) => `${Array.isArray(ns) ? ns[0] : ns}:${key}`,
    i18n: { language: 'es' },
  }),
}));

const authState = {
  isAuthenticated: true,
  user: { id: 'user-1', name: 'Carlos' } as { id: string; name: string } | null,
  login: vi.fn(),
  register: vi.fn(),
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

// Prefixed with `mock` so Vitest allows referencing it inside the hoisted
// vi.mock factory below — a stable reference (unlike a fresh vi.fn() built
// inside the factory) so assertions can inspect the exact call it received,
// since PublishWizardPage re-renders (and re-invokes useCreatePet) many times.
const mockCreatePetMutateAsync = vi.fn().mockResolvedValue({ id: 'pet-3', name: 'Sin nombre', type: 'perro', status: 'adoption', city: 'Montevideo', photos: [] });

vi.mock('@shared/hooks', () => ({
  useMyPets: vi.fn(() => ({ data: [], isLoading: false })),
  usePublishLost: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'lost', photos: [] }), isPending: false })),
  usePublishStray: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ pet: { id: 'pet-2', name: 'Sin nombre', type: 'perro', status: 'stray', photos: [] }, failedPhotoIndexes: [] }), isPending: false })),
  useCreatePet: vi.fn(() => ({ mutateAsync: mockCreatePetMutateAsync, isPending: false })),
  useUploadPhoto: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@shared/api/client', () => ({
  apiClient: {
    getPetByID: vi.fn().mockResolvedValue({ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'lost', photos: [] }),
  },
}));

vi.mock('../components/SharePanel', () => ({
  SharePanel: ({ pet }: { pet: { photos?: unknown[] } }) => (
    <div data-testid="share-panel" data-photo-count={pet.photos?.length ?? 0} />
  ),
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({
    position,
    eventHandlers,
  }: {
    position: [number, number];
    eventHandlers?: { dragend?: (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => void };
  }) => (
    <button
      data-testid="marker"
      onClick={() =>
        eventHandlers?.dragend?.({
          target: { getLatLng: () => ({ lat: position[0], lng: position[1] }) },
        })
      }
    >
      marker
    </button>
  ),
  useMap: () => ({ setView: vi.fn() }),
}));

vi.mock('leaflet', () => ({
  default: { Icon: class { constructor() {} } },
}));

// Expone la ubicación actual para poder afirmar a dónde navega el wizard.
// Sin esto, una navegación no deja rastro observable en el DOM y un test que
// "pasa" no distingue haber navegado de no haber hecho nada.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{`${location.pathname}${location.search}`}</span>;
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        {children}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PublishWizardPage', () => {
  it('renders the intent step first with three cards', () => {
    render(<PublishWizardPage />, { wrapper });
    expect(screen.getByText('publish:intent.lostTitle')).toBeInTheDocument();
    expect(screen.getByText('publish:intent.strayTitle')).toBeInTheDocument();
    expect(screen.getByText('adoption:publish.intentOption')).toBeInTheDocument();
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

  it('selecting the adoption intent advances to the adoption-form step with a city field', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('adoption:publish.intentOption'));
    expect(screen.getByText('adoption:publish.title')).toBeInTheDocument();
    expect(screen.getByLabelText('adoption:publish.cityLabel')).toBeInTheDocument();
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

  it('lista solo las registradas y deriva al formulario de reporte que ya existe', () => {
    // Elegir la mascota no abre el paso de ubicación del wizard: manda al
    // formulario de reporte, que termina en el mismo lugar (POST /api/reports
    // con status "lost" transiciona la mascota dentro de la transacción) y
    // además pide la fecha, que el paso de ubicación no tiene.
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

    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/reports/create?petId=pet-1&status=lost',
    );
    // El paso de ubicación del wizard ya no participa de este camino.
    expect(screen.queryByText('publish:location.title')).not.toBeInTheDocument();
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

describe('PublishWizardPage — adoption path', () => {
  it('blocks submitting without a photo, type or city, then publishes with status "adoption" and the entered city', async () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('adoption:publish.intentOption'));

    fireEvent.click(screen.getByText('adoption:publish.submit'));
    expect(screen.getByText('publish:strayForm.photoRequired')).toBeInTheDocument();
    expect(screen.getByText('publish:strayForm.typeRequired')).toBeInTheDocument();
    expect(screen.getByText('adoption:publish.cityRequired')).toBeInTheDocument();

    const file = new File(['fake'], 'adoption.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('publish:strayForm.photoLabel'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'gato' } });
    fireEvent.change(screen.getByLabelText('adoption:publish.cityLabel'), { target: { value: 'Montevideo' } });

    fireEvent.click(screen.getByText('adoption:publish.submit'));

    expect(await screen.findByText('publish:success.adoptionTitle')).toBeInTheDocument();
    expect(useCreatePet).toHaveBeenCalled();
    expect(mockCreatePetMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'adoption', city: 'Montevideo', type: 'gato' })
    );
  });
});

describe('PublishWizardPage — location step', () => {
  // Se llega por el camino de callejera, que es el único que queda usando el
  // paso de ubicación del wizard: el de mascota perdida deriva al formulario
  // de reporte.
  it('renders the map with a default center and publishes with the selected location', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('publish:strayForm.photoLabel'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'perro' } });
    fireEvent.click(screen.getByText('publish:strayForm.next'));

    expect(screen.getByText('publish:location.title')).toBeInTheDocument();
    expect(screen.getByTestId('map')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('publish:location.noteLabel'), { target: { value: 'Cerca de la plaza' } });
    fireEvent.click(screen.getByText('publish:location.publish'));

    // Con sesión abierta publica directo — no aparece el paso de auth.
    expect(screen.queryByText('publish:auth.title')).not.toBeInTheDocument();
  });
});

describe('PublishWizardPage — success step', () => {
  // El camino "mascota perdida" ya no publica desde el wizard: deriva al
  // formulario de reporte, que tiene su propia pantalla de éxito. Lo que este
  // archivo cubre de ese camino es a dónde deriva (ver "lost path").

  it('refetches the published stray pet so SharePanel gets the uploaded photos', async () => {
    vi.mocked(apiClient.getPetByID).mockResolvedValue({
      id: 'pet-2',
      name: 'Sin nombre',
      type: 'perro',
      status: 'stray',
      photos: [{ id: 'photo-1', url: 'https://example.com/photo.jpg' }],
    } as unknown as Awaited<ReturnType<typeof apiClient.getPetByID>>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText('publish:strayForm.photoLabel') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'perro' } });
    fireEvent.click(screen.getByText('publish:strayForm.next'));

    fireEvent.click(screen.getByText('publish:location.publish'));

    expect(await screen.findByText('publish:success.strayTitle')).toBeInTheDocument();
    expect(apiClient.getPetByID).toHaveBeenCalledWith('pet-2');
    expect(screen.getByTestId('share-panel')).toHaveAttribute('data-photo-count', '1');
  });
});

describe('PublishWizardPage — unauthenticated stray path', () => {
  const initialAuthState = {
    isAuthenticated: authState.isAuthenticated,
    user: authState.user,
    login: authState.login,
    register: authState.register,
  };

  afterEach(() => {
    authState.isAuthenticated = initialAuthState.isAuthenticated;
    authState.user = initialAuthState.user;
    authState.login = initialAuthState.login;
    authState.register = initialAuthState.register;
  });

  it('shows inline auth at PUBLICAR, preserves wizard state, and publishes after registration', async () => {
    authState.isAuthenticated = false;
    authState.user = null;
    const registerMock = vi.fn().mockImplementation(async () => {
      authState.isAuthenticated = true;
      authState.user = { id: 'user-2', name: 'Carlos' };
    });
    authState.register = registerMock;

    render(<PublishWizardPage />, { wrapper });

    // Stray path: select intent, fill form, fill location.
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));
    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('publish:strayForm.photoLabel'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'gato' } });
    fireEvent.click(screen.getByText('publish:strayForm.next'));
    fireEvent.change(screen.getByLabelText('publish:location.noteLabel'), { target: { value: 'Plaza central' } });
    fireEvent.click(screen.getByText('publish:location.publish'));

    // Inline auth appears — wizard state (note) is preserved in memory.
    expect(await screen.findByText('publish:auth.title')).toBeInTheDocument();

    // Switch to register tab, fill fields, submit.
    fireEvent.click(screen.getByText('publish:auth.registerTab'));
    fireEvent.change(screen.getByLabelText('auth:register.name'), { target: { value: 'Carlos' } });
    fireEvent.change(screen.getByLabelText('auth:register.email'), { target: { value: 'carlos@test.com' } });
    fireEvent.change(screen.getByLabelText('auth:register.password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('publish:auth.continue'));

    expect(await screen.findByText('publish:success.strayTitle')).toBeInTheDocument();
    expect(registerMock).toHaveBeenCalledWith('carlos@test.com', 'password123', 'Carlos', undefined, undefined);
  });
});

describe('PublishWizardPage — unauthenticated lost path', () => {
  const initialAuthState = {
    isAuthenticated: authState.isAuthenticated,
    user: authState.user,
    login: authState.login,
    register: authState.register,
  };

  afterEach(() => {
    authState.isAuthenticated = initialAuthState.isAuthenticated;
    authState.user = initialAuthState.user;
    authState.login = initialAuthState.login;
    authState.register = initialAuthState.register;
  });

  it('routes a guest selecting "lost" to inline auth instead of the dead-end empty state', async () => {
    authState.isAuthenticated = false;
    authState.user = null;
    const loginMock = vi.fn().mockImplementation(async () => {
      authState.isAuthenticated = true;
      authState.user = { id: 'user-3', name: 'Carlos' };
    });
    authState.login = loginMock;

    vi.mocked(useMyPets).mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });

    fireEvent.click(screen.getByText('publish:intent.lostTitle'));

    // Guest must see inline auth, never the empty-state dead-end.
    expect(await screen.findByText('publish:auth.title')).toBeInTheDocument();
    expect(screen.queryByText('publish:lostPet.empty')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('auth:register.email'), { target: { value: 'carlos@test.com' } });
    fireEvent.change(screen.getByLabelText('auth:register.password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByText('publish:auth.continue'));

    // After auth, lost flow advances to lost-pet selection (not auto-submit).
    expect(await screen.findByText('Firulais')).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledWith('carlos@test.com', 'password123');
  });
});

describe('PublishWizardPage — publish another', () => {
  it('resets the wizard to the intent step when clicking "publish another"', async () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    const file = new File(['fake'], 'stray.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('publish:strayForm.photoLabel'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('publish:strayForm.typeLabel'), { target: { value: 'perro' } });
    fireEvent.click(screen.getByText('publish:strayForm.next'));
    fireEvent.click(screen.getByText('publish:location.publish'));

    expect(await screen.findByText('publish:success.strayTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('publish:success.publishAnother'));

    expect(screen.getByText('publish:intent.lostTitle')).toBeInTheDocument();
    expect(screen.getByText('publish:intent.strayTitle')).toBeInTheDocument();
    expect(screen.queryByText('publish:success.strayTitle')).not.toBeInTheDocument();
  });
});

// Los dos defectos que reportó el usuario sobre /publish, ninguno cubierto antes.
describe('PublishWizardPage — el usuario ya tiene mascotas propias', () => {
  it('con mascotas propias pero ninguna elegible, manda a Mis mascotas y no a crear otra', () => {
    // El usuario tiene UNA mascota, ya publicada como perdida. No es elegible
    // para volver a publicarse, pero decirle "no tenés mascotas registradas" y
    // ofrecerle registrar otra es falso: la tiene, y la ve en Mis mascotas.
    vi.mocked(useMyPets).mockReturnValue({
      data: [{ id: 'pet-1', name: 'Holly', type: 'perro', status: 'lost', photos: [] }],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));

    expect(screen.getByText('publish:lostPet.noneEligible')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publish:lostPet.noneEligibleAction' })).toHaveAttribute(
      'href',
      '/pets/mine',
    );
    // El mensaje de "no tenés ninguna" no puede aparecer cuando sí tiene.
    expect(screen.queryByText('publish:lostPet.empty')).not.toBeInTheDocument();
  });

  it('sin ninguna mascota sigue ofreciendo registrar una', () => {
    vi.mocked(useMyPets).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));

    expect(screen.getByText('publish:lostPet.empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publish:lostPet.emptyAction' })).toHaveAttribute(
      'href',
      '/pets/create',
    );
  });
});

describe('PublishWizardPage — salir del paso elegido', () => {
  // Elegir una de las tres opciones era un camino de ida: ningun paso recibia
  // onBack, asi que la unica salida era navegar a otra parte del sitio.
  it('vuelve a las tres opciones desde el paso de mascota perdida', () => {
    vi.mocked(useMyPets).mockReturnValue({
      data: [{ id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', photos: [] }],
      isLoading: false,
    } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    expect(screen.getByText('publish:lostPet.title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'publish:back' }));
    expect(screen.getByText('publish:intent.title')).toBeInTheDocument();
  });

  it('vuelve a las tres opciones desde el estado vacio, que es donde el usuario quedaba trabado', () => {
    vi.mocked(useMyPets).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useMyPets>);

    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.lostTitle'));
    fireEvent.click(screen.getByRole('button', { name: 'publish:back' }));

    expect(screen.getByText('publish:intent.title')).toBeInTheDocument();
  });

  it('vuelve a las tres opciones desde el formulario de callejera', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));
    expect(screen.getByText('publish:strayForm.title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'publish:back' }));
    expect(screen.getByText('publish:intent.title')).toBeInTheDocument();
  });

  it('vuelve a las tres opciones desde el formulario de adopcion', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('adoption:publish.intentOption'));
    expect(screen.getByText('adoption:publish.title')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'publish:back' }));
    expect(screen.getByText('publish:intent.title')).toBeInTheDocument();
  });

  it('descarta lo cargado al volver, asi no reaparece al reelegir la opcion', () => {
    render(<PublishWizardPage />, { wrapper });
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    const breed = screen.getByLabelText('publish:strayForm.breedLabel');
    fireEvent.change(breed, { target: { value: 'Husky' } });
    expect(breed).toHaveValue('Husky');

    fireEvent.click(screen.getByRole('button', { name: 'publish:back' }));
    fireEvent.click(screen.getByText('publish:intent.strayTitle'));

    expect(screen.getByLabelText('publish:strayForm.breedLabel')).toHaveValue('');
  });
});
