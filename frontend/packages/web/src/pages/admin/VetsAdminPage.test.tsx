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
    translations['vets.sweepSkipped_upsert_failures'] = 'vets.sweepSkipped_upsert_failures';
    translations['vets.sweepSkipped_mapping_failures'] = 'vets.sweepSkipped_mapping_failures';
    translations['vets.sweepSkipped_unknown'] = 'vets.sweepSkipped_unknown';
    translations['vets.forceUnavailableEmptyRun'] = 'vets.forceUnavailableEmptyRun';
    translations['vets.sweepForceIgnoredNotice'] = 'vets.sweepForceIgnoredNotice';
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

  // The threshold guard cannot untrip itself, so without this button the only
  // exit is an UPDATE against production.
  it('offers the override after the threshold blocked the sweep, and forces on click', async () => {
    // scanned and upserted deliberately differ — two stray ways with no center.
    // With both at 140 this test could not tell which number the page pins, and
    // pinning the wrong one is the whole defect: the override would approve a
    // quantity the server measures nothing against.
    mockedApi.importVets.mockResolvedValue({
      scanned: 140, upserted: 138, skipped_no_coords: 2, upsert_failed: 0,
      swept: 0, sweep_skipped: 'below_threshold', active_before: 183,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));
    const force = await screen.findByRole('button', { name: 'vets.forceRun' });

    // The ordinary run must not force anything on its way here.
    expect(mockedApi.importVets).toHaveBeenLastCalledWith(undefined);

    // The override travels with the number the operator just read. Forcing fires a
    // NEW import, so a bare flag would approve whatever that run brings back —
    // including the truncated response the threshold guard exists to catch. The
    // server refuses to apply the override unless the new run reaches this number.
    //
    // 138 and not 140: the pin has to be what the threshold measures, which is what
    // SURVIVED, not what OpenStreetMap listed. Pinning scanned would approve one
    // quantity while unlocking a check on another.
    await userEvent.click(force);
    await waitFor(() =>
      expect(mockedApi.importVets).toHaveBeenLastCalledWith({ expectedUpserted: 138 }),
    );
  });

  // The server refuses an override pinned to zero, and it is right to: "keep at
  // least 0 rows" approves any response at all, including the empty one that
  // caused the block. Offering a button that CANNOT work is the dead end this
  // whole PR is about — the operator confirms a destructive action, a full import
  // runs, and the screen comes back identical with no error and no explanation.
  it('does not offer an override that the server is guaranteed to refuse', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 0, upserted: 0, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, sweep_skipped: 'below_threshold', active_before: 183,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_below_threshold')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'vets.forceRun' })).not.toBeInTheDocument();
    // And it has to say why, or the missing button is its own small mystery.
    expect(screen.getByText('vets.forceUnavailableEmptyRun')).toBeInTheDocument();
  });

  // A dropped override renders the same block as a run nobody forced, so without
  // this the operator reads "the button did nothing" and presses it again — and
  // the second press is pinned to the run that just came back short.
  it('says so when the override was asked for and refused', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 12, upserted: 12, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, sweep_skipped: 'below_threshold', active_before: 183,
      sweep_force_ignored: true,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepForceIgnoredNotice')).toBeInTheDocument(),
    );
  });

  // Same reasoning as upsert_failures, one layer earlier: OSM listed enough and
  // our own mapping dropped them. From this screen that is indistinguishable from
  // a real shrinkage, and the number repeats across runs precisely because the
  // fault is ours — which is what the confirmation teaches them to trust.
  it('does not offer the override when the block came from our own mapping', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 183, upserted: 20, skipped_no_coords: 163, upsert_failed: 0,
      swept: 0, sweep_skipped: 'mapping_failures', active_before: 183,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_mapping_failures')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'vets.forceRun' })).not.toBeInTheDocument();
  });

  // The other guard fires when OUR writes failed, which the operator cannot see
  // from this screen. Offering the override there would hand them a button that
  // retires clinics that are alive in OSM.
  it('does not offer the override when the block came from failed writes', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 100, upserted: 99, skipped_no_coords: 0, upsert_failed: 1,
      swept: 0, sweep_skipped: 'upsert_failures', active_before: 100,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_upsert_failures')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'vets.forceRun' })).not.toBeInTheDocument();
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
