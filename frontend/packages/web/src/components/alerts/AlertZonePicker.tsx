import { useEffect, useRef, useState } from 'react';
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
 * Las tres únicas razones por las que esta cámara se mueve sola.
 *
 * Deliberadamente NO se mueve en cada cambio de posición. Un `setView` por cada
 * coordenada nueva centra el pin en cada suelta del arrastre: el mapa salta, el
 * punto nunca puede quedar fuera del centro, y el gesto pelea contra la vista.
 */
function Camera({ latitude, longitude, radiusKm }: CameraProps) {
  const map = useMap();

  // El encuadre inicial es un evento que ocurre UNA vez en la vida del
  // componente, así que se recuerda en un ref y no se deriva del estado.
  //
  // Antes la condición era el booleano `elegido`, y eso era correcto para el
  // mapa pero FALSO para el teclado: `editarCoordenada` pone el estado en
  // `null` cuando el input queda vacío, y un `<input type="number">` reporta
  // `value === ''` para todo estado intermedio inválido —`-`, `-34.`— además
  // del campo borrado. Editar una latitud ya elegida hacía `true→false→true` y
  // reencuadraba en cada recuperación: el mapa saltaba a mitad de tipeo, justo
  // en el camino accesible que este componente existe para proteger. Medido en
  // el navegador; el comentario que había acá afirmaba el invariante contrario.
  // Guarda el radio con el que se encuadró por última vez, y `null` significa
  // "todavía no se encuadró nunca". Ese único valor alcanza para separar los
  // tres casos, que es todo el efecto:
  //
  //   · `null` → es el PRIMER punto: se encuadra.
  //   · un radio distinto → el usuario cambió el radio: se encuadra.
  //   · el mismo radio → o arrastró el pin, o volvió de un hueco de tipeo:
  //     NO se encuadra.
  //
  // Se intentó antes con dos efectos y un booleano "ya encuadré". No sirve:
  // React corre TODOS los efectos en el primer render, así que el segundo veía
  // el booleano que el primero acababa de poner y encuadraba de nuevo —
  // `fitBounds` dos veces sobre el mismo estado. Lo cazó el test, no la lectura.
  const radioEncuadrado = useRef<number | null>(null);

  useEffect(() => {
    if (latitude === null || longitude === null) return;
    if (radioEncuadrado.current === radiusKm) return;
    radioEncuadrado.current = radiusKm;

    // Sin esto, elegir 25 km dibuja una circunferencia más grande que el
    // viewport y el control de radio deja de dar cualquier señal de cuánto
    // abarca sobre el terreno — que es la mitad del motivo de este mapa.
    map.fitBounds(L.latLng(latitude, longitude).toBounds(radiusKm * 2 * 1000));
  }, [map, latitude, longitude, radiusKm]);

  // (3) El punto quedó fuera de pantalla: pasa al tipear una coordenada lejana
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

  // La pista es una INSTRUCCIÓN, y por eso se retira apenas hubo un punto y no
  // vuelve. El marcador puede desaparecer a mitad de tipeo —sin un par completo
  // no hay punto que dibujar, y eso es honesto—, pero "tocá el mapa para elegir
  // la zona" sobre el mapa de alguien que está corrigiendo su zona a mano es
  // una indicación equivocada. Un dato ausente no miente; una instrucción
  // equivocada sí.
  const [huboPunto, setHuboPunto] = useState(false);
  useEffect(() => {
    if (elegido) setHuboPunto(true);
  }, [elegido]);

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

      {!elegido && !huboPunto && (
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
