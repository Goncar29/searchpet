import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));

const useMonthlyImpact = vi.fn();
vi.mock('@shared/hooks', () => ({ useMonthlyImpact: (m: string) => useMonthlyImpact(m) }));
vi.mock('@shared/utils/apiErrors', () => ({ getErrorMessage: () => 'err' }));

import { MonthlyImpactSection } from './MonthlyImpactSection';

const nf = new Intl.NumberFormat('es');

describe('MonthlyImpactSection', () => {
  it('renders month tiles and record tables', () => {
    useMonthlyImpact.mockReturnValue({
      data: {
        month: '2026-07',
        totals: { reunions: 5, new_users: 2, reports: 8 },
        reunited_pets: [{ id: 'p1', name: 'Firulais', type: 'perro', reunited_at: '2026-07-10T00:00:00Z' }],
        reports: [{ id: 'r1', pet_id: 'p9', pet_name: 'Michi', status: 'sighting', created_at: '2026-07-03T00:00:00Z' }],
        truncated: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <MonthlyImpactSection months={['2026-06', '2026-07']} nf={nf} lang="es" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Firulais')).toBeInTheDocument();
    expect(screen.getByText('Michi')).toBeInTheDocument();
    expect(screen.getByText('Firulais').closest('a')).toHaveAttribute('href', '/pets/p1');
  });

  // El fixture usa `pet_id: 'p9'` DISTINTO de `id: 'r1'` a propósito: con los
  // dos iguales, un link armado con el campo equivocado daría exactamente el
  // mismo href y el test pasaría sobre el bug.
  //
  // Y va al ancla, no sólo a la mascota: sin `#reporte-<id>` el link te deja
  // arriba de la ficha y hay que buscar el reporte a ojo — que es la mitad del
  // pedido, no todo.
  it('cada reporte enlaza a SU mascota, con ancla al reporte', () => {
    useMonthlyImpact.mockReturnValue({
      data: {
        month: '2026-07',
        totals: { reunions: 0, new_users: 0, reports: 2 },
        reunited_pets: [],
        reports: [
          { id: 'r1', pet_id: 'p9', pet_name: 'Michi', status: 'sighting', created_at: '2026-07-03T00:00:00Z' },
          { id: 'r2', pet_id: 'p9', pet_name: 'Michi', status: 'lost', created_at: '2026-07-04T00:00:00Z' },
        ],
        truncated: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <MonthlyImpactSection months={['2026-07']} nf={nf} lang="es" />
      </MemoryRouter>,
    );

    // Dos reportes de la MISMA mascota: mismo destino, anclas distintas. Si el
    // ancla se armara con el pet en vez del reporte, los dos href serían
    // idénticos y no habría forma de distinguir a qué fila lleva cada uno.
    const hrefs = screen.getAllByText('Michi').map((el) => el.closest('a')?.getAttribute('href'));
    expect(hrefs).toEqual(['/pets/p9#reporte-r1', '/pets/p9#reporte-r2']);
  });

  it('renders an empty state when a month has no records', () => {
    useMonthlyImpact.mockReturnValue({
      data: {
        month: '2020-01',
        totals: { reunions: 0, new_users: 0, reports: 0 },
        reunited_pets: [],
        reports: [],
        truncated: false,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <MonthlyImpactSection months={['2020-01']} nf={nf} lang="es" />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('impact:monthEmpty').length).toBe(2);
  });
});
