import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Report } from '@shared/types';
import { statusBadgeBg } from '../utils/statusBadge';

interface PetCardWebProps {
  report: Report;
}

export function PetCardWeb({ report }: PetCardWebProps) {
  const { t, i18n } = useTranslation(['pets', 'common']);
  const pet = report.pet;
  const petId = pet?.id || report.pet_id;
  const primaryPhoto = pet?.photos?.find(p => p.is_primary) || pet?.photos?.[0];

  const getStatusConfig = (status: string) => {
    const bg = statusBadgeBg(status);
    switch (status) {
      case 'lost': return { label: t('pets:card.lost').toUpperCase(), bg };
      case 'found': return { label: t('pets:card.found').toUpperCase(), bg };
      case 'sighting': return { label: t('pets:card.sighting').toUpperCase(), bg };
      default: return { label: status.toUpperCase(), bg };
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 60) return t('common:timeAgo.minutesAgo', { count: mins });
    if (hours < 24) return t('common:timeAgo.hoursAgo', { count: hours });
    if (days < 7) return t('common:timeAgo.daysAgo', { count: days });
    return new Date(dateStr).toLocaleDateString(i18n.language);
  };

  const status = getStatusConfig(report.status);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Imagen + info — link al detalle */}
      <Link to={`/pets/${petId}`} className="group flex-1">
        {/* Imagen */}
        <div className="relative h-48 bg-gray-100 dark:bg-gray-800">
          {primaryPhoto ? (
            <img
              src={primaryPhoto.url}
              alt={pet?.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-5xl">🐾</span>
            </div>
          )}
          <span className={`absolute top-3 left-3 ${status.bg} text-white text-[10px] font-bold px-2 py-1 rounded tracking-wider`}>
            {status.label}
          </span>
        </div>

        {/* Info */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">
              {pet?.name || t('pets:card.noName')}
            </h3>
            <span className="text-xs text-gray-600 dark:text-gray-400 flex-shrink-0 ml-2">
              {getTimeAgo(report.created_at)}
            </span>
          </div>

          {/* Reserved min-heights keep every card the same height regardless of
              whether the pet has tags or the report has a description (#9). */}
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.75rem]">
            {pet?.type && (
              <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium px-2 py-0.5 rounded">{pet.type}</span>
            )}
            {pet?.breed && (
              <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium px-2 py-0.5 rounded">{pet.breed}</span>
            )}
            {pet?.color && (
              <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-medium px-2 py-0.5 rounded">{pet.color}</span>
            )}
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 truncate min-h-[1.25rem]">
            {report.location_description ? `📍 ${report.location_description}` : ' '}
          </p>
        </div>
      </Link>

      {/* Acción rápida — separada del link para evitar anidado */}
      <div className="px-4 pb-4">
        <Link
          to={`/reports/create?petId=${petId}&status=sighting`}
          className="block w-full text-center text-xs font-semibold text-primary border border-primary/40 hover:bg-primary/5 rounded-lg py-1.5 transition-colors"
        >
          {t('pets:card.reportSighting')}
        </Link>
      </div>
    </div>
  );
}
