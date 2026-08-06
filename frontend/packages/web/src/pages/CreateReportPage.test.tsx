import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateReportPage } from './CreateReportPage';

// owner_id ata la mascota al usuario logueado: estos tests describen al DUEÑO
// publicando la suya. Sin dueño, canManagePet da false y el formulario solo
// ofrece avistamiento, que es justo lo que se agrego para los terceros.
const USER_ID = 'user-1';
const PET = { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'registered', owner_id: USER_ID, photos: [] };

// Hoisted: vi.mock se eleva por encima de cualquier const normal.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: 'petId=pet-1&status=lost',
  // El componente usa `mutate` con callbacks, NO `mutateAsync`. El mock viejo
  // solo tenia mutateAsync, por eso el smoke test nunca ejercito el envio.
  mutate: vi.fn((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()),
  // El handler de click del mapa, capturado para poder sembrar la coordenada
  // que `validate()` exige: sin eso el submit nunca llega a mutate.
  mapClick: null as null | ((e: { latlng: { lat: number; lng: number } }) => void),
  pet: null as unknown,
  // cuantos renders devuelve isLoading antes de entregar la mascota: reproduce
  // la carga en dos tiempos, que es cuando aparecio el bug del estado pisado.
  rendersCargando: 0,
  myPetsVacio: false,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: USER_ID, name: 'Carlos' }, isAuthenticated: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useSearchParams: () => [new URLSearchParams(mocks.search)],
  };
});

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMapEvents: (handlers: { click?: (e: { latlng: { lat: number; lng: number } }) => void }) => {
    mocks.mapClick = handlers.click ?? null;
    return null;
  },
}));

vi.mock('leaflet', () => {
  const IconDefault = function () {} as unknown as { new(): object; mergeOptions: () => void };
  (IconDefault as unknown as Record<string, unknown>).mergeOptions = () => {};
  const Icon = function () {} as unknown as { new(): object; Default: typeof IconDefault };
  (Icon as unknown as Record<string, unknown>).Default = IconDefault;
  return { default: { Icon }, Icon };
});

// El panel real pide un share link a la API y dibuja un QR. Acá interesa la
// DECISION de mostrarlo, no lo que hace por dentro.
vi.mock('../components/SharePanel', () => ({
  SharePanel: ({ petName }: { petName: string }) => <div data-testid="share-panel">{petName}</div>,
}));

vi.mock('@shared/hooks', () => ({
  usePetByID: () => {
    if (mocks.rendersCargando > 0) { mocks.rendersCargando -= 1; return { data: undefined, isLoading: true }; }
    return { data: mocks.myPetsVacio ? undefined : (mocks.pet ?? PET), isLoading: false };
  },
  // En frio las DOS estan cargando: si solo se simula usePetByID, myPets sigue
  // entregando la mascota y el permiso ya es true en el primer render — el
  // escenario del bug no llega a existir.
  useMyPets: () => (mocks.rendersCargando > 0 || mocks.myPetsVacio ? { data: undefined } : { data: [PET] }),
  useCreateReport: () => ({ mutate: mocks.mutate, mutateAsync: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** Marca un punto en el mapa, que es lo unico que `validate()` exige ademas del petId. */
function marcarUbicacion() {
  act(() => {
    mocks.mapClick?.({ latlng: { lat: -34.9011, lng: -56.1645 } });
  });
}

function enviar() {
  fireEvent.submit(document.querySelector('form')!);
}

beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.mutate.mockClear();
  mocks.mutate.mockImplementation((_v: unknown, o?: { onSuccess?: () => void }) => o?.onSuccess?.());
  mocks.search = 'petId=pet-1&status=lost';
  mocks.mapClick = null;
  mocks.pet = null;
  mocks.rendersCargando = 0;
  mocks.myPetsVacio = false;
});

describe('CreateReportPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<CreateReportPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('sin marcar el mapa no envia nada', () => {
    render(<CreateReportPage />, { wrapper });
    enviar();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

// Publicar la mascota como perdida no termina en el listado: termina en el
// link para compartir, que es lo que hace que la busqueda sirva de algo. Antes
// este formulario mandaba derecho a /pets/mine y el aviso se perdia — el
// wizard tenia su propio paso de exito con el panel, y al unificar los dos
// caminos ese paso quedo afuera.
describe('CreateReportPage — despues de publicar como perdida', () => {
  it('muestra el panel de compartir en vez de irse al listado', () => {
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('share-panel')).toHaveTextContent('Firulais');
    expect(screen.getByText('publish:success.lostTitle')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('manda el occurred_at que el paso de ubicacion del wizard no tenia', () => {
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-08-04' } });
    enviar();

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ pet_id: 'pet-1', status: 'lost' }),
      expect.anything(),
    );
    // El DIA que se lee de vuelta, no un string UTC literal: mandar
    // `2026-08-04T00:00:00Z` guardaba el 3 al oeste de Greenwich.
    const enviado = mocks.mutate.mock.calls[0][0] as { occurred_at?: string };
    const vuelta = new Date(enviado.occurred_at!);
    expect(
      `${vuelta.getFullYear()}-${String(vuelta.getMonth() + 1).padStart(2, '0')}-${String(vuelta.getDate()).padStart(2, '0')}`,
    ).toBe('2026-08-04');
  });

  // Un avistamiento no abre ninguna busqueda ni cambia el estado de la
  // mascota, asi que no hay aviso propio que compartir: sigue yendo al listado.
  it('un avistamiento sigue volviendo al listado, sin panel de compartir', () => {
    mocks.search = 'petId=pet-1&status=sighting';
    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/pets/mine');
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
  });
});

// Cambiar el estado de la mascota lo decide su dueño, y el backend lo rechaza
// con 403. El formulario esconde esas opciones para no dejar que un tercero lo
// llene entero y recien ahi se entere. Le queda el avistamiento, que es como
// aporta al seguimiento — despues se coordina por el chat o WhatsApp.
describe('CreateReportPage — una mascota ajena', () => {
  const ajena = { id: 'pet-9', name: 'Nala', type: 'perro', status: 'lost', owner_id: 'otro-usuario', photos: [] };

  it('a un tercero solo le ofrece avistamiento', () => {
    mocks.pet = ajena;
    mocks.search = 'petId=pet-9';

    render(<CreateReportPage />, { wrapper });

    expect(screen.getByText('pets:card.sighting')).toBeInTheDocument();
    expect(screen.queryByText('pets:card.lost')).not.toBeInTheDocument();
    expect(screen.queryByText('pets:card.found')).not.toBeInTheDocument();
  });

  // Entrar a mano con ?status=lost a una mascota ajena no debe mandar `lost`:
  // se cae a avistamiento en vez de armar un request que el backend rechaza.
  it('con ?status=lost en la URL igual manda un avistamiento', () => {
    mocks.pet = ajena;
    mocks.search = 'petId=pet-9&status=lost';

    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ pet_id: 'pet-9', status: 'sighting' }),
      expect.anything(),
    );
  });
});

// La mascota no llega en el primer render. Con un useEffect que pisaba `status`
// cuando el usuario "no podia" cambiarlo, ese primer render —sin mascota, o sea
// sin permiso— lo reescribia a sighting, y nada lo devolvia al cargar. La DUEÑA
// entrando en frio a ?status=lost terminaba publicando un avistamiento.
//
// Con caché caliente no se reproduce, que es por que los otros tests no lo veian:
// mockean la mascota con isLoading false desde el primer render.
describe('CreateReportPage — la mascota carga despues del primer render', () => {
  it('la dueña con ?status=lost sigue mandando lost aunque la mascota tarde', () => {
    mocks.rendersCargando = 2; // los primeros renders no tienen la mascota
    mocks.search = 'petId=pet-1&status=lost';

    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ pet_id: 'pet-1', status: 'lost' }),
      expect.anything(),
    );
  });
});

// "No tenes permiso" y "no pude cargar la mascota" son lo mismo para
// canManagePet: los dos dan false. Pero significan cosas OPUESTAS. Colapsarlos
// hacia que el dueño abriera ?status=lost con la API caida —un arranque en frio
// de Render alcanza—, se publicara un AVISTAMIENTO, y lo mandaramos al listado
// como si hubiera salido bien. La busqueda nunca se abria y nadie se lo decia.
describe('CreateReportPage — la mascota no se pudo cargar', () => {
  it('no publica nada y avisa, en vez de degradar el pedido a avistamiento', () => {
    mocks.pet = undefined;        // usePetByID devuelve vacio, ya sin cargar
    mocks.myPetsVacio = true;     // y myPets tampoco la tiene
    mocks.search = 'petId=pet-1&status=lost';

    render(<CreateReportPage />, { wrapper });
    marcarUbicacion();
    enviar();

    expect(mocks.mutate).not.toHaveBeenCalled();
    // Aparece dos veces: el bloque de la mascota ya decia 'no encontrada'
    // ANTES de este arreglo, y aun asi el formulario se enviaba. Lo que faltaba
    // no era el mensaje, era cortar el envio.
    expect(screen.getAllByText('pets:detail.notFound').length).toBeGreaterThan(0);
  });
});
