import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SheltersPage } from './SheltersPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

// Mutable so each test can inject its own shelter list.
let sheltersData: unknown[] = [];
vi.mock('@shared/hooks', () => ({
  useStats: () => ({ data: { total_pets: 10, total_found: 5, total_users: 20, total_reports: 30 } }),
  useShelters: () => ({ data: sheltersData, isLoading: false, isError: false }),
}));

const longDescription =
  'Organización sin fines de lucro dedicada al rescate, rehabilitación y adopción responsable de perros y gatos en situación de calle. Trabajan a diario en operaciones de rescate y actividades comunitarias para las mascotas más vulnerables.';

const shelterWithDescription = {
  id: 's1',
  name: 'Refugio Grande',
  city: 'Montevideo',
  phone: '099123456',
  email: 'info@refugio.org',
  website_url: 'https://refugio.org',
  donation_url: 'https://refugio.org/donar',
  description: longDescription,
  is_verified: true,
  created_at: '2026-07-12T00:00:00Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SheltersPage', () => {
  beforeEach(() => {
    sheltersData = [];
  });

  it('renderiza sin lanzar errores', () => {
    render(<SheltersPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  it('muestra mensaje vacío cuando no hay refugios', () => {
    render(<SheltersPage />, { wrapper });
    expect(screen.getByText('shelters:empty')).toBeTruthy();
  });

  it('muestra el CTA de registro apuntando a /shelters/register', () => {
    render(<SheltersPage />, { wrapper });
    const cta = screen.getByText('shelters:registerButton');
    expect(cta.closest('a')?.getAttribute('href')).toBe('/shelters/register');
    expect(screen.queryByText('shelters:contactCta')).toBeNull();
  });

  it('recorta la descripción con line-clamp y ofrece "Ver más"', () => {
    sheltersData = [shelterWithDescription];
    render(<SheltersPage />, { wrapper });

    const desc = screen.getByText(longDescription);
    expect(desc.className).toContain('line-clamp-3');
    expect(screen.getByText('shelters:seeMore')).toBeTruthy();
    // Sin abrir, no hay modal.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('abre un modal con la info completa al tocar "Ver más" y lo cierra', () => {
    sheltersData = [shelterWithDescription];
    render(<SheltersPage />, { wrapper });

    fireEvent.click(screen.getByText('shelters:seeMore'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Refugio Grande')).toBeTruthy();
    expect(within(dialog).getByText(longDescription)).toBeTruthy();
    // La descripción en el modal NO está recortada.
    expect(within(dialog).getByText(longDescription).className).not.toContain('line-clamp-3');

    fireEvent.click(within(dialog).getByText('shelters:close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no muestra "Ver más" en refugios sin descripción', () => {
    sheltersData = [{ ...shelterWithDescription, description: undefined }];
    render(<SheltersPage />, { wrapper });
    expect(screen.queryByText('shelters:seeMore')).toBeNull();
  });
});
