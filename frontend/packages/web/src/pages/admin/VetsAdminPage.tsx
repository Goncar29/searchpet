import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { VetImportResult } from '@shared/types';

/** One labelled number from the run. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

export function VetsAdminPage() {
  const { t } = useTranslation('admin');
  // The variable is the override itself, not a flag: an override with no number
  // behind it is one the server refuses, so the two travel together or not at all.
  const run = useMutation<VetImportResult, Error, { maxRetired: number } | undefined>({
    mutationFn: (force) => apiClient.importVets(force),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('vets.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('vets.description')}</p>
      </div>

      {/* This run retires rows, and the panel has no un-retire. Every other
          destructive action here asks first (stories delete, abuse-report ban,
          shelter reject); firing straight off a misclick was this one's outlier. */}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('vets.confirmRun'))) run.mutate(undefined);
        }}
        disabled={run.isPending}
        className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-60"
      >
        {run.isPending ? t('vets.running') : t('vets.run')}
      </button>

      {/* The endpoint answers 409 vet_import_running and 502 vet_import_upstream_failed.
          A fixed string would report "the import failed" for a 409, which means the
          opposite of what happened: nothing broke, another run is in flight. */}
      {run.isError && (
        <p className="text-sm text-red-600">{getErrorMessage(run.error, t)}</p>
      )}

      {run.data && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('vets.resultTitle')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label={t('vets.scanned')} value={run.data.scanned} />
            <Stat label={t('vets.upserted')} value={run.data.upserted} />
            <Stat label={t('vets.swept')} value={run.data.swept} />
            {/* What the sweep wanted to take. On a blocked run this is the whole
                explanation and the number the override would approve, so it has
                to be on screen before the operator is asked to confirm it. */}
            <Stat label={t('vets.wouldRetire')} value={run.data.would_retire} />
            <Stat label={t('vets.skippedNoCoords')} value={run.data.skipped_no_coords} />
            <Stat label={t('vets.upsertFailed')} value={run.data.upsert_failed} />
            {/* The threshold guard's denominator. On a clean run it is context;
                on a blocked one it is the only number that explains the block. */}
            <Stat label={t('vets.activeBefore')} value={run.data.active_before} />
          </div>

          {/* A blocked sweep also reports swept: 0. Without this block the operator
              would read a refusal to delete as "there was nothing to delete". */}
          {run.data.sweep_skipped && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 px-3 py-2">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {t('vets.sweepSkippedTitle')}
              </div>
              {/* The key is built from a server-side value, so a guard added later
                  would render its raw key on screen with no error anywhere. The
                  fallback still names the reason, which is what an operator needs. */}
              <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                {t(`vets.sweepSkipped_${run.data.sweep_skipped}`, {
                  scanned: run.data.scanned,
                  upserted: run.data.upserted,
                  wouldRetire: run.data.would_retire,
                  activeBefore: run.data.active_before,
                  defaultValue: t('vets.sweepSkipped_unknown', {
                    reason: run.data.sweep_skipped,
                  }),
                })}
              </p>

              {/* A dropped override produces the same block as a run nobody
                  forced, so without this the operator reads "the button did
                  nothing" and presses it again — and the second press pins the
                  approval to the run that just came back short. */}
              {run.data.sweep_force_ignored && (
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200 mt-2">
                  {t('vets.sweepForceIgnoredNotice')}
                </p>
              )}

              {/* The way out of a guard that cannot untrip itself. Offered ONLY
                  for the threshold: the other guard fires when our own writes
                  failed, and an operator has no way to see that from here, so
                  it is not theirs to overrule.

                  Pressing this starts a NEW import — new Overpass fetch, new
                  upserts — so the numbers in the confirmation describe a run that
                  is already over. The override goes out pinned to the count the
                  operator just read, and the server drops it if the new run comes
                  back short. Otherwise a third response truncated to a handful of
                  elements would sweep with the guard written for it turned off.

                  The pinned number is `would_retire` — how many rows the sweep
                  wants to take — because that is what the guard bounds, and it is
                  a CEILING: "at most this many go away". A truncated response
                  leaves MORE rows stale, so it exceeds the ceiling on its own and
                  the guard stays on without anyone anticipating it. */}
              {run.data.sweep_skipped === 'below_threshold' &&
                (run.data.would_retire > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          t('vets.confirmForceRun', {
                            wouldRetire: run.data!.would_retire,
                            activeBefore: run.data!.active_before,
                          }),
                        )
                      ) {
                        run.mutate({ maxRetired: run.data!.would_retire });
                      }
                    }}
                    disabled={run.isPending}
                    className="mt-3 border border-amber-500 text-amber-900 dark:text-amber-200 text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-60"
                  >
                    {t('vets.forceRun')}
                  </button>
                ) : (
                  /* Defensive, not expected. The bound is `would_retire > 20% of
                     the table`, so a block implies would_retire > 0 — this branch
                     should be unreachable. It stays because that implication rests
                     on stale rows always being a subset of active ones, which is
                     an invariant held across two separate repository queries, and
                     the alternative to a message here is a button that silently
                     does nothing (the server refuses a ceiling of zero). */
                  <p className="text-sm text-amber-800 dark:text-amber-300 mt-3">
                    {t('vets.forceUnavailableEmptyRun')}
                  </p>
                ))}
            </div>
          )}

          {/* A forced run must not read afterwards like an ordinary one. */}
          {run.data.sweep_forced && (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {t('vets.sweepForcedNotice', { swept: run.data.swept })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
