import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'es' } }),
}));

const useImpactStats = vi.fn();
vi.mock('@shared/hooks', () => ({ useImpactStats: () => useImpactStats() }));

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
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ImpactPage />);
    // Number is locale-formatted; assert the grouped digits appear.
    expect(screen.getByText(/1[.,]247/)).toBeInTheDocument();
  });

  it('renders an error state on failure', () => {
    useImpactStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('boom') });
    render(<ImpactPage />);
    expect(screen.getByText('impact:error')).toBeInTheDocument();
  });
});
