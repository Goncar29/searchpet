import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'es', exists: () => false },
  }),
}));

const useImpactStats = vi.fn();
const useMonthlyImpact = vi.fn((_month: string) => ({ data: undefined, isLoading: false, isError: false, error: null }));
vi.mock('@shared/hooks', () => ({
  useImpactStats: () => useImpactStats(),
  useMonthlyImpact: (m: string) => useMonthlyImpact(m),
}));

import { ImpactPage } from './ImpactPage';

describe('ImpactPage', () => {
  it('renders the reunions total when data is loaded', () => {
    useImpactStats.mockReturnValue({
      data: {
        totals: {
          pets_reunited: 1247,
          searches_started: 3891,
          total_users: 5402,
          total_pets: 6130,
          active_searches: 214,
          reunion_rate: 0.32,
        },
        reunions_by_month: [{ month: '2026-07', count: 12 }],
        new_users_by_month: [{ month: '2026-07', count: 30 }],
        reports_by_month: [{ month: '2026-07', count: 45 }],
        pets_by_type: [
          { type: 'perro', count: 10 },
          { type: 'gato', count: 4 },
        ],
        moderation: {
          abuse_pending: 3,
          abuse_resolved: 7,
          abuse_dismissed: 2,
          foster_homes_pending: 1,
          shelters_pending: 4,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <ImpactPage />
      </MemoryRouter>,
    );
    // Number is locale-formatted; assert the grouped digits appear. It shows in
    // both the on-page tile and the offscreen share card, so match one-or-more.
    expect(screen.getAllByText(/1[.,]247/).length).toBeGreaterThan(0);
    // New sections render their headings.
    expect(screen.getByText('impact:petsByType')).toBeInTheDocument();
    expect(screen.getByText('impact:moderation')).toBeInTheDocument();
  });

  /**
   * El payload REAL que servía producción el 2026-09-16, con `total_pets: 0`.
   *
   * `pets_by_type` llegaba `null` —un slice nil de Go se serializa así— y la
   * pantalla entera caía al ErrorBoundary en `Math.max(1, ...pets_by_type.map())`.
   * O sea: el panel de impacto sólo funcionaba mientras hubiera datos, que es
   * justo al revés de lo que uno esperaría de un panel de métricas.
   *
   * El backend quedó arreglado (manda `[]`), pero esto se testea igual: el
   * frontend no controla qué versión del backend le contesta, y la línea que
   * rompió compilaba perfecto.
   *
   * SE AFIRMA QUE LA PÁGINA SE DIBUJA, no el estado vacío: el cartel "—" ya se
   * mostraba antes del bug con una lista `[]`, así que afirmarlo a él pasaría
   * con el defecto puesto. Lo que distingue las dos versiones es que exista DOM.
   */
  it('con pets_by_type en null la pagina se dibuja igual', () => {
    useImpactStats.mockReturnValue({
      data: {
        totals: {
          pets_reunited: 0,
          searches_started: 0,
          total_users: 5,
          total_pets: 0,
          active_searches: 0,
          reunion_rate: 0,
        },
        reunions_by_month: [{ month: '2026-09', count: 0 }],
        new_users_by_month: [{ month: '2026-09', count: 0 }],
        reports_by_month: [{ month: '2026-09', count: 0 }],
        pets_by_type: null,
        moderation: {
          abuse_pending: 0,
          abuse_resolved: 0,
          abuse_dismissed: 0,
          foster_homes_pending: 0,
          shelters_pending: 0,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <ImpactPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('impact:petsByType')).toBeInTheDocument();
    expect(screen.getByText('impact:moderation')).toBeInTheDocument();
  });

  it('renders an error state on failure', () => {
    useImpactStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('boom') });
    render(
      <MemoryRouter>
        <ImpactPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('impact:error')).toBeInTheDocument();
  });
});
