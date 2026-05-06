import { Link } from 'react-router';
import type { Report } from '@shared/types';

interface PetCardWebProps {
  report: Report;
}

export function PetCardWeb({ report }: PetCardWebProps) {
  const pet = report.pet;
  const primaryPhoto = pet?.photos?.find(p => p.is_primary) || pet?.photos?.[0];

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'lost': return { label: 'PERDIDO', bg: 'bg-red-500' };
      case 'found': return { label: 'ENCONTRADO', bg: 'bg-green-500' };
      case 'sighting': return { label: 'AVISTADO', bg: 'bg-yellow-500' };
      default: return { label: status, bg: 'bg-gray-500' };
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 60) return `hace ${mins} min`;
    if (hours < 24) return `hace ${hours}h`;
    if (days < 7) return `hace ${days}d`;
    return new Date(dateStr).toLocaleDateString('es');
  };

  const status = getStatusConfig(report.status);

  return (
    <Link
      to={`/pets/${pet?.id || report.pet_id}`}
      className="group bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
    >
      {/* Imagen */}
      <div className="relative h-48 bg-gray-100">
        {primaryPhoto ? (
          <img
            src={primaryPhoto.url}
            alt={pet?.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl">🐾</span>
          </div>
        )}
        <span className={`absolute top-3 left-3 ${status.bg} text-white text-[10px] font-bold px-2 py-1 rounded tracking-wider`}>
          {status.label}
        </span>
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-900 text-lg truncate">
            {pet?.name || 'Sin nombre'}
          </h3>
          <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
            {getTimeAgo(report.created_at)}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {pet?.type && (
            <span className="bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded">{pet.type}</span>
          )}
          {pet?.breed && (
            <span className="bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded">{pet.breed}</span>
          )}
          {pet?.color && (
            <span className="bg-gray-100 text-gray-600 text-xs font-medium px-2 py-0.5 rounded">{pet.color}</span>
          )}
        </div>

        {report.location_description && (
          <p className="text-sm text-gray-500 truncate">📍 {report.location_description}</p>
        )}
      </div>
    </Link>
  );
}
