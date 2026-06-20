import { describe, it, expect, vi } from 'vitest';
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

const mockUseNearbyReports = vi.fn(() => ({ data: [], isLoading: false }));

vi.mock('@shared/hooks', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useNearbyReports: (...args: any[]) => (mockUseNearbyReports as any)(...args),
  useNearbyVets: () => ({ data: [], isLoading: false }),
}));

// leaflet uses DOM APIs not available in jsdom
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Circle: () => null,
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
});
