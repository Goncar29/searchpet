import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useStats, useShelters, useMyShelter } from '@shared/hooks';
import type { Shelter } from '@shared/types';

export function SheltersPage() {
  const { t } = useTranslation(['shelters', 'common']);
  const { data: stats } = useStats();
  const { data: shelters, isLoading, isError } = useShelters();
  // Owner-aware CTA: has a shelter → manage it; otherwise → register.
  // A 404/401 (no shelter or logged out) leaves myShelter undefined.
  const { data: myShelter } = useMyShelter();
  const [detail, setDetail] = useState<Shelter | null>(null);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">{t('shelters:title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
          {t('shelters:description')}
        </p>
      </div>

      {/* Impacto */}
      <div className="bg-gradient-to-r from-primary to-primary-dark rounded-2xl p-8 text-white mb-10">
        <h2 className="text-xl font-bold mb-4 text-center">{t('shelters:impact')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.pets_reunited || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactFound')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_users || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactUsers')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.searches_started || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactReports')}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{stats?.total_pets || 0}</p>
            <p className="text-sm text-white/70">{t('shelters:impactPets')}</p>
          </div>
        </div>
      </div>

      {/* Lista de refugios */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 animate-pulse"
            >
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/3 mb-4" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full mb-2" />
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-5/6" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="text-center py-12">
          <p className="text-red-500 dark:text-red-400">{t('common:error')}</p>
        </div>
      )}

      {!isLoading && !isError && shelters && shelters.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 dark:text-gray-500">{t('shelters:empty')}</p>
        </div>
      )}

      {!isLoading && !isError && shelters && shelters.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {shelters.map((shelter) => (
            <div
              key={shelter.id}
              className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md transition-shadow"
            >
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">{shelter.name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">📍 {shelter.city}</p>
              {shelter.description && (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-3">
                    {shelter.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDetail(shelter)}
                    className="self-start text-sm font-semibold text-primary hover:underline mb-4"
                  >
                    {t('shelters:seeMore')}
                  </button>
                </>
              )}

              <div className="mt-auto pt-4">
                {shelter.phone && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    📱 <a href={`tel:${shelter.phone}`} className="text-primary hover:underline">{shelter.phone}</a>
                  </p>
                )}

                <div className="flex gap-2">
                  {shelter.website_url && (
                    <a
                      href={shelter.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center text-sm font-semibold text-primary border border-primary py-2 rounded-lg hover:bg-primary/5 transition-colors"
                    >
                      {t('shelters:visitWeb')}
                    </a>
                  )}
                  {shelter.donation_url && (
                    <a
                      href={shelter.donation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center text-sm font-semibold text-white bg-green-500 dark:bg-green-600 py-2 rounded-lg hover:bg-green-600 dark:hover:bg-green-700 transition-colors"
                    >
                      {t('shelters:donate')}
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-center mt-10">
        {myShelter ? (
          <Link
            to="/shelters/mine"
            className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition-colors"
          >
            {t('shelters:manageButton')}
          </Link>
        ) : (
          <>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">{t('shelters:registerCta')}</p>
            <Link
              to="/shelters/register"
              className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition-colors"
            >
              {t('shelters:registerButton')}
            </Link>
          </>
        )}
      </div>

      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 max-h-[85vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{detail.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">📍 {detail.city}</p>

            {detail.description && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 whitespace-pre-line">
                {detail.description}
              </p>
            )}

            <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1 mb-5">
              {detail.phone && (
                <p>
                  📱 <a href={`tel:${detail.phone}`} className="text-primary hover:underline">{detail.phone}</a>
                </p>
              )}
              {detail.email && (
                <p>
                  ✉️ <a href={`mailto:${detail.email}`} className="text-primary hover:underline break-all">{detail.email}</a>
                </p>
              )}
            </div>

            {(detail.website_url || detail.donation_url) && (
              <div className="flex gap-2 mb-5">
                {detail.website_url && (
                  <a
                    href={detail.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center text-sm font-semibold text-primary border border-primary py-2 rounded-lg hover:bg-primary/5 transition-colors"
                  >
                    {t('shelters:visitWeb')}
                  </a>
                )}
                {detail.donation_url && (
                  <a
                    href={detail.donation_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center text-sm font-semibold text-white bg-green-500 dark:bg-green-600 py-2 rounded-lg hover:bg-green-600 dark:hover:bg-green-700 transition-colors"
                  >
                    {t('shelters:donate')}
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setDetail(null)}
              className="w-full text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t('shelters:close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
