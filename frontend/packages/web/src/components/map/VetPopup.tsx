import { useTranslation } from 'react-i18next';
import { formatDistance } from '@shared/utils/mapFormat';
import { safeExternalUrl } from '@shared/utils/safeExternalUrl';
import type { Vet } from '@shared/types';

// Movido tal cual desde MapPage, con su helper de direcciones.
export function VetPopup({ vet }: { vet: Vet }) {
  const { t: tv } = useTranslation('vets');
  // vet.website is an OpenStreetMap tag, so it is world-editable, and React does
  // not check schemes on href. The import drops non-http(s) values at the door
  // now; rows stored before that filter existed still carry whatever OSM had.
  const website = safeExternalUrl(vet.website);

  const directionsUrl = (lat: number, lng: number) =>
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

  return (
    <div className="w-52">
      <h3 className="font-bold text-base leading-tight">{vet.name || tv('defaultName')}</h3>
      <p className="text-xs font-semibold text-primary mt-0.5">📍 {formatDistance(vet.distance_meters)}</p>
      {vet.address && <p className="text-sm text-gray-600 mt-1">{vet.address}</p>}
      {vet.opening_hours && <p className="text-xs text-gray-500 mt-1">🕐 {vet.opening_hours}</p>}
      <div className="flex gap-3 mt-2 flex-wrap">
        <a
          href={directionsUrl(vet.latitude, vet.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary font-semibold hover:underline"
        >
          {tv('directions')} →
        </a>
        {vet.phone && (
          <a href={`tel:${vet.phone}`} className="text-sm text-primary font-semibold hover:underline">
            {tv('call')}
          </a>
        )}
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary font-semibold hover:underline"
          >
            {tv('website')}
          </a>
        )}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">{tv('attribution')}</p>
    </div>
  );
}
