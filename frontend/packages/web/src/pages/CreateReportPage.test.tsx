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
  usePetByID: () => ({ data: mocks.pet ?? PET, isLoading: false }),
  useMyPets: () => ({ data: [PET] }),
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
      expect.objectContaining({ pet_id: 'pet-1', status: 'lost', occurred_at: '2026-08-04T00:00:00Z' }),
      expect.anything(),
    );
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
