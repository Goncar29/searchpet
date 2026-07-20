import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFosterHomeByID } from '@shared/hooks';
import { useAuth } from '../context/AuthContext';
import { ReportFosterHomeModal } from '../components/ReportFosterHomeModal';

export function FosterHomeDetailPage() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: fosterHome, isLoading, isError } = useFosterHomeByID(id || '');
  const [showReportModal, setShowReportModal] = useState(false);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden animate-pulse">
          <div className="h-72 md:h-96 bg-gray-200 dark:bg-gray-700" />
          <div className="p-6 md:p-8 space-y-5">
            <div className="h-8 w-1/2 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 404 (not found or not approved) and network errors both land here — the
  // backend intentionally 404s non-approved homes, so there's no distinct
  // "not approved" state to show the visitor.
  if (isError || !fosterHome) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">🏠</p>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('fosterHomes:detail.notFound')}</h2>
        <Link to="/hogares" className="text-primary font-semibold mt-4 inline-block">{t('common:back')}</Link>
      </div>
    );
  }

  const isOwnHome = !!user && user.id === fosterHome.owner_user_id;
  const whatsappDigits = fosterHome.whatsapp_phone?.replace(/[^0-9]/g, '');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg">
        {/* Galería de fotos */}
        {fosterHome.photos.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-1 rounded-t-2xl overflow-hidden">
            {fosterHome.photos.map((photo) => (
              <div key={photo.id} className="aspect-square bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <img src={photo.url} alt={fosterHome.city} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        ) : (
          <div className="h-56 bg-gray-100 dark:bg-gray-800 rounded-t-2xl flex items-center justify-center">
            <span className="text-7xl">🏠</span>
          </div>
        )}

        <div className="p-6 md:p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">📍 {fosterHome.city}</h1>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('fosterHomes:register.housingType')}</p>
              <p className="font-semibold text-gray-900 dark:text-gray-100">
                {t(`fosterHomes:housingType.${fosterHome.housing_type}`)}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('fosterHomes:directory.capacity')}</p>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{fosterHome.capacity}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 col-span-2 md:col-span-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('fosterHomes:directory.filterAnimal')}</p>
              <div className="flex flex-wrap gap-1">
                {fosterHome.animal_types.map((kind) => (
                  <span
                    key={kind}
                    className="text-xs bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full"
                  >
                    {t(`fosterHomes:animalType.${kind}`)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {fosterHome.description && (
            <div className="mb-6">
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                {fosterHome.description}
              </p>
            </div>
          )}

          {/* Contacto (§7) */}
          {!isOwnHome && (
            <div className="flex flex-wrap gap-3 mb-6">
              <button
                type="button"
                onClick={() => navigate(`/messages/${fosterHome.owner_user_id}`)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded-lg transition-colors"
              >
                💬 {t('fosterHomes:detail.contactChat')}
              </button>
              {fosterHome.whatsapp_phone && whatsappDigits && (
                <a
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white font-bold rounded-lg transition-colors"
                >
                  📱 {t('fosterHomes:detail.contactWhatsapp')}
                </a>
              )}
              <button
                type="button"
                onClick={() => setShowReportModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 font-semibold rounded-lg hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors"
              >
                🚩 {t('fosterHomes:detail.reportCta')}
              </button>
            </div>
          )}
        </div>
      </div>

      {showReportModal && (
        <ReportFosterHomeModal fosterHomeId={fosterHome.id} onClose={() => setShowReportModal(false)} />
      )}
    </div>
  );
}
