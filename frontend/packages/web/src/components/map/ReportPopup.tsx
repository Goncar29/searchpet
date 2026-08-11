import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { statusBadgeBg } from '../../utils/statusBadge';
import { formatTimeAgo } from '@shared/utils/mapFormat';
import type { Report } from '@shared/types';

// Movido tal cual desde MapPage: mismas clases, mismas claves, mismo markup.
// Los tres helpers vinieron con él porque no tenían otro consumidor.
export function ReportPopup({ report }: { report: Report }) {
  const { t, i18n } = useTranslation(['map', 'pets', 'reports']);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return t('pets:status.lost');
      case 'found': return t('pets:status.found');
      case 'sighting': return t('pets:card.sighting');
      default: return status;
    }
  };

  const primaryPhotoUrl = (p?: Report['pet']) =>
    p?.photos?.find((ph) => ph.is_primary)?.url ?? p?.photos?.[0]?.url ?? '';

  const petSubtitle = (p?: Report['pet']) =>
    p ? [t(`pets:types.${p.type}`), p.breed, p.color].filter(Boolean).join(' · ') : '';

  const photo = primaryPhotoUrl(report.pet);
  const subtitle = petSubtitle(report.pet);
  const timeAgo = formatTimeAgo(report.occurred_at ?? report.created_at, new Date(), i18n.language);

  return (
    <div className="w-52">
      {photo && (
        <img
          src={photo}
          alt={report.pet?.name || t('map:pet')}
          className="w-full h-28 object-cover rounded-md mb-2"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-base leading-tight">{report.pet?.name || t('map:pet')}</h3>
        <span className={`shrink-0 inline-block text-[10px] font-bold text-white px-2 py-0.5 rounded ${statusBadgeBg(report.status)}`}>
          {getStatusLabel(report.status)}
        </span>
      </div>
      {subtitle && (
        <p className="text-xs text-gray-500 mt-1 capitalize">{subtitle}</p>
      )}
      {timeAgo && (
        <p className="text-xs text-gray-400 mt-1">🕑 {timeAgo}</p>
      )}
      {report.location_description && (
        <p className="text-sm text-gray-600 mt-2">{report.location_description}</p>
      )}
      <Link
        to={`/pets/${report.pet?.id || report.pet_id}`}
        className="inline-block mt-2 text-sm text-primary font-semibold hover:underline"
      >
        {t('map:viewDetails')} →
      </Link>
    </div>
  );
}
