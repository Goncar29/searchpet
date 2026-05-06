import { useParams } from 'react-router';
import { useSharedPet } from '@shared/hooks';
import type { Photo } from '@shared/types';

export function SharedPetPage() {
  const { token } = useParams<{ token: string }>();
  const { data: pet, isLoading } = useSharedPet(token || '');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!pet) {
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

  const primaryPhoto = pet.photos?.find((p: Photo) => p.is_primary) || pet.photos?.[0];
  const statusLabel = pet.status === 'found' ? 'ENCONTRADO' : 'PERDIDO';
  const statusBg = pet.status === 'found' ? 'bg-green-500' : 'bg-red-500';

  return (
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
            {pet.owner?.phone && (
              <a
                href={`https://wa.me/${pet.owner.phone}?text=Vi tu mascota ${pet.name} en SearchPet`}
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
  );
}
