import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents, useMap } from 'react-leaflet';
import { shouldShowSearchHere } from '@shared/utils/searchArea';
import { vetLayerRadiusMeters } from '@shared/utils/vetLayerRadius';
import { useTranslation } from 'react-i18next';
import { useNearbyReports, useNearbyVets } from '@shared/hooks';
import type { Report, Vet } from '@shared/types';
import { useTheme } from '../context/ThemeContext';
import { ReportPopup } from '../components/map/ReportPopup';
import { VetPopup } from '../components/map/VetPopup';
import { MapFilterPanel } from '../components/map/MapFilterPanel';
import { NearbyReportList } from '../components/map/NearbyReportList';
import { MapPanel } from '../components/map/MapPanel';
import { useMapFilters } from '../hooks/useMapFilters';
import { resumirFiltros } from '../utils/mapFilterSummary';
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

/**
 * Lleva el viewport al centro de búsqueda cuando ese centro cambia.
 *
 * `center` de MapContainer se lee SÓLO al montar, así que sin esto el mapa no
 * sigue a `searchCenter`. Parecía funcionar por accidente: el ternario de
 * `isLoading` remonta el MapContainer en cada búsqueda nueva, y ese remonte
 * volvía a leer `center`.
 *
 * Se rompía justo cuando la respuesta estaba CACHEADA. Medido: buscar
 * "Punta del Este" → "Colonia" → "Punta del Este" pedía 20, 15 y **cero**
 * tiles. En la tercera el input decía "Punta del Este" y el mapa mostraba
 * Colonia, a 300 km — con los resultados correspondiendo a un tercer lugar.
 */
function MapViewSync({ center }: { center: [number, number] }) {
  const map = useMap();
  const [lat, lng] = center;
  useEffect(() => {
    // Dependencias por VALOR y no por el array: `center` es un literal nuevo en
    // cada render, y con él en las deps esto se dispararía siempre.
    map.setView([lat, lng]);
  }, [map, lat, lng]);
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

  const { draft, applied, rangeError, setDraft, toggleStatus, apply, reset } = useMapFilters();
  const [radius, setRadius] = useState(3);
  // `applied`, NUNCA `draft`: pasar el borrador dispararia un request por cada
  // tecla, que es el defecto que el patron existe para evitar.
  //
  // `isError` viaja hasta la lista. Sin el, un request fallido llega ahi como
  // `reports === undefined` con `isLoading === false`, indistinguible de una
  // busqueda que no encontro nada.
  const { data: reports, isLoading, isError } = useNearbyReports(
    searchCenter[0], searchCenter[1], radius, true, applied,
  );
  const [showVets, setShowVets] = useState(false);
  // Estaba hardcodeado en 5000 e ignoraba el selector: con el radio en 10 km los
  // reportes se estiraban y las veterinarias no. La regla (seguir al selector,
  // con piso) vive en shared/ para que web y mobile no la escriban por separado
  // — que fue como se colo el bug.
  const { data: vets } = useNearbyVets(
    searchCenter[0], searchCenter[1], vetLayerRadiusMeters(radius), showVets,
  );

  const canSearchHere = shouldShowSearchHere(
    { lat: mapCenter[0], lng: mapCenter[1] },
    { lat: searchCenter[0], lng: searchCenter[1] },
    radius * 1000,
  );

  // Los iconos se arman UNA vez por respuesta, no una vez por render.
  //
  // Con divIcon el marcador es una cadena de HTML, y react-leaflet compara
  // `props.icon` POR REFERENCIA: un objeto nuevo lo hace llamar a setIcon, y
  // ahi Leaflet reasigna innerHTML, o sea que destruye y recrea el <img> de
  // cada pin. Construirlos inline volvia eso a pasar en CADA render — y esta
  // pantalla re-renderiza en cada moveend del mapa y en cada tecla del
  // borrador de filtros. Antes eran L.Icon constantes a nivel de modulo, asi
  // que el churn lo introdujo el marcador nuevo.
  //
  // `reports` viene de React Query, que conserva la identidad del array
  // mientras la respuesta no cambia: eso es lo que hace que este memo aguante
  // el paneo y el tipeo.
  const iconosPorReporte = useMemo(() => {
    const m = new Map<string, ReturnType<typeof rastroDivIcon>>();
    reports?.forEach((r: Report) => {
      m.set(r.id, rastroDivIcon(
        r.status,
        r.pet?.photos?.find((ph) => ph.is_primary)?.url ?? r.pet?.photos?.[0]?.url,
        r.pet?.name ?? '',
      ));
    });
    return m;
  }, [reports]);

  // No depende de nada: una sola instancia para todas las veterinarias.
  const iconoVet = useMemo(() => vetDivIcon(), []);

  // Se resume lo APLICADO y no el borrador: es lo que describe los pines que
  // hay en pantalla. Con el borrador, cerrar el panel a mitad de una edición
  // anunciaría filtros que la búsqueda no está usando.
  const resumen = useMemo(() => resumirFiltros(applied), [applied]);

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
      {/* Ahora el alto fijo vale para los DOS anchos, y eso lo habilita la hoja.
          Antes el panel era un hermano en flujo que en celular media ~1850px de
          contenido real: con un alto fijo en el contenedor se comia el alto
          entero y dejaba al mapa con `flex-1` sobre CERO espacio — medido,
          `.leaflet-container` daba 390x0. Al superponerse y scrollear por
          dentro, el panel ya no le disputa el alto a nadie.

          `relative` es el sistema de referencia de la hoja, y `overflow-hidden`
          hace falta porque en `peek` la hoja queda desplazada casi su alto
          entero hacia abajo: sin recortar, ese sobrante empuja la pagina. */}
      <div className="relative overflow-hidden flex flex-col lg:flex-row h-[78vh]">
        <MapPanel
          resumen={resumen}
          resultCount={reports?.length}
          isLoading={isLoading}
          // `isError` NO se queda en la lista. En `peek` la lista esta fuera de
          // la pantalla y la barra es lo unico visible: sin esto, un request
          // caido se ve igual que una busqueda sin resultados.
          isError={isError}
        >
          <MapFilterPanel
            draft={draft}
            onDraftChange={setDraft}
            onToggleStatus={toggleStatus}
            onApply={apply}
            onReset={reset}
            rangeError={rangeError}
            radius={radius}
            onRadiusChange={setRadius}
            showVets={showVets}
            onToggleVets={() => setShowVets((v) => !v)}
            // `mapCenter` y no `searchCenter`: es donde el usuario esta MIRANDO,
            // asi que la preferencia lo sigue al panear. Si se muda a Europa, el
            // buscador se muda con el.
            placeSearchNear={{ lat: mapCenter[0], lng: mapCenter[1] }}
            onPlaceFound={(lat, lng) => {
              // Mueve el centro de BUSQUEDA, que es la unica fuente de verdad
              // sobre donde se busca. El texto navega; el centro + radio siguen
              // siendo lo que decide los resultados.
              setSearchCenter([lat, lng]);
              setMapCenter([lat, lng]);
            }}
          />
          <NearbyReportList reports={reports} isLoading={isLoading} isError={isError} />
        </MapPanel>

        {/* Leaflet NECESITA un alto explicito: dentro de un contenedor de alto
            automatico colapsa a cero. Lo hereda del `h-[78vh]` del padre via
            `flex-1`, en los dos anchos. `min-h-0` porque un hijo flex no baja
            de su altura de contenido sin el. */}
        {/* `isolate` (isolation:isolate) NO es decorativo: crea el CONTEXTO DE
            APILAMIENTO que contiene al `z-[1000]` del boton "Buscar en esta
            zona".

            `relative` solo no alcanza — `position:relative` con `z-index:auto`
            no abre contexto nuevo. Sin `isolate`, ese 1000 competia de igual a
            igual con el navbar de MainLayout (`sticky top-0 z-50`) y le ganaba:
            al scrollear, el boton se pintaba ENCIMA del nav. El 1000 hace falta
            igual, porque adentro del mapa tiene que superar los panes de
            Leaflet, que llegan a 800. Lo que faltaba era acotarlo. */}
        <div
          data-testid="map-canvas"
          className="relative isolate flex-1 min-h-0"
        >
            {/* `center` se lee solo al montar; MapViewSync es lo que hace que
                el viewport siga a searchCenter. Ver su comentario. */}
            <MapContainer center={searchCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
              <MapPanTracker onCenterChange={setMapCenter} />
              <MapViewSync center={searchCenter} />
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
                  icon={iconosPorReporte.get(report.id)}
                >
                  <Popup>
                    <ReportPopup report={report} />
                  </Popup>
                </Marker>
              ))}
              {showVets && vets?.map((vet: Vet) => (
                <Marker key={`vet-${vet.id}`} position={[vet.latitude, vet.longitude]} icon={iconoVet}>
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

            {/* El spinner es una CAPA ENCIMA del mapa, no un reemplazo.
                Reemplazarlo desmontaba el MapContainer, y con `applied` en el
                queryKey eso pasa ahora en cada Aplicar con una combinacion sin
                cachear: el mapa volvia a montar en `center={searchCenter}
                zoom={13}` y se comia el zoom y el paneo del usuario. Acercarse
                a una cuadra, tildar "avistamiento" y perder la vista es
                exactamente lo contrario de lo que el filtro promete.

                Ojo: ese remonte era ademas lo que hacia que el viewport
                siguiera al centro POR ACCIDENTE. Sacarlo deja a MapViewSync
                como unico responsable, que es donde tiene que estar.

                `pointer-events-none` para que el mapa se pueda seguir usando
                mientras carga, y `aria-hidden` porque la lista del panel ya
                anuncia "Buscando reportes..." — dos anuncios para el mismo
                hecho es ruido para un lector de pantalla. */}
            {isLoading && (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-[1100] flex items-center justify-center bg-white/60 dark:bg-gray-900/60 pointer-events-none"
              >
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
              </div>
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
      {/* En celular este contador ya lo lleva la barra de peek, siempre visible
          y sin scrollear. Repetirlo abajo del mapa seria decir dos veces lo
          mismo, y ademas en el unico lugar donde hay que bajar para leerlo. */}
      {(!isLoading && reports && reports.length > 0) && (
        <p className="hidden lg:block text-sm text-gray-400 dark:text-gray-500 mt-3 text-center">
          {t('map:reports', { count: reports.length })}
        </p>
      )}
    </div>
  );
}
