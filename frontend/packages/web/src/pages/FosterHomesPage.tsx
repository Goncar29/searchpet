import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useFosterHomes } from '@shared/hooks';
import type { AnimalKind } from '@shared/types';
import { FosterHomeCard } from '../components/FosterHomeCard';

const ANIMAL_TYPES: AnimalKind[] = ['dog', 'cat', 'other'];

export function FosterHomesPage() {
  const { t } = useTranslation(['fosterHomes', 'common']);

  // ── Draft filters (lo que el usuario está escribiendo — todavía no aplicado) ──
  const [draftCity, setDraftCity] = useState('');
  const [draftAnimal, setDraftAnimal] = useState<AnimalKind | ''>('');

  // ── Applied filters (lo que se manda a la API — solo cambia al aplicar) ──
  const [appliedCity, setAppliedCity] = useState('');
  const [appliedAnimal, setAppliedAnimal] = useState<AnimalKind | ''>('');

  const { data: fosterHomes, isLoading, isError } = useFosterHomes(
    appliedCity || undefined,
    appliedAnimal || undefined,
  );

  const hasActiveFilters = !!appliedCity || !!appliedAnimal;

  const applyFilters = () => {
    setAppliedCity(draftCity.trim());
    setAppliedAnimal(draftAnimal);
  };

  const clearFilters = () => {
    setDraftCity('');
    setDraftAnimal('');
    setAppliedCity('');
    setAppliedAnimal('');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">{t('fosterHomes:directory.title')}</h1>
        <Link
          to="/fosterhomes/register"
          className="inline-flex items-center justify-center px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors"
        >
          {t('fosterHomes:directory.registerCta')}
        </Link>
      </div>

      {/* Filtros — draft/applied: no se dispara la API en cada keystroke */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-5 mb-8">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="fh-city" className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('fosterHomes:directory.filterCity')}
            </label>
            <input
              id="fh-city"
              type="text"
              value={draftCity}
              onChange={(e) => setDraftCity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary min-w-[180px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="fh-animal" className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('fosterHomes:directory.filterAnimal')}
            </label>
            <select
              id="fh-animal"
              value={draftAnimal}
              onChange={(e) => setDraftAnimal(e.target.value as AnimalKind | '')}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">{t('fosterHomes:directory.animalAll')}</option>
              {ANIMAL_TYPES.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`fosterHomes:animalType.${kind}`)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={applyFilters}
            className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
          >
            {t('common:search')}
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors"
            >
              ✕ {t('fosterHomes:directory.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden animate-pulse"
            >
              <div className="h-48 bg-gray-200 dark:bg-gray-700" />
              <div className="p-4 space-y-2">
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="text-center py-12">
          <p className="text-red-500 dark:text-red-400">{t('common:error')}</p>
        </div>
      )}

      {!isLoading && !isError && fosterHomes && fosterHomes.length === 0 && (
        <div className="text-center py-12">
          <p className="text-5xl mb-4">🏠</p>
          <p className="text-gray-400 dark:text-gray-500">{t('fosterHomes:directory.empty')}</p>
        </div>
      )}

      {!isLoading && !isError && fosterHomes && fosterHomes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {fosterHomes.map((fh) => (
            <FosterHomeCard key={fh.id} fosterHome={fh} />
          ))}
        </div>
      )}
    </div>
  );
}
