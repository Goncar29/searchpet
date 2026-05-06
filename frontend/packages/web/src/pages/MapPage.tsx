import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router';
import L from 'leaflet';
import { useNearbyReports } from '@shared/hooks';
import type { Report } from '@shared/types';

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

export function MapPage() {
  const [userLocation, setUserLocation] = useState<[number, number]>([-34.9011, -56.1645]);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      () => console.log('Location denied, using default')
    );
  }, []);

  const { data: reports, isLoading } = useNearbyReports(userLocation[0], userLocation[1], 20, true);

  const getIcon = (status: string) => {
    switch (status) {
      case 'lost': return lostIcon;
      case 'found': return foundIcon;
      case 'sighting': return sightingIcon;
      default: return lostIcon;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'lost': return 'Perdido';
      case 'found': return 'Encontrado';
      case 'sighting': return 'Avistado';
      default: return status;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Mapa de reportes</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-lost inline-block"></span> Perdido
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-found inline-block"></span> Encontrado
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-sighting inline-block"></span> Avistado
          </span>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-lg overflow-hidden" style={{ height: '70vh' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <MapContainer center={userLocation} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {reports?.map((report: Report) => (
              <Marker
                key={report.id}
                position={[report.latitude, report.longitude]}
                icon={getIcon(report.status)}
              >
                <Popup>
                  <div className="min-w-48">
                    <h3 className="font-bold text-base">{report.pet?.name || 'Mascota'}</h3>
                    <span className={`inline-block text-xs font-bold text-white px-2 py-0.5 rounded mt-1 ${
                      report.status === 'lost' ? 'bg-red-500' :
                      report.status === 'found' ? 'bg-green-500' : 'bg-yellow-500'
                    }`}>
                      {getStatusLabel(report.status)}
                    </span>
                    {report.location_description && (
                      <p className="text-sm text-gray-600 mt-2">{report.location_description}</p>
                    )}
                    <Link
                      to={`/pets/${report.pet?.id || report.pet_id}`}
                      className="inline-block mt-2 text-sm text-primary font-semibold hover:underline"
                    >
                      Ver detalles →
                    </Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      <p className="text-sm text-gray-400 mt-3 text-center">
        {reports?.length || 0} reportes en la zona
      </p>
    </div>
  );
}
