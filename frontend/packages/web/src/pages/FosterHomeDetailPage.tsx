import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFosterHomeByID } from '@shared/hooks';
import { ApiError } from '@shared/api/client';
import { useAuth } from '../context/AuthContext';
import { ReportFosterHomeModal } from '../components/ReportFosterHomeModal';
import { cloudinaryFit } from '@shared/utils/cloudinaryThumb';

export function FosterHomeDetailPage() {
  const { t } = useTranslation(['fosterHomes', 'errors', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: fosterHome, isLoading, isError, error, refetch } = useFosterHomeByID(id || '');

  // Espeja `mobile/app/foster-home/[id].tsx`, que es la MISMA pantalla: sin
  // esto, web se quedaba con el defecto que este PR arregla en mobile.
  //
  // `apiClient` tira `ApiError` ante cualquier respuesta no-ok, así que un hogar
  // dado de baja llega igual que un 502. Y el 400 entra en "no existe" porque
  // `GetApprovedByID` hace `uuid.Parse(id)` antes que nada: una URL con un id
  // roto no es un fallo de lectura.
  const noExiste =
    error instanceof ApiError && (error.status === 404 || error.status === 400);
  const falloLaLectura = isError && !noExiste;
  const [showReportModal, setShowReportModal] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

  // `!fosterHome || noExiste` y NO `isError || !fosterHome`.
  //
  // Con el `||` viejo, un refetch fallido TAPABA un hogar ya cargado y visible
  // con "Hogar no encontrado": React Query conserva lo cacheado, así que había
  // datos en pantalla y el cartel mentía sobre ellos.
  //
  // Y `noExiste` sí descarta lo cacheado, porque un 404 es una respuesta
  // definitiva de que la fila no está — el caso de un hogar suspendido por
  // moderación, que no puede seguir mostrándose a quien ya lo tenía abierto.
  // Un 502 no dice nada sobre el hogar, así que ahí se conserva.
  //
  // El backend 404ea también los no aprobados, así que no hay un estado
  // "pendiente de aprobación" distinto para mostrarle al visitante.
  if (!fosterHome || noExiste) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">{falloLaLectura ? '⚠️' : '🏠'}</p>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {falloLaLectura ? t('fosterHomes:detail.loadError') : t('fosterHomes:detail.notFound')}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          {falloLaLectura
            ? t('fosterHomes:detail.loadErrorText')
            : t('fosterHomes:detail.notFoundText')}
        </p>
        {/* Volver está SIEMPRE; reintentar sólo cuando puede servir de algo.
            Contra un 404 sería prometer algo que no va a pasar. */}
        {falloLaLectura && (
          <button
            onClick={() => refetch()}
            className="text-primary font-semibold mt-4 inline-block mr-4"
          >
            {t('fosterHomes:detail.retry')}
          </button>
        )}
        <Link to="/fosterhomes" className="text-primary font-semibold mt-4 inline-block">{t('common:back')}</Link>
      </div>
    );
  }

  const isOwnHome = !!user && user.id === fosterHome.owner_user_id;
  const whatsappDigits = fosterHome.whatsapp_phone?.replace(/[^0-9]/g, '');

  const photos = fosterHome.photos;
  const safePhotoIndex = photos.length > 0 ? Math.min(activePhotoIndex, photos.length - 1) : 0;
  const activePhoto = photos[safePhotoIndex];
  const goToPhoto = (delta: number) => {
    setActivePhotoIndex((safePhotoIndex + delta + photos.length) % photos.length);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg">
        {/* Galería de fotos — una a la vez con navegación (mismo patrón que el detalle de mascota) */}
        {photos.length > 0 && activePhoto ? (
          <div className="relative h-72 md:h-96 bg-gray-100 dark:bg-gray-800 overflow-hidden rounded-t-2xl">
            <img src={cloudinaryFit(activePhoto.url, 1200, 768)} alt={fosterHome.city} className="w-full h-full object-contain" />
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => goToPhoto(-1)}
                  aria-label={t('fosterHomes:detail.prevPhoto')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => goToPhoto(1)}
                  aria-label={t('fosterHomes:detail.nextPhoto')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  ›
                </button>
                <span className="absolute bottom-3 right-3 text-xs font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">
                  📷 {safePhotoIndex + 1}/{photos.length}
                </span>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {photos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActivePhotoIndex(i)}
                      aria-label={t('fosterHomes:detail.goToPhoto', { number: i + 1 })}
                      className={`w-2 h-2 rounded-full transition-colors ${i === safePhotoIndex ? 'bg-white' : 'bg-white/40 hover:bg-white/70'
                        }`}
                    />
                  ))}
                </div>
              </>
            )}
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
