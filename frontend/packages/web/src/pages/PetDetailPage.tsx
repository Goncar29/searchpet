// ============================================================
// PetDetailPage
// ============================================================
import { useParams, Link } from 'react-router';
import { usePetByID, useReportsByPetID } from '@shared/hooks';
import type { Photo, Report } from '@shared/types';

export function PetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: pet, isLoading } = usePetByID(id || '');
  const { data: reports } = useReportsByPetID(id || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!pet) {
    return (
      <div className="text-center py-20">
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-xl font-bold text-gray-900">Mascota no encontrada</h2>
        <Link to="/" className="text-primary font-semibold mt-4 inline-block">Volver al inicio</Link>
      </div>
    );
  }

  const primaryPhoto = pet.photos?.find((p: Photo) => p.is_primary) || pet.photos?.[0];
  const statusColor = pet.status === 'found' ? 'bg-green-500' : 'bg-red-500';
  const statusLabel = pet.status === 'found' ? 'ENCONTRADO' : 'PERDIDO';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Foto */}
        <div className="relative h-72 md:h-96 bg-gray-100">
          {primaryPhoto ? (
            <img src={primaryPhoto.url} alt={pet.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><span className="text-7xl">🐾</span></div>
          )}
          <span className={`absolute top-4 left-4 ${statusColor} text-white text-xs font-bold px-3 py-1 rounded`}>
            {statusLabel}
          </span>
        </div>

        <div className="p-6 md:p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{pet.name}</h1>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {pet.type && <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Tipo</p><p className="font-semibold text-gray-900">{pet.type}</p></div>}
            {pet.breed && <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Raza</p><p className="font-semibold text-gray-900">{pet.breed}</p></div>}
            {pet.color && <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Color</p><p className="font-semibold text-gray-900">{pet.color}</p></div>}
          </div>

          {pet.description && (
            <div className="mb-6">
              <h3 className="font-bold text-gray-900 mb-2">Descripción</h3>
              <p className="text-gray-600 leading-relaxed">{pet.description}</p>
            </div>
          )}

          {/* Dueño */}
          {pet.owner && (
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <h3 className="font-bold text-gray-900 mb-3">Contacto del dueño</h3>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-xl">👤</div>
                <div>
                  <p className="font-semibold text-gray-900">{pet.owner.name}</p>
                  {pet.owner.is_verified && <p className="text-xs text-green-600 font-semibold">Verificado</p>}
                </div>
              </div>
              {pet.owner.phone && (
                <a
                  href={`https://wa.me/${pet.owner.phone}?text=Hola, vi tu mascota ${pet.name} en SearchPet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 w-full inline-flex items-center justify-center bg-[#25D366] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity"
                >
                  Contactar por WhatsApp
                </a>
              )}
            </div>
          )}

          {/* Timeline */}
          {reports && reports.length > 0 && (
            <div>
              <h3 className="font-bold text-gray-900 mb-4">Historial de reportes ({reports.length})</h3>
              <div className="space-y-4">
                {reports.map((report: Report) => (
                  <div key={report.id} className="flex gap-3">
                    <div className={`w-3 h-3 rounded-full mt-1.5 flex-shrink-0 ${
                      report.status === 'lost' ? 'bg-red-500' :
                      report.status === 'found' ? 'bg-green-500' : 'bg-yellow-500'
                    }`} />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {report.status === 'lost' ? 'Perdido' : report.status === 'found' ? 'Encontrado' : 'Avistado'}
                      </p>
                      {report.location_description && (
                        <p className="text-sm text-gray-500">📍 {report.location_description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(report.created_at).toLocaleDateString('es', {
                          day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
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
  );
}
