import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient, ApiError } from '@shared/api/client';
import type { VetImportResult } from '@shared/types';
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
      would_retire: 1, active_before: 183,
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
      swept: 0, would_retire: 181, sweep_skipped: 'below_threshold', active_before: 183,
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
    // Every number differs on purpose. The page has to pin would_retire — what the
    // guard bounds — and pinning any of the others would approve one quantity
    // while unlocking a check on another, which is the defect this closes.
    mockedApi.importVets.mockResolvedValue({
      scanned: 140, upserted: 138, skipped_no_coords: 2, upsert_failed: 0,
      swept: 0, would_retire: 45, sweep_skipped: 'below_threshold', active_before: 183,
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
    // 45 — would_retire — and none of the other three numbers on screen. It is a
    // ceiling: "at most 45 may go away".
    await userEvent.click(force);
    await waitFor(() =>
      expect(mockedApi.importVets).toHaveBeenLastCalledWith({ maxRetired: 45 }),
    );
  });

  // Defensive, not expected. Now that the bound is measured on would_retire, a
  // block implies would_retire > 0 and this state should be unreachable — but the
  // implication rests on stale rows always being a subset of active ones, an
  // invariant held across two separate repository queries. The server refuses a
  // ceiling of zero, so without this branch the operator would get a button that
  // confirms a destructive action, runs a full import, and changes nothing.
  it('does not offer an override that the server is guaranteed to refuse', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 0, upserted: 0, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, would_retire: 0, sweep_skipped: 'below_threshold', active_before: 183,
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

  // Web and backend deploy independently from the same push — Vercel lands a
  // couple of minutes before Render — so for that window this page talks to a
  // backend that has never heard of would_retire. Declaring the field required
  // does not make it arrive: it just moves the surprise to runtime, where
  // `undefined > 0` quietly hides the override and the counter renders blank.
  it('survives a backend that does not send would_retire yet', async () => {
    const sinCampo = {
      scanned: 150, upserted: 150, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, sweep_skipped: 'below_threshold', active_before: 183,
    } as VetImportResult;
    mockedApi.importVets.mockResolvedValue(sinCampo);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_below_threshold')).toBeInTheDocument(),
    );
    // No override: there is no number to pin a ceiling to, and inventing one is
    // how a run gets approved for a quantity nobody read.
    expect(screen.queryByRole('button', { name: 'vets.forceRun' })).not.toBeInTheDocument();
    // And no counter claiming zero rows would go, which would be a different lie
    // from "we do not know".
    expect(screen.queryByText('vets.wouldRetire')).not.toBeInTheDocument();
  });

  // A dropped override renders the same block as a run nobody forced, so without
  // this the operator reads "the button did nothing" and presses it again — and
  // the second press is pinned to the run that just came back short.
  it('says so when the override was asked for and refused', async () => {
    mockedApi.importVets.mockResolvedValue({
      scanned: 12, upserted: 12, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, would_retire: 171, sweep_skipped: 'below_threshold', active_before: 183,
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
      swept: 0, would_retire: 163, sweep_skipped: 'mapping_failures', active_before: 183,
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
      swept: 0, would_retire: 1, sweep_skipped: 'upsert_failures', active_before: 100,
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
      swept: 0, would_retire: 1, sweep_skipped: 'some_future_guard', active_before: 3,
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
