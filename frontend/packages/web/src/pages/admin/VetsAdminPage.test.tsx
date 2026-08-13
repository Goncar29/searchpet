import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient, ApiError } from '@shared/api/client';
import { VetsAdminPage } from './VetsAdminPage';

// i18next returns the key unchanged when a translation is missing, and BOTH
// fallbacks under test key off exactly that: getErrorMessage's, and the sweep
// reason's defaultValue. An identity `t` would report every key as missing, so
// the dictionary below is what lets a test tell a resolved key from a fallback.
const { translations } = vi.hoisted(() => ({
  translations: {} as Record<string, string>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      translations[key] ?? opts?.defaultValue ?? key,
    i18n: { language: 'es' },
  }),
}));

vi.mock('@shared/api/client', () => ({
  apiClient: { importVets: vi.fn() },
  // getErrorMessage runs `err instanceof ApiError` against this very module, so
  // the mock has to export a real class or that check throws.
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
    }
  },
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
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom's window.confirm returns undefined, which reads as "cancelled" and
    // would make every test below silently assert nothing.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    for (const key of Object.keys(translations)) delete translations[key];
    // Keys the locale files really define. Resolving them to themselves keeps the
    // assertions readable; anything absent behaves like a missing translation.
    translations['vets.sweepSkipped_below_threshold'] = 'vets.sweepSkipped_below_threshold';
    translations['vets.sweepSkipped_unknown'] = 'vets.sweepSkipped_unknown';
    // getErrorMessage falls back whenever t hands the key back, so these two have
    // to resolve to something that is not the key.
    translations['errors:vet_import_running'] = 'Ya hay una importación en curso';
    translations['errors:unknown_error'] = 'Ocurrió un error inesperado';
  });

  it('shows the run counters after a successful import', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 183, upserted: 183, skipped_no_coords: 0, upsert_failed: 0, swept: 1,
      active_before: 183,
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
      swept: 0, sweep_skipped: 'below_threshold', active_before: 183,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_below_threshold')).toBeInTheDocument(),
    );
    // The threshold guard cannot untrip itself, so the denominator it blocked
    // against is the operator's only handle on why. "2 upserted" says nothing
    // until you can see it was measured against 183.
    expect(screen.getByText('183')).toBeInTheDocument();
  });

  // The run retires rows and the panel has no un-retire, so a misclick has to be
  // recoverable before it happens, not after.
  it('does not run the import when the confirmation is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    expect(mockedApi.importVets).not.toHaveBeenCalled();
  });

  // A 409 means another run is in flight — nothing failed. Reporting it as a
  // failure tells the operator the opposite of what happened, and it throws away
  // the distinct code the endpoint goes out of its way to return.
  it('names the 409 instead of reporting a generic failure', async () => {
    mockedApi.importVets.mockRejectedValue(
      new ApiError('vet_import_running', 409, 'ya hay una importación en curso'),
    );
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('Ya hay una importación en curso')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Ocurrió un error inesperado')).not.toBeInTheDocument();
  });

  // The key is assembled from a server-side string, so a guard added later would
  // paint its own raw key on screen without a single error anywhere.
  it('falls back to a named reason when the guard is one it does not know', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 2, upserted: 2, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, sweep_skipped: 'some_future_guard', active_before: 3,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_unknown')).toBeInTheDocument(),
    );
    expect(screen.queryByText('vets.sweepSkipped_some_future_guard')).not.toBeInTheDocument();
  });

  it('disables the button while the import is in flight', async () => {
    let resolve!: (v: unknown) => void;
    mockedApi.importVets.mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    resolve({
      scanned: 1, upserted: 1, skipped_no_coords: 0, upsert_failed: 0, swept: 0,
      active_before: 1,
    });
  });
});
