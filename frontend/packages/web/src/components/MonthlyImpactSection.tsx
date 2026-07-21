import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMonthlyImpact } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';

function Tile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-700">
      <div className="text-2xl font-extrabold text-gray-900 dark:text-gray-50" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

export function MonthlyImpactSection({
  months,
  nf,
  lang,
}: {
  months: string[];
  nf: Intl.NumberFormat;
  lang: string;
}) {
  const { t } = useTranslation('impact');
  const [month, setMonth] = useState(months.length ? months[months.length - 1] : '');
  const { data, isLoading, isError, error } = useMonthlyImpact(month);

  const fmtMonthLong = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  };
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' });

  return (
    <section className="mt-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">{t('impact:monthlyTitle')}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('impact:monthlySubtitle')}</p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          aria-label={t('impact:monthlyTitle')}
        >
          {[...months].reverse().map((m) => (
            <option key={m} value={m}>
              {fmtMonthLong(m)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-gray-500">{t('impact:loading')}</p>}
      {isError && <p className="py-8 text-center text-sm text-red-600">{getErrorMessage(error, t)}</p>}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Tile value={nf.format(data.totals.reunions)} label={t('impact:monthReunions')} accent="#22c55e" />
            <Tile value={nf.format(data.totals.new_users)} label={t('impact:monthNewUsers')} accent="#8b5cf6" />
            <Tile value={nf.format(data.totals.reports)} label={t('impact:monthReports')} accent="#f59e0b" />
          </div>

          {data.truncated && (
            <p className="mb-2 text-xs text-gray-400">{t('impact:monthTruncated', { cap: 50 })}</p>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Reunited pets */}
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <div className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t('impact:reunitedPetsTitle')}</div>
              {data.reunited_pets.length === 0 ? (
                <p className="text-sm text-gray-400">{t('impact:monthEmpty')}</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="pb-2 font-medium">{t('impact:colName')}</th>
                      <th className="pb-2 font-medium">{t('impact:colType')}</th>
                      <th className="pb-2 text-right font-medium">{t('impact:colDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reunited_pets.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2">
                          <Link to={`/pets/${p.id}`} className="font-medium text-primary hover:underline">
                            {p.name}
                          </Link>
                        </td>
                        <td className="py-2 text-gray-500 dark:text-gray-400">{p.type}</td>
                        <td className="py-2 text-right text-gray-500 dark:text-gray-400">{fmtDate(p.reunited_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Reports */}
            <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
              <div className="mb-3 text-sm font-bold text-gray-900 dark:text-gray-100">{t('impact:reportsTitle')}</div>
              {data.reports.length === 0 ? (
                <p className="text-sm text-gray-400">{t('impact:monthEmpty')}</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="pb-2 font-medium">{t('impact:colPet')}</th>
                      <th className="pb-2 font-medium">{t('impact:colStatus')}</th>
                      <th className="pb-2 text-right font-medium">{t('impact:colDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2 text-gray-700 dark:text-gray-300">{r.pet_name}</td>
                        <td className="py-2 text-gray-500 dark:text-gray-400">{r.status}</td>
                        <td className="py-2 text-right text-gray-500 dark:text-gray-400">{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
