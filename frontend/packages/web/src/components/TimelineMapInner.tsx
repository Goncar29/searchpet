import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

interface ValidReport {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  label: string | undefined;
  date: string;
}

interface TimelineMapInnerProps {
  reports: ValidReport[];
}

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

function getIcon(status: string) {
  switch (status) {
    case 'found': return foundIcon;
    case 'sighting': return sightingIcon;
    default: return lostIcon;
  }
}

function FitBounds({ reports }: { reports: ValidReport[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || reports.length === 0) return;
    fitted.current = true;

    const bounds = L.latLngBounds(reports.map((r) => [r.latitude, r.longitude]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, reports]);

  return null;
}

const chronological = (reports: ValidReport[]) =>
  [...reports].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

export default function TimelineMapInner({ reports }: TimelineMapInnerProps) {
  const sorted = chronological(reports);
  const center: [number, number] = [sorted[0].latitude, sorted[0].longitude];
  const polylinePositions: [number, number][] = sorted.map((r) => [r.latitude, r.longitude]);

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height: '260px', width: '100%' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBounds reports={sorted} />
      {sorted.map((r) => (
        <Marker key={r.id} position={[r.latitude, r.longitude]} icon={getIcon(r.status)}>
          <Popup>
            <span className="text-sm font-semibold">
              {r.status === 'lost' ? 'Perdido' : r.status === 'found' ? 'Encontrado' : 'Avistado'}
            </span>
            {r.label && <><br />{r.label}</>}
            <br />
            <span className="text-xs text-gray-500">
              {new Date(r.date).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </Popup>
        </Marker>
      ))}
      {sorted.length >= 2 && (
        <Polyline positions={polylinePositions} color="#6366f1" weight={2} />
      )}
    </MapContainer>
  );
}
