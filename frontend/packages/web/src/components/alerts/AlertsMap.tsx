import { useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LocationAlert } from '@shared/types';

/** La ubicación por defecto de la app (regla #10), sólo como punto de partida. */
const MONTEVIDEO: [number, number] = [-34.9011, -56.1645];

const ACTIVA = '#C24E1A';
const PAUSADA = '#6B7280';

/** El cuadrado que cubre la zona de una alerta, en las unidades de Leaflet. */
function zonaDe(alert: LocationAlert): L.LatLngBounds {
  return L.latLng(alert.alert_latitude, alert.alert_longitude).toBounds(alert.radius_km * 2 * 1000);
}

interface CameraProps {
  alerts: LocationAlert[];
  focused: string | null;
}

function Camera({ alerts, focused }: CameraProps) {
  const map = useMap();

  // La alerta enfocada manda; si no hay ninguna, se encuadra el conjunto.
  //
  // El efecto depende de los IDs y no del array: `alerts` es una referencia
  // nueva en cada render de la página, así que con `[alerts]` el mapa se
  // reencuadraría en cada tecleo del formulario de arriba.
  const ids = alerts.map((a) => a.id).join(',');

  useEffect(() => {
    if (alerts.length === 0) return;

    const objetivo = focused ? alerts.find((a) => a.id === focused) : undefined;
    if (objetivo) {
      map.fitBounds(zonaDe(objetivo));
      return;
    }

    // Encuadra TODAS. Con el `fitBounds` de la primera sola, las demás quedan
    // fuera de pantalla y el mapa miente sobre cuántas zonas estás vigilando.
    const todas = alerts.reduce<L.LatLngBounds | null>(
      (acc, a) => (acc ? acc.extend(zonaDe(a)) : zonaDe(a)),
      null
    );
    if (todas) map.fitBounds(todas);
    // `alerts` fuera de deps a propósito: lo que identifica al conjunto es
    // `ids`. Ver el bloque de arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ids, focused]);

  return null;
}

export interface AlertsMapProps {
  alerts: LocationAlert[];
  /** Id de la alerta a encuadrar, o `null` para ver el conjunto. */
  focused: string | null;
  /** Cómo nombrar una alerta. Lo traduce la página. */
  labelFor: (alert: LocationAlert) => string;
}

/**
 * Dónde están tus alertas, en un solo mapa.
 *
 * Es UNO y no un mini-mapa por tarjeta: diez tarjetas serían diez juegos de
 * tiles contra la política de uso de OpenStreetMap, para mostrar diez veces la
 * misma ciudad.
 */
export function AlertsMap({ alerts, focused, labelFor }: AlertsMapProps) {
  return (
    <div className="h-72 sm:h-80 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
      <MapContainer center={MONTEVIDEO} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Camera alerts={alerts} focused={focused} />
        {alerts.map((alert) => (
          <Circle
            key={alert.id}
            center={[alert.alert_latitude, alert.alert_longitude]}
            radius={alert.radius_km * 1000}
            // Una pausada NO puede distinguirse de una activa sólo por el color
            // (WCAG 1.4.1): el trazo punteado sobrevive al daltonismo y a una
            // captura en blanco y negro.
            pathOptions={{
              color: alert.is_active ? ACTIVA : PAUSADA,
              fillColor: alert.is_active ? ACTIVA : PAUSADA,
              fillOpacity: alert.is_active ? 0.15 : 0.06,
              weight: 2,
              dashArray: alert.is_active ? undefined : '6 6',
            }}
          >
            <Tooltip>{labelFor(alert)}</Tooltip>
          </Circle>
        ))}
      </MapContainer>
    </div>
  );
}
