import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateReportPage } from './CreateReportPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams()],
  };
});

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMapEvents: () => null,
}));

vi.mock('leaflet', () => {
  const IconDefault = function () {} as unknown as { new(): object; mergeOptions: () => void };
  (IconDefault as unknown as Record<string, unknown>).mergeOptions = () => {};
  const Icon = function () {} as unknown as { new(): object; Default: typeof IconDefault };
  (Icon as unknown as Record<string, unknown>).Default = IconDefault;
  return { default: { Icon }, Icon };
});

vi.mock('@shared/hooks', () => ({
  usePetByID: () => ({ data: null, isLoading: false }),
  useMyPets: () => ({ data: [] }),
  useCreateReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CreateReportPage', () => {
  it('renderiza sin lanzar errores', () => {
    render(<CreateReportPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });
});
