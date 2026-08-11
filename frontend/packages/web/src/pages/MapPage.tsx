import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from 'react-leaflet';
import { shouldShowSearchHere } from '@shared/utils/searchArea';
import { useTranslation } from 'react-i18next';
import { useNearbyReports, useNearbyVets } from '@shared/hooks';
import type { Report, Vet } from '@shared/types';
import { useTheme } from '../context/ThemeContext';
import { ReportPopup } from '../components/map/ReportPopup';
import { VetPopup } from '../components/map/VetPopup';
import { MapFilterPanel } from '../components/map/MapFilterPanel';
import { NearbyReportList } from '../components/map/NearbyReportList';
import { useMapFilters } from '../hooks/useMapFilters';
import { rastroDivIcon, vetDivIcon } from '../components/map/rastroMarker';

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
  const { t } = useTranslation(['map', 'pets', 'reports', 'vets']);
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

  const { draft, applied, setDraft, toggleStatus, apply, reset } = useMapFilters();
  const [radius, setRadius] = useState(3);
  // `applied`, NUNCA `draft`: pasar el borrador dispararia un request por cada
  // tecla, que es el defecto que el patron existe para evitar.
  const { data: reports, isLoading } = useNearbyReports(
    searchCenter[0], searchCenter[1], radius, true, applied,
  );
  const [showVets, setShowVets] = useState(false);
  const { data: vets } = useNearbyVets(searchCenter[0], searchCenter[1], 5000, showVets);

  const canSearchHere = shouldShowSearchHere(
    { lat: mapCenter[0], lng: mapCenter[1] },
    { lat: searchCenter[0], lng: searchCenter[1] },
    radius * 1000,
  );

  // Esta pagina va a ANCHO COMPLETO a proposito, rompiendo max-w-7xl (regla
  // #50). Esa regla capea paginas de CONTENIDO al ancho del navbar; el mapa es
  // un LIENZO y capearlo desperdicia viewport en la unica pantalla cuyo valor
  // es cuanto terreno muestra. Ver el spec del redisenio.
  //
  // El ALTO en cambio NO es completo: con 100vh el footer de MainLayout queda
  // debajo del pliegue y Leaflet se queda con la rueda del mouse, asi que no
  // habria forma comoda de bajar.
  return (
    <div className="w-full">
      <div className="flex flex-col lg:flex-row h-[78vh]">
        <aside className="w-full lg:w-80 shrink-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <MapFilterPanel
            draft={draft}
            onDraftChange={setDraft}
            onToggleStatus={toggleStatus}
            onApply={apply}
            onReset={reset}
            radius={radius}
            onRadiusChange={setRadius}
            showVets={showVets}
            onToggleVets={() => setShowVets((v) => !v)}
          />
          <NearbyReportList reports={reports} isLoading={isLoading} />
        </aside>

        <div className="relative flex-1">
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
                  icon={rastroDivIcon(
                    report.status,
                    report.pet?.photos?.find((ph) => ph.is_primary)?.url ?? report.pet?.photos?.[0]?.url,
                    report.pet?.name ?? '',
                  )}
                >
                  <Popup>
                    <ReportPopup report={report} />
                  </Popup>
                </Marker>
              ))}
              {showVets && vets?.map((vet: Vet) => (
                <Marker key={`vet-${vet.id}`} position={[vet.latitude, vet.longitude]} icon={vetDivIcon()}>
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
      </div>

      {/* El contador vive DEBAJO del mapa y no dentro del panel: el panel ya
          lista los reportes uno por uno, y repetir "N reportes" arriba de la
          lista seria decir dos veces lo mismo. El vacio tambien lo cubre la
          lista, asi que ese mensaje se fue. */}
      {showVets && vets && vets.length === 0 && (
        <p className="text-center text-gray-500 dark:text-gray-400 mt-2 text-sm">{t('vets:empty')}</p>
      )}
      {(!isLoading && reports && reports.length > 0) && (
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-3 text-center">
          {t('map:reports', { count: reports.length })}
        </p>
      )}
    </div>
  );
}
