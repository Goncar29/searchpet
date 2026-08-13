import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
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

      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={run.isPending}
        className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-60"
      >
        {run.isPending ? t('vets.running') : t('vets.run')}
      </button>

      {run.isError && <p className="text-sm text-red-600">{t('vets.error')}</p>}

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
          </div>

          {/* A blocked sweep also reports swept: 0. Without this block the operator
              would read a refusal to delete as "there was nothing to delete". */}
          {run.data.sweep_skipped && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 px-3 py-2">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {t('vets.sweepSkippedTitle')}
              </div>
              <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                {t(`vets.sweepSkipped_${run.data.sweep_skipped}`)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
