import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from 'react-leaflet';
import { shouldShowSearchHere } from '@shared/utils/searchArea';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { useNearbyReports, useNearbyVets } from '@shared/hooks';
import type { Report, Vet } from '@shared/types';
import { useTheme } from '../context/ThemeContext';
import { ReportPopup } from '../components/map/ReportPopup';
import { VetPopup } from '../components/map/VetPopup';

const lostIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const foundIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const sightingIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const vetIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function MapPanTracker({ onCenterChange }: { onCenterChange: (c: [number, number]) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onCenterChange([c.lat, c.lng]);
    },
  });
  return null;
}

export function MapPage() {
  const { t } = useTranslation(['map', 'pets', 'reports']);
  const { theme } = useTheme();
  const [searchCenter, setSearchCenter] = useState<[number, number]>([-34.9011, -56.1645]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-34.9011, -56.1645]);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setSearchCenter(here);
        setMapCenter(here);
      },
      () => {
        /* keep the default center when geolocation is denied */
      }
    );
  }, []);

  const { t: tv } = useTranslation('vets');
  const [radius, setRadius] = useState(3);
  const { data: reports, isLoading } = useNearbyReports(searchCenter[0], searchCenter[1], radius, true);
  const [showVets, setShowVets] = useState(false);
  const { data: vets } = useNearbyVets(searchCenter[0], searchCenter[1], 5000, showVets);

  const canSearchHere = shouldShowSearchHere(
    { lat: mapCenter[0], lng: mapCenter[1] },
    { lat: searchCenter[0], lng: searchCenter[1] },
    radius * 1000,
  );

  const getIcon = (status: string) => {
    switch (status) {
      case 'lost': return lostIcon;
      case 'found': return foundIcon;
      case 'sighting': return sightingIcon;
      default: return lostIcon;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col gap-3 min-[530px]:flex-row min-[530px]:items-start min-[530px]:justify-between min-[530px]:gap-4 mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 shrink-0">{t('map:title')}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-[530px]:justify-end text-sm text-gray-700 dark:text-gray-300">
          <button
            type="button"
            onClick={() => setShowVets((v) => !v)}
            className={`px-3 py-1 rounded-full text-sm font-semibold border transition-colors ${
              showVets
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}
          >
            🏥 {showVets ? tv('hide') : tv('toggle')}
          </button>
          <label className="flex items-center gap-1 font-medium">
            {t('map:radius')}:
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="ml-1 border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {[1, 3, 5, 10].map((km) => (
                <option key={km} value={km}>{t('map:radiusKm', { km })}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-lost inline-block"></span> {t('pets:status.lost')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-found inline-block"></span> {t('pets:status.found')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-sighting inline-block"></span> {t('pets:card.sighting')}
            </span>
          </div>
        </div>
      </div>

      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden" style={{ height: '70vh' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <>
            {/* `center` is mount-only in react-leaflet; later searchCenter changes move the
                markers/circle but not the viewport (panning is user-driven via the button). */}
            <MapContainer center={searchCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
              <MapPanTracker onCenterChange={setMapCenter} />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                // @ts-ignore — style is a valid prop for the underlying <img> elements
                className={theme === 'dark' ? 'dark-tiles' : undefined}
              />
              {/* Dark mode tile filter overlay */}
              {theme === 'dark' && (
                <style>{`.leaflet-tile { filter: invert(100%) hue-rotate(180deg) !important; }`}</style>
              )}
              <Circle
                center={searchCenter}
                radius={radius * 1000}
                pathOptions={{
                  color: '#6366f1',
                  fillColor: '#6366f1',
                  fillOpacity: 0.08,
                  weight: 2,
                  dashArray: '6 4',
                }}
              />
              {reports?.map((report: Report) => (
                <Marker
                  key={report.id}
                  position={[report.latitude, report.longitude]}
                  icon={getIcon(report.status)}
                >
                  <Popup>
                    <ReportPopup report={report} />
                  </Popup>
                </Marker>
              ))}
              {showVets && vets?.map((vet: Vet) => (
                <Marker key={`vet-${vet.id}`} position={[vet.latitude, vet.longitude]} icon={vetIcon}>
                  <Popup>
                    <VetPopup vet={vet} />
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
            {canSearchHere && (
              <button
                type="button"
                onClick={() => setSearchCenter(mapCenter)}
                className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold shadow-lg hover:bg-primary/90"
              >
                {t('map:searchHere')}
              </button>
            )}
          </>
        )}
      </div>

      {!isLoading && reports && reports.length === 0 && (
        <p className="text-center text-gray-500 dark:text-gray-400 mt-4 text-sm">
          {t('reports:nearby.empty')}
        </p>
      )}
      {showVets && vets && vets.length === 0 && (
        <p className="text-center text-gray-500 dark:text-gray-400 mt-2 text-sm">{tv('empty')}</p>
      )}

      {(!isLoading && reports && reports.length > 0) && (
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-3 text-center">
          {t('map:reports', { count: reports.length })}
        </p>
      )}
    </div>
  );
}
