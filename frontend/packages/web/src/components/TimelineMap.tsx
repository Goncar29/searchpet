import { useState, Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import type { Report } from '@shared/types';

interface TimelineMapProps {
  reports: Report[];
}

interface ValidReport {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  label: string | undefined;
  date: string;
}

const LazyMapInner = lazy(() => import('./TimelineMapInner'));

export function TimelineMap({ reports }: TimelineMapProps) {
  const { t } = useTranslation();
  const [showMap, setShowMap] = useState(false);

  const validReports: ValidReport[] = reports
    .filter((r) => r.latitude && r.longitude)
    .map((r) => ({
      id: r.id,
      latitude: r.latitude,
      longitude: r.longitude,
      status: r.status,
      label: r.location_description,
      date: r.occurred_at ?? r.created_at,
    }));

  if (validReports.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setShowMap((v) => !v)}
        className="text-sm font-semibold text-primary hover:text-primary-dark transition-colors"
      >
        {showMap ? t('pets:map.hide') : t('pets:map.show')}
      </button>

      {showMap && (
        <div className="mt-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          <Suspense
            fallback={
              <div className="h-64 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
                <span className="text-sm text-gray-500 dark:text-gray-400">{t('pets:map.loading')}</span>
              </div>
            }
          >
            <LazyMapInner reports={validReports} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
