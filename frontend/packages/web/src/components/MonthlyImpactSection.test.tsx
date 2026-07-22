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
        reports: [{ id: 'r1', pet_name: 'Michi', status: 'sighting', created_at: '2026-07-03T00:00:00Z' }],
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
