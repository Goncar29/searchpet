import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { SharedPetPage } from './SharedPetPage';

const { mockUseSharedPet } = vi.hoisted(() => ({ mockUseSharedPet: vi.fn() }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useParams: () => ({ token: 'share-token-abc' }) };
});

vi.mock('@shared/hooks', () => ({
  useSharedPet: () => mockUseSharedPet(),
}));

vi.mock('@shared/utils/whatsappTemplates', () => ({
  buildWhatsAppContactURL: () => 'https://wa.me/',
}));

// Mirror the rest of the web tests: t returns the key, so assertions key off
// hrefs / the literal brand rather than translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <HelmetProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('SharedPetPage', () => {
  beforeEach(() => {
    mockUseSharedPet.mockReset();
  });

  it('renderiza el spinner de carga cuando isLoading=true', () => {
    mockUseSharedPet.mockReturnValue({ data: null, isLoading: true });
    render(<SharedPetPage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  describe('cuando hay datos de la mascota', () => {
    beforeEach(() => {
      mockUseSharedPet.mockReturnValue({
        data: {
          pet: { id: 'pet-1', name: 'Firulais', type: 'perro', status: 'lost', photos: [] },
          owner: null,
        },
        isLoading: false,
      });
    });

    it('el logo del header (marca SearchPet) lleva a la home', () => {
      render(<SharedPetPage />, { wrapper });
      // El brand "SearchPet" es literal (no se traduce) — único link con ese texto.
      const logo = screen.getByRole('link', { name: /SearchPet/i });
      expect(logo.getAttribute('href')).toBe('/');
    });

    it('ofrece un acceso a la web (home) y otro a la descarga de la app', () => {
      render(<SharedPetPage />, { wrapper });
      const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/');          // logo + botón "Explorar"
      expect(hrefs).toContain('/descargar'); // link de descarga
    });
  });
});
