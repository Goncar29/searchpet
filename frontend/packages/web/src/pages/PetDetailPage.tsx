// ============================================================
// PetDetailPage
// ============================================================
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { usePetByID, useReportsByPetID, useMarkPetAsFound } from '@shared/hooks';
import type { Photo, Report } from '@shared/types';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';
import { useAuth } from '../context/AuthContext';
import { SharePanel } from '../components/SharePanel';
import { PdfFlyerButton } from '../components/PdfFlyerButton';

export function PetDetailPage() {
  const { t, i18n } = useTranslation(['pets', 'common']);
  const { id } = useParams<{ id: string }>();
  const { user, isAuthenticated } = useAuth();
  const { data: pet, isLoading } = usePetByID(id || '');
  const { data: reports } = useReportsByPetID(id || '');
  const markAsFound = useMarkPetAsFound();

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden animate-pulse">
          {/* Image placeholder */}
          <div className="h-72 md:h-96 bg-gray-200 dark:bg-gray-700" />
          <div className="p-6 md:p-8 space-y-5">
            {/* Title placeholder */}
            <div className="h-8 w-1/2 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            {/* Attribute grid placeholder */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
            {/* Description placeholder */}
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
            </div>
            {/* Buttons placeholder */}
            <div className="flex gap-3">
              <div className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
              <div className="h-10 w-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!pet) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('pets:detail.notFound')}</h2>
        <Link to="/" className="text-primary font-semibold mt-4 inline-block">{t('common:back')}</Link>
      </div>
    );
  }

  const primaryPhoto = pet.photos?.find((p: Photo) => p.is_primary) || pet.photos?.[0];
  const isOwner = isAuthenticated && user?.id === pet.owner_id;

  const statusBadge =
    pet.status === 'found'
      ? { color: 'bg-green-500', label: t('pets:status.found').toUpperCase() }
      : pet.status === 'archived'
      ? { color: 'bg-gray-500', label: t('pets:status.archived').toUpperCase() }
      : { color: 'bg-blue-500', label: t('pets:status.active').toUpperCase() };

  const getReportStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return t('pets:status.lost');
      case 'found': return t('pets:status.found');
      case 'sighting': return t('pets:card.sighting');
      default: return status;
    }
  };

  // Fecha efectiva del reporte: occurred_at si existe, sino created_at
  const getReportDate = (report: Report): string => {
    const dateStr = report.occurred_at ?? report.created_at;
    return new Date(dateStr).toLocaleDateString(i18n.language, {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  // SEO — descripción truncada a 160 caracteres
  const ogDescription = pet.description
    ? pet.description.slice(0, 160) + (pet.description.length > 160 ? '...' : '')
    : `Ayudanos a encontrar a ${pet.name}`;
  const ogImage = primaryPhoto?.url;

  return (
    <>
      <Helmet>
        <title>{pet.name} — SearchPet</title>
        <meta property="og:title" content={`${pet.name} — SearchPet`} />
        <meta property="og:description" content={ogDescription} />
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden">
          {/* Foto */}
          <div className="relative h-72 md:h-96 bg-gray-100 dark:bg-gray-800">
            {primaryPhoto ? (
              <img
                src={primaryPhoto.url}
                alt={pet.name}
                className="w-full h-full object-contain"
                crossOrigin="anonymous"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><span className="text-7xl">🐾</span></div>
            )}
            <span className={`absolute top-4 left-4 ${statusBadge.color} text-white text-xs font-bold px-3 py-1 rounded`}>
              {statusBadge.label}
            </span>
            {/* Banner de encontrada sobre la imagen */}
            {pet.status === 'found' && (
              <div className="absolute bottom-0 left-0 right-0 bg-green-500/90 text-white text-center py-2 font-bold text-sm">
                ¡Esta mascota fue encontrada!
              </div>
            )}
          </div>

          <div className="p-6 md:p-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">{pet.name}</h1>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {pet.type && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('pets:detail.type')}</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.type}</p>
                </div>
              )}
              {pet.breed && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('pets:detail.breed')}</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.breed}</p>
                </div>
              )}
              {pet.color && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('pets:detail.color')}</p>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.color}</p>
                </div>
              )}
            </div>

            {pet.description && (
              <div className="mb-6">
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-2">{t('pets:detail.description')}</h3>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed">{pet.description}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3 mb-6">
              <SharePanel
                petId={pet.id}
                petName={pet.name}
                petStatus={pet.status}
              />
              {isAuthenticated && (
                <Link
                  to={`/reports/create?petId=${id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-primary text-primary font-semibold rounded-lg hover:bg-primary/5 transition-colors"
                >
                  {t('pets:detail.addReport')}
                </Link>
              )}
              {/* Mark as Found — solo para el dueño cuando la mascota está activa */}
              {isOwner && pet.status === 'active' && (
                <button
                  onClick={() => markAsFound.mutate(pet.id)}
                  disabled={markAsFound.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {markAsFound.isPending ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Guardando...
                    </>
                  ) : (
                    '✅ Marcar como encontrada'
                  )}
                </button>
              )}
              {/* PDF Flyer */}
              <PdfFlyerButton pet={pet} reports={reports ?? []} />
            </div>

            {/* Dueño */}
            {pet.owner && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-6">
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-3">{t('pets:detail.owner')}</h3>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-xl">👤</div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{pet.owner.name}</p>
                    {pet.owner.is_verified && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-semibold">{t('pets:detail.verified')}</p>
                    )}
                    {pet.owner.phone ? (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">📞 {pet.owner.phone}</p>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('pets:detail.noPhone')}</p>
                    )}
                  </div>
                </div>
                {pet.owner.phone && (
                  <a
                    href={buildWhatsAppContactURL(pet.owner.phone, pet)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 w-full inline-flex items-center justify-center bg-[#25D366] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity"
                  >
                    {t('pets:detail.contact')}
                  </a>
                )}
              </div>
            )}

            {/* Timeline */}
            {reports && reports.length > 0 && (
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-4">
                  {t('pets:detail.timeline', { count: reports.length })}
                </h3>
                <div className="space-y-0">
                  {reports.map((report: Report, index: number) => (
                    <div key={report.id} className="flex gap-3 relative">
                      {/* Línea conectora — visible entre entradas consecutivas */}
                      {index < reports.length - 1 && (
                        <div
                          className="absolute left-[5px] top-[20px] bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"
                          aria-hidden="true"
                        />
                      )}
                      <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 relative z-10 ${
                        report.status === 'lost' ? 'bg-red-500' :
                        report.status === 'found' ? 'bg-green-500' : 'bg-yellow-500'
                      }`} />
                      <div className="pb-4">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {getReportStatusLabel(report.status)}
                        </p>
                        {report.location_description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">📍 {report.location_description}</p>
                        )}
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {getReportDate(report)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
