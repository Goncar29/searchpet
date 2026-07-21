import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'es', exists: () => false },
  }),
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
        new_users_by_month: [{ month: '2026-07', count: 30 }],
        reports_by_month: [{ month: '2026-07', count: 45 }],
        pets_by_type: [
          { type: 'perro', count: 10 },
          { type: 'gato', count: 4 },
        ],
        moderation: { pending: 3, resolved: 7, dismissed: 2 },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ImpactPage />);
    // Number is locale-formatted; assert the grouped digits appear. It shows in
    // both the on-page tile and the offscreen share card, so match one-or-more.
    expect(screen.getAllByText(/1[.,]247/).length).toBeGreaterThan(0);
    // New sections render their headings.
    expect(screen.getByText('impact:petsByType')).toBeInTheDocument();
    expect(screen.getByText('impact:moderation')).toBeInTheDocument();
  });

  it('renders an error state on failure', () => {
    useImpactStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('boom') });
    render(<ImpactPage />);
    expect(screen.getByText('impact:error')).toBeInTheDocument();
  });
});
