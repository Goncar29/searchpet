import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { NearbyReportList } from './NearbyReportList';
import type { Report } from '@shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

const report = {
  id: 'r1',
  pet_id: 'p1',
  reporter_id: 'u1',
  status: 'lost',
  latitude: -34.9,
  longitude: -56.1,
  is_verified: false,
  created_at: new Date().toISOString(),
  pet: { id: 'p1', owner_id: 'u1', name: 'Firulais', type: 'perro', status: 'lost', photos: [], created_at: new Date().toISOString() },
} as unknown as Report;

const wrap = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('NearbyReportList', () => {
  it('lista los reportes con su nombre y link al detalle', () => {
    wrap(<NearbyReportList reports={[report]} isLoading={false} isError={false} />);
    expect(screen.getByText('Firulais')).toBeTruthy();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pets/p1');
  });

  it('el vacio se distingue de la carga', () => {
    const { rerender } = wrap(<NearbyReportList reports={[]} isLoading isError={false} />);
    // Decir "no hay resultados" mientras el request esta EN VUELO le afirma al
    // usuario que su filtro no encontro nada cuando todavia no fue contestado.
    expect(screen.queryByText('map:noResults')).toBeNull();
    expect(screen.getByText('map:loadingResults')).toBeTruthy();

    rerender(<MemoryRouter><NearbyReportList reports={[]} isLoading={false} isError={false} /></MemoryRouter>);
    expect(screen.getByText('map:noResults')).toBeTruthy();
  });

  it('un request FALLIDO no se lee como "no hay resultados"', () => {
    // Este es el caso que importa: React Query deja `data` en undefined y
    // `isLoading` en false cuando el request falla, asi que la rama del vacio
    // se lo comia. Concreto: con Desde 20/08 y Hasta 01/08 el handler contesta
    // 400 y al usuario se le afirmaba que su filtro no matcheo nada. Nunca se
    // pregunto.
    wrap(<NearbyReportList reports={undefined} isLoading={false} isError />);

    expect(screen.getByText('map:resultsError')).toBeTruthy();
    expect(screen.queryByText('map:noResults')).toBeNull();
  });

  it('cae al pet_id cuando el reporte no trae la mascota anidada', () => {
    const sinPet = { ...report, pet: undefined } as unknown as Report;
    wrap(<NearbyReportList reports={[sinPet]} isLoading={false} isError={false} />);
    // El backend puede no preloadear la mascota; sin este fallback el link
    // quedaria en /pets/undefined y la fila seria una trampa.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pets/p1');
  });
});
