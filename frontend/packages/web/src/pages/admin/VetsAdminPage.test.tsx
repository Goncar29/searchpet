import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import { VetsAdminPage } from './VetsAdminPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/api/client', () => ({
  apiClient: { importVets: vi.fn() },
}));

const mockedApi = vi.mocked(apiClient);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VetsAdminPage />
    </QueryClientProvider>,
  );
}

describe('VetsAdminPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the run counters after a successful import', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 183, upserted: 183, skipped_no_coords: 0, upsert_failed: 0, swept: 1,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() => expect(screen.getAllByText('183').length).toBeGreaterThan(0));
    expect(screen.getByText('vets.swept')).toBeInTheDocument();
  });

  // A blocked sweep reports swept: 0, exactly like a clean run with nothing stale.
  // If the page renders only the number, the operator cannot tell "nothing to do"
  // from "we refused to delete" — which is the whole reason the reason exists.
  it('explains a blocked sweep instead of showing a bare zero', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 2, upserted: 2, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, sweep_skipped: 'below_threshold',
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_below_threshold')).toBeInTheDocument(),
    );
  });

  it('disables the button while the import is in flight', async () => {
    let resolve!: (v: unknown) => void;
    mockedApi.importVets.mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    resolve({ scanned: 1, upserted: 1, skipped_no_coords: 0, upsert_failed: 0, swept: 0 });
  });
});
