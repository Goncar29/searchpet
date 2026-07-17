import { Link } from 'react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdoptions } from '@shared/hooks';
import { statusBadgeBg } from '../utils/statusBadge';
import type { Pet, PetType } from '@shared/types';

const PET_TYPES: { value: PetType; labelKey: string; icon: string }[] = [
  { value: 'perro', labelKey: 'pets:types.perro', icon: '🐕' },
  { value: 'gato', labelKey: 'pets:types.gato', icon: '🐱' },
  { value: 'pajaro', labelKey: 'pets:types.pajaro', icon: '🐦' },
  { value: 'otro', labelKey: 'pets:types.otro', icon: '🐾' },
];

export function AdoptPage() {
  const { t } = useTranslation(['adoption', 'common', 'pets']);

  // ── Draft filters (what the user is editing — not yet applied) ──
  const [cityDraft, setCityDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState<PetType | ''>('');

  // ── Applied filters (sent to the API — only updated on explicit Apply) ──
  const [applied, setApplied] = useState<{ city?: string; type?: PetType }>({});

  const applyFilters = () => {
    setApplied({
      city: cityDraft.trim() || undefined,
      type: typeDraft || undefined,
    });
  };

  const { data, isLoading } = useAdoptions({
    city: applied.city,
    type: applied.type,
  });

  const pets = data?.data ?? [];
  const count = data?.total ?? pets.length;

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* Header */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold mb-3">
            {t('adoption:section.title')}
          </h1>
          <p className="text-lg text-white/80 max-w-2xl mx-auto">
            {t('adoption:section.subtitle')}
          </p>
        </div>
      </section>

      {/* Filtros */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Ciudad */}
            <input
              type="text"
              placeholder={t('adoption:section.cityPlaceholder')}
              aria-label={t('adoption:section.cityFilter')}
              value={cityDraft}
              onChange={(e) => setCityDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
            />

            {/* Tipo */}
            <select
              value={typeDraft}
              onChange={(e) => setTypeDraft(e.target.value as PetType | '')}
              aria-label={t('adoption:section.typeFilter')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">{t('adoption:section.allTypes')}</option>
              {PET_TYPES.map((pt) => (
                <option key={pt.value} value={pt.value}>{pt.icon} {t(pt.labelKey)}</option>
              ))}
            </select>

            {/* Aplicar */}
            <button
              onClick={applyFilters}
              className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
            >
              {t('adoption:section.apply')}
            </button>
          </div>
        </div>
      </section>

      {/* Resultados */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('adoption:section.resultCount', { count })}
          </h2>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 animate-pulse"
              >
                <div className="h-48 bg-gray-100 dark:bg-gray-800"></div>
                <div className="p-4">
                  <div className="h-5 w-2/3 bg-gray-100 dark:bg-gray-800 rounded mb-3"></div>
                  <div className="h-4 w-1/2 bg-gray-100 dark:bg-gray-800 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : pets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pets.map((pet: Pet) => (
              <Link key={pet.id} to={`/pets/${pet.id}`} className="block group">
                <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow">
                  {/* Foto */}
                  <div className="h-48 bg-gray-100 dark:bg-gray-800 relative overflow-hidden">
                    {pet.photos?.[0]?.url ? (
                      <img
                        src={pet.photos[0].url}
                        alt={pet.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-5xl">🐾</div>
                    )}
                    <span className={`absolute top-3 left-3 text-xs font-bold text-white px-2 py-1 rounded-md ${statusBadgeBg(pet.status)}`}>
                      {t('pets:status.adoption').toUpperCase()}
                    </span>
                  </div>
                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-1">{pet.name}</h3>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {pet.type && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{t(`pets:types.${pet.type}`)}</span>}
                      {pet.breed && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.breed}</span>}
                      {pet.color && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{pet.color}</span>}
                      {pet.city && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">📍 {pet.city}</span>}
                    </div>
                    {/* Reserve the comment height (2 lines) and show a placeholder
                        when empty so every card stays the same height. */}
                    <p
                      className={`text-sm line-clamp-2 min-h-[2.5rem] ${
                        pet.description
                          ? 'text-gray-500 dark:text-gray-400'
                          : 'italic text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {pet.description || t('pets:card.noComment')}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-5xl mb-4">🐾</p>
            <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('adoption:section.empty')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
