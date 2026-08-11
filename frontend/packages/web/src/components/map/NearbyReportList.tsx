import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatTimeAgo } from '@shared/utils/mapFormat';
import { statusBadgeBg } from '../../utils/statusBadge';
import type { Report } from '@shared/types';

interface Props {
  reports: Report[] | undefined;
  isLoading: boolean;
}

/**
 * "Reportes en esta zona" — la lista del panel, alimentada por la MISMA
 * respuesta que dibuja los marcadores. No hace su propio fetch a propósito: dos
 * fuentes para la misma pregunta terminan mostrando cosas distintas.
 */
export function NearbyReportList({ reports, isLoading }: Props) {
  const { t, i18n } = useTranslation(['map', 'pets']);

  const etiquetaEstado = (status: string) => {
    switch (status) {
      case 'lost': return t('pets:card.lost');
      case 'found': return t('pets:card.found');
      case 'sighting': return t('pets:card.sighting');
      default: return t(`pets:status.${status}`);
    }
  };

  const fotoPrincipal = (p?: Report['pet']) =>
    p?.photos?.find((ph) => ph.is_primary)?.url ?? p?.photos?.[0]?.url ?? '';

  return (
    <div className="p-4">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
        {t('map:resultsInArea')}
      </h3>

      {/* Cargando y vacío son estados DISTINTOS. Decir "no hay resultados"
          mientras el request está en vuelo le afirma al usuario que su filtro
          no encontró nada cuando todavía no fue contestado. */}
      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('map:loadingResults')}</p>
      ) : !reports || reports.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('map:noResults')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => {
            const foto = fotoPrincipal(report.pet);
            const cuando = formatTimeAgo(
              report.occurred_at ?? report.created_at,
              new Date(),
              i18n.language,
            );
            return (
              <li key={report.id}>
                <Link
                  // El backend puede no preloadear la mascota; sin el fallback
                  // al pet_id el link quedaría en /pets/undefined.
                  to={`/pets/${report.pet?.id ?? report.pet_id}`}
                  className="flex gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {foto ? (
                    <img
                      src={foto}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                        {report.pet?.name || t('map:pet')}
                      </span>
                      <span className={`shrink-0 text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${statusBadgeBg(report.status)}`}>
                        {etiquetaEstado(report.status)}
                      </span>
                    </div>
                    {cuando && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{cuando}</p>
                    )}
                    {report.location_description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {report.location_description}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
