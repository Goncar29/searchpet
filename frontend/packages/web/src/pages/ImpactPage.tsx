import { useTranslation } from 'react-i18next';
import { useImpactStats } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ImpactLineChart } from '../components/ImpactLineChart';

function StatTile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-700">
      <div className="text-3xl font-extrabold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

export function ImpactPage() {
  const { t, i18n } = useTranslation('impact');
  const { data, isLoading, isError, error } = useImpactStats();

  // useGrouping: true — the bare "es" locale's default ("auto") grouping
  // strategy requires 5+ digits before it groups 4-digit numbers (a real
  // CLDR/ICU quirk: 1247 renders as "1247", not "1.247"). Forcing grouping on
  // keeps thousands separators consistent across en/es/pt for these tiles.
  // (`true` is equivalent to the string literal "always" per the Intl spec;
  // this project's TS lib target only types the boolean form.)
  const nf = new Intl.NumberFormat(i18n.language, { useGrouping: true });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-gray-500">
        {t('impact:loading')}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-red-600">
        <p>{t('impact:error')}</p>
        {isError ? <p className="mt-2 text-sm text-gray-400">{getErrorMessage(error, t)}</p> : null}
      </div>
    );
  }

  const { totals, reunions_by_month } = data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-extrabold">{t('impact:title')} 🐾</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('impact:subtitle')}</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={nf.format(totals.pets_reunited)} label={t('impact:reunited')} accent="#22c55e" />
        <StatTile value={nf.format(totals.searches_started)} label={t('impact:searches')} accent="#3b82f6" />
        <StatTile value={nf.format(totals.total_users)} label={t('impact:community')} />
        <StatTile value={nf.format(totals.total_pets)} label={t('impact:registered')} />
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <div className="mb-3 text-sm font-bold">{t('impact:reunionsByMonth')}</div>
        <ImpactLineChart data={reunions_by_month} label={t('impact:reunionsByMonth')} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile value={nf.format(totals.active_searches)} label={t('impact:activeSearches')} accent="#3b82f6" />
        <StatTile
          value={`${Math.round(totals.reunion_rate * 100)}%`}
          label={t('impact:reunionRate')}
          accent="#22c55e"
        />
      </div>
    </div>
  );
}
