import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import type { InitialReportRequest } from '@shared/types';

const MONTEVIDEO: [number, number] = [-34.9011, -56.1645];

const pinIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function RecenterOnChange({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(position);
  }, [map, position]);
  return null;
}

interface LocationStepProps {
  value: InitialReportRequest | null;
  onPublish: (location: InitialReportRequest) => void;
  onBack: () => void;
  isPending: boolean;
}

export function LocationStep({ value, onPublish, onBack, isPending }: LocationStepProps) {
  const { t } = useTranslation('publish');
  const [position, setPosition] = useState<[number, number]>(
    value ? [value.latitude, value.longitude] : MONTEVIDEO
  );
  const [note, setNote] = useState(value?.note ?? '');
  const [locationError, setLocationError] = useState<string | null>(null);

  const useMyLocation = () => {
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition([pos.coords.latitude, pos.coords.longitude]),
      () => setLocationError(t('location.locationDenied'))
    );
  };

  const handlePublish = () => {
    onPublish({ latitude: position[0], longitude: position[1], note: note.trim() || undefined });
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center">
        {t('location.title')}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('location.instructions')}</p>

      <div className="h-72 rounded-xl overflow-hidden">
        <MapContainer center={position} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={position}
            draggable
            icon={pinIcon}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const latLng = marker.getLatLng();
                setPosition([latLng.lat, latLng.lng]);
              },
            }}
          />
          <RecenterOnChange position={position} />
        </MapContainer>
      </div>

      <button
        type="button"
        onClick={useMyLocation}
        className="w-full border-2 border-primary text-primary font-semibold rounded-lg px-4 py-2 hover:bg-primary/5 transition-colors"
      >
        {t('location.useMyLocation')}
      </button>
      {locationError && (
        <p role="alert" className="text-yellow-600 dark:text-yellow-400 text-sm text-center">
          {locationError}
        </p>
      )}

      <div>
        <label htmlFor="location-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('location.noteLabel')}
        </label>
        <textarea
          id="location-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('location.notePlaceholder')}
          rows={2}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {t('location.back')}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={isPending}
          className="flex-1 bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {t('location.publish')}
        </button>
      </div>
    </div>
  );
}
