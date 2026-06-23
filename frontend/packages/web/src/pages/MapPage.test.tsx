import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MapPage } from './MapPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseNearbyReports = vi.fn((): { data: any[]; isLoading: boolean } => ({ data: [], isLoading: false }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseNearbyVets = vi.fn((): { data: any[]; isLoading: boolean } => ({ data: [], isLoading: false }));

vi.mock('@shared/hooks', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useNearbyReports: (...args: any[]) => (mockUseNearbyReports as any)(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useNearbyVets: (...args: any[]) => (mockUseNearbyVets as any)(...args),
}));

// Captured so the test can simulate a pan (moveend).
let capturedMoveend: (() => void) | undefined;
const fakeMap = { getCenter: vi.fn(() => ({ lat: -34.9011, lng: -56.1645 })) };

// leaflet uses DOM APIs not available in jsdom
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Circle: () => null,
  useMapEvents: (handlers: { moveend?: () => void }) => {
    capturedMoveend = handlers.moveend;
    return fakeMap;
  },
}));

vi.mock('leaflet', () => ({
  default: { Icon: class {} },
  Icon: class {
    constructor() {}
  },
}));

// jsdom doesn't implement geolocation
Object.defineProperty(globalThis.navigator, 'geolocation', {
  value: {
    getCurrentPosition: vi.fn((success) =>
      success({ coords: { latitude: -34.9011, longitude: -56.1645 } })
    ),
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
  },
  configurable: true,
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MapPage', () => {
  beforeEach(() => {
    capturedMoveend = undefined;
    mockUseNearbyReports.mockReset();
    mockUseNearbyReports.mockReturnValue({ data: [], isLoading: false });
    mockUseNearbyVets.mockReset();
    mockUseNearbyVets.mockReturnValue({ data: [], isLoading: false });
  });

  it('renderiza sin lanzar errores', () => {
    render(<MapPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('renders radius selector with options [1, 3, 5, 10]', () => {
    render(<MapPage />, { wrapper });
    const select = screen.getByRole('combobox');
    const options = select.querySelectorAll('option');
    const values = Array.from(options).map((o) => Number((o as HTMLOptionElement).value));
    expect(values).toEqual([1, 3, 5, 10]);
  });

  it('default radius is 3km', () => {
    render(<MapPage />, { wrapper });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('3');
  });

  it('changing radius triggers new fetch with updated radius', async () => {
    mockUseNearbyReports.mockClear();
    render(<MapPage />, { wrapper });

    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, '10');

    // The last call to useNearbyReports (after radius change) should use radius=10
    const calls = mockUseNearbyReports.mock.calls as unknown[][];
    const lastCall = calls[calls.length - 1];
    expect(lastCall[2]).toBe(10);
  });

  it('shows the "search this area" button after panning beyond the threshold', () => {
    fakeMap.getCenter.mockReturnValue({ lat: -34.9011, lng: -56.1645 });
    render(<MapPage />, { wrapper });

    // Not panned yet — button hidden.
    expect(screen.queryByText('map:searchHere')).toBeNull();

    // Simulate a pan ~5.5 km north, then fire moveend.
    fakeMap.getCenter.mockReturnValue({ lat: -34.8511, lng: -56.1645 });
    act(() => { capturedMoveend?.(); });

    expect(screen.getByText('map:searchHere')).toBeTruthy();
  });

  it('vets toggle button switches its label between show and hide', async () => {
    render(<MapPage />, { wrapper });

    // Inactive: shows the "show veterinaries" label (vets:toggle).
    const showBtn = screen.getByRole('button', { name: /toggle/ });
    expect(showBtn).toBeTruthy();
    expect(screen.queryByRole('button', { name: /hide/ })).toBeNull();

    // Active: label flips to "hide veterinaries" (vets:hide).
    await userEvent.click(showBtn);
    expect(screen.getByRole('button', { name: /hide/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /toggle/ })).toBeNull();
  });

  it('pet popup shows the photo, subtitle (type · breed · color) and details link', () => {
    mockUseNearbyReports.mockReturnValue({
      data: [
        {
          id: 'r1', pet_id: 'p1', reporter_id: 'u1', status: 'lost',
          latitude: -34.9011, longitude: -56.1645, is_verified: false,
          created_at: '2026-06-23T10:00:00Z',
          pet: {
            id: 'p1', name: 'Rex', type: 'perro', breed: 'Labrador', color: 'Negro',
            status: 'lost', created_at: '2026-06-23T10:00:00Z',
            photos: [{ id: 'ph1', url: 'https://img/rex.jpg', is_primary: true }],
          },
        },
      ],
      isLoading: false,
    });

    render(<MapPage />, { wrapper });

    expect(screen.getByAltText('Rex')).toHaveAttribute('src', 'https://img/rex.jpg');
    // t() mock echoes the key, so the type renders as the raw key joined with breed/color.
    expect(screen.getByText('pets:types.perro · Labrador · Negro')).toBeInTheDocument();
    expect(screen.getByText(/map:viewDetails/)).toBeInTheDocument();
  });

  it('vet popup shows the distance and a website link', async () => {
    mockUseNearbyVets.mockReturnValue({
      data: [
        {
          id: 'v1', name: 'VetCare', latitude: -34.9011, longitude: -56.1645,
          address: 'Calle 1', phone: '+59899000000',
          website: 'https://vet.example', opening_hours: 'Mo-Fr 09-18',
          distance_meters: 1200,
        },
      ],
      isLoading: false,
    });

    render(<MapPage />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /toggle/ }));

    expect(screen.getByText('📍 1.2 km')).toBeInTheDocument();
    expect(screen.getByText('website')).toHaveAttribute('href', 'https://vet.example');
  });

  it('clicking "search this area" re-fetches reports at the new center', async () => {
    mockUseNearbyReports.mockClear();
    fakeMap.getCenter.mockReturnValue({ lat: -34.9011, lng: -56.1645 });
    render(<MapPage />, { wrapper });

    fakeMap.getCenter.mockReturnValue({ lat: -34.8511, lng: -56.1645 });
    act(() => { capturedMoveend?.(); });

    await userEvent.click(screen.getByText('map:searchHere'));

    const calls = mockUseNearbyReports.mock.calls as unknown[][];
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toBeCloseTo(-34.8511, 3); // new search lat
  });
});
