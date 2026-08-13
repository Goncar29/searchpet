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
  const run = useMutation<VetImportResult>({ mutationFn: () => apiClient.importVets() });

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
          if (window.confirm(t('vets.confirmRun'))) run.mutate();
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
                  upserted: run.data.upserted,
                  activeBefore: run.data.active_before,
                  defaultValue: t('vets.sweepSkipped_unknown', {
                    reason: run.data.sweep_skipped,
                  }),
                })}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
