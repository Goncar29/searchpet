import { useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { useSharedPet } from '@shared/hooks';
import { buildWhatsAppContactURL } from '@shared/utils/whatsappTemplates';

export function SharedPetPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading } = useSharedPet(token || '');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-6xl mb-4">🔍</p>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Mascota no encontrada</h1>
          <p className="text-gray-500">Este link puede haber expirado</p>
        </div>
      </div>
    );
  }

  const pet = data.pet;
  const owner = data.owner;
  const primaryPhoto = pet.photos?.find((p) => p.is_primary) || pet.photos?.[0];
  const statusLabel = pet.status === 'found' ? 'ENCONTRADO' : 'PERDIDO';
  const statusBg = pet.status === 'found' ? 'bg-green-500' : 'bg-red-500';

  // SEO
  const pageTitle = `${pet.name} — ${pet.status === 'found' ? 'Encontrado' : 'Mascota Perdida'} | SearchPet`;
  const ogDescription = pet.description
    ? pet.description.slice(0, 160) + (pet.description.length > 160 ? '...' : '')
    : `Ayudanos a encontrar a ${pet.name}`;
  const shareUrl = `${window.location.origin}/pet/${token}`;

  // WhatsApp contact URL usando la utilidad compartida
  const whatsappUrl = owner?.phone
    ? buildWhatsAppContactURL(owner.phone, { ...pet, status: pet.status }, shareUrl)
    : null;

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={ogDescription} />
        {primaryPhoto?.url && <meta property="og:image" content={primaryPhoto.url} />}
        <meta property="og:url" content={shareUrl} />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 py-4">
          <div className="max-w-lg mx-auto px-4 flex items-center gap-2">
            <span className="text-2xl">🐾</span>
            <span className="text-xl font-bold text-gray-900">
              Search<span className="text-primary">Pet</span>
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Alert */}
            <div className={`${statusBg} text-white text-center py-3`}>
              <p className="text-sm font-bold tracking-wider">{statusLabel}</p>
            </div>

            {/* Foto */}
            <div className="h-72 bg-gray-100">
              {primaryPhoto ? (
                <img src={primaryPhoto.url} alt={pet.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-7xl">🐾</span>
                </div>
              )}
            </div>

            <div className="p-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-4">{pet.name}</h1>

              <div className="space-y-2 mb-6">
                {pet.type && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500 text-sm">Tipo</span>
                    <span className="font-semibold text-sm">{pet.type}</span>
                  </div>
                )}
                {pet.breed && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500 text-sm">Raza</span>
                    <span className="font-semibold text-sm">{pet.breed}</span>
                  </div>
                )}
                {pet.color && (
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500 text-sm">Color</span>
                    <span className="font-semibold text-sm">{pet.color}</span>
                  </div>
                )}
              </div>

              {pet.description && (
                <p className="text-gray-600 text-sm leading-relaxed mb-6">{pet.description}</p>
              )}

              {/* Contact Button */}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full bg-[#25D366] text-white text-center font-bold py-4 rounded-xl hover:opacity-90 transition-opacity mb-3"
                >
                  Contactar al dueño por WhatsApp
                </a>
              )}

              {/* Download app CTA */}
              <div className="bg-primary/5 rounded-xl p-4 text-center mt-4">
                <p className="text-sm text-gray-600 mb-2">
                  ¿Quieres ayudar a encontrar más mascotas?
                </p>
                <p className="text-sm font-bold text-primary">
                  Descarga SearchPet — 100% gratuita
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
