import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { FosterHome } from '@shared/types';

interface FosterHomeCardProps {
  fosterHome: FosterHome;
}

export function FosterHomeCard({ fosterHome }: FosterHomeCardProps) {
  const { t } = useTranslation(['fosterHomes']);
  const photo = fosterHome.photos?.[0];

  return (
    <Link to={`/hogares/${fosterHome.id}`} className="block group">
      <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
        {/* Foto */}
        <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
          {photo ? (
            <img
              src={photo.url}
              alt={fosterHome.city}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl">🏠</div>
          )}
        </div>

        {/* Info */}
        <div className="p-4">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-1 break-words line-clamp-2">
            📍 {fosterHome.city}
          </h3>
          <div className="flex flex-wrap gap-1 mb-2">
            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">
              {t(`fosterHomes:housingType.${fosterHome.housing_type}`)}
            </span>
            {fosterHome.animal_types.map((kind) => (
              <span
                key={kind}
                className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full"
              >
                {t(`fosterHomes:animalType.${kind}`)}
              </span>
            ))}
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
              {t('fosterHomes:directory.capacity')}: {fosterHome.capacity}
            </span>
          </div>
          {/* Always reserve the description height (2 lines) so every card
              in the grid stays the same height, mirroring the feed fix (#19). */}
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[2.5rem] break-words">
            {fosterHome.description}
          </p>
        </div>
      </div>
    </Link>
  );
}
