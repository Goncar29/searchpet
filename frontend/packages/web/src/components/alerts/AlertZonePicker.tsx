import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

/** La misma ubicación por defecto que usa el resto de la app (regla #10). */
const MONTEVIDEO: [number, number] = [-34.9011, -56.1645];

// El mismo pin que `components/publish/LocationStep.tsx`. Los dos orígenes ya
// están en el `img-src` de la CSP (`vercel.json`), así que reusarlo no agrega
// ninguno nuevo — ver regla #23.
//
// Está duplicado a propósito y no hoisteado: sacarlo a un módulo compartido
// obliga a tocar el paso del wizard, que tiene su propia suite y no es lo que
// este cambio viene a hacer. Si aparece un tercer consumidor, ahí sí se extrae.
const pinIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

interface CameraProps {
  latitude: number | null;
  longitude: number | null;
  radiusKm: number;
}

/**
 * Las dos únicas razones por las que esta cámara se mueve sola.
 *
 * Deliberadamente NO se mueve en cada cambio de posición. Un `setView` por cada
 * coordenada nueva centra el pin en cada suelta del arrastre: el mapa salta, el
 * punto nunca puede quedar fuera del centro, y el gesto pelea contra la vista.
 */
function Camera({ latitude, longitude, radiusKm }: CameraProps) {
  const map = useMap();

  // (1) Cambió el radio: se encuadra el círculo entero. Sin esto, elegir 25 km
  // dibuja una circunferencia más grande que el viewport y el control de radio
  // deja de dar cualquier señal de cuánto abarca sobre el terreno — que es la
  // mitad del motivo por el que este mapa existe.
  useEffect(() => {
    if (latitude === null || longitude === null) return;
    map.fitBounds(L.latLng(latitude, longitude).toBounds(radiusKm * 2 * 1000));
    // `latitude`/`longitude` quedan fuera a propósito: este efecto es la
    // reacción al RADIO. Incluirlas lo convertiría en el `setView` por posición
    // que el bloque de arriba explica por qué no va.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, radiusKm]);

  // (2) El punto quedó fuera de pantalla: pasa al tipear una coordenada lejana
  // en los inputs, y sin esto el usuario escribe y el mapa se queda mostrando
  // otra ciudad. Arrastrar o tocar cae siempre DENTRO de la vista, así que esos
  // dos gestos no la mueven.
  useEffect(() => {
    if (latitude === null || longitude === null) return;
    if (!map.getBounds().contains([latitude, longitude])) {
      map.setView([latitude, longitude]);
    }
  }, [map, latitude, longitude]);

  return null;
}

function ClickToPlace({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export interface AlertZonePickerProps {
  latitude: number | null;
  longitude: number | null;
  /** En kilómetros, como lo guarda el modelo. El círculo lo convierte a metros. */
  radiusKm: number;
  onPick: (latitude: number, longitude: number) => void;
  /** Qué hacer cuando todavía no hay punto elegido. Lo traduce la página. */
  hint: string;
}

/**
 * Elegir la zona de una alerta sobre el mapa: arrastrando el pin o tocando.
 *
 * NO reemplaza a los inputs de latitud y longitud, los acompaña. Un mapa que
 * sólo se arrastra no tiene camino de teclado ni de lector de pantalla; los dos
 * controles escriben el mismo estado y cualquiera de los dos alcanza.
 */
export function AlertZonePicker({
  latitude,
  longitude,
  radiusKm,
  onPick,
  hint,
}: AlertZonePickerProps) {
  const elegido = latitude !== null && longitude !== null;
  // El centro inicial del mapa NO es un punto elegido: es desde dónde mirar.
  // Por eso cuando no hay coordenadas no se dibuja ningún marcador — plantarlo
  // en Montevideo "para que se vea algo" afirmaría una zona que el usuario no
  // eligió, y su alerta terminaría vigilando el centro por defecto.
  const centro: [number, number] = elegido ? [latitude, longitude] : MONTEVIDEO;

  return (
    <div className="relative h-72 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
      <MapContainer center={centro} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPlace onPick={onPick} />
        <Camera latitude={latitude} longitude={longitude} radiusKm={radiusKm} />
        {elegido && (
          <>
            <Circle
              center={[latitude, longitude]}
              radius={radiusKm * 1000}
              pathOptions={{ color: '#C24E1A', fillColor: '#C24E1A', fillOpacity: 0.12, weight: 2 }}
            />
            <Marker
              position={[latitude, longitude]}
              draggable
              icon={pinIcon}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target as L.Marker;
                  const latLng = marker.getLatLng();
                  onPick(latLng.lat, latLng.lng);
                },
              }}
            />
          </>
        )}
      </MapContainer>

      {!elegido && (
        // Sin `aria-hidden`: la pista nombra las DOS vías —tocar el mapa y
        // escribir las coordenadas— así que también le sirve a quien no puede
        // usar la primera. Una pista que sólo dijera "tocá el mapa" sí habría
        // que esconderla, porque mandaría a hacer un gesto no disponible.
        // `pointer-events-none` para no comerse los clicks del mapa.
        <p className="absolute inset-x-3 bottom-3 z-[400] rounded-lg bg-white/95 dark:bg-gray-900/95 px-3 py-2 text-center text-sm text-gray-700 dark:text-gray-300 shadow-sm pointer-events-none">
          {hint}
        </p>
      )}
    </div>
  );
}
