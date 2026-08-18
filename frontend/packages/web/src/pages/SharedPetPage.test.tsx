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
      expect(hrefs).toContain('/download'); // link de descarga
    });
  });

  // ── Miniaturas ───────────────────────────────────────────────────────────
  // Esta es la landing PUBLICA de las redes sociales, o sea la pantalla que
  // CLAUDE.md identifica como el escenario que quema creditos de Cloudinary:
  // "un pico viral que carga la landing publica". Servia la foto de 1200 en la
  // principal Y en cada miniatura de la tira. Con tres fotos eran ~321 KB.
  describe('miniaturas', () => {
    const FOTO = (n: number) =>
      `https://res.cloudinary.com/dd0yz5yxb/image/upload/v178529076${n}/searchpet/pets/abc/foto${n}.webp`;

    function conFotos(n: number) {
      mockUseSharedPet.mockReturnValue({
        data: {
          pet: {
            id: 'pet-1',
            name: 'Firulais',
            type: 'perro',
            status: 'lost',
            photos: Array.from({ length: n }, (_, i) => ({ id: `f${i}`, url: FOTO(i) })),
          },
          owner: null,
        },
        isLoading: false,
      });
    }

    it('la foto principal pide 800x600, no la original', () => {
      conFotos(1);
      const { container } = render(<SharedPetPage />, { wrapper });

      const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') || '');
      // c_lfill y NO c_limit: el contenedor es object-cover, aca recortar es lo
      // correcto. Al reves que PetDetailPage, que es object-contain.
      expect(srcs.some((s) => s.includes('w_800,h_600,c_lfill,g_auto'))).toBe(true);
    });

    it('cada miniatura de la tira pide 240, no la original', () => {
      conFotos(3);
      const { container } = render(<SharedPetPage />, { wrapper });

      const tira = [...container.querySelectorAll('img')]
        .map((i) => i.getAttribute('src') || '')
        .filter((s) => s.includes('w_240,h_240,c_lfill'));

      // Las tres, no "alguna": un guard que pide que exista UNA se queda verde
      // con las otras dos crudas.
      expect(tira).toHaveLength(3);
    });

    it('ninguna foto de Cloudinary se sirve sin transformar', () => {
      conFotos(3);
      const { container } = render(<SharedPetPage />, { wrapper });

      const cloudinarias = [...container.querySelectorAll('img')]
        .map((i) => i.getAttribute('src') || '')
        .filter((s) => s.includes('res.cloudinary.com'));

      expect(cloudinarias.length).toBeGreaterThan(0);
      expect(cloudinarias.every((s) => s.includes('c_lfill'))).toBe(true);
    });
  });
});
