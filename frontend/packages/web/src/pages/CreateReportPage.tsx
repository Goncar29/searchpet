import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useMyPets, useCreateReport } from '@shared/hooks';
import type { ReportStatus } from '@shared/types';

// Fix leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const MONTEVIDEO: [number, number] = [-34.9011, -56.1645];

interface LatLng {
  lat: number;
  lng: number;
}

function MapClickHandler({ onCoordPicked }: { onCoordPicked: (coord: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onCoordPicked({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

interface FieldErrors {
  petId?: string;
  coord?: string;
}

export function CreateReportPage() {
  const { t } = useTranslation(['reports', 'pets', 'common']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: pets } = useMyPets();
  const createReport = useCreateReport();

  const [petId, setPetId] = useState<string>(searchParams.get('petId') ?? '');
  const [status, setStatus] = useState<ReportStatus>(
    (searchParams.get('status') as ReportStatus) ?? 'lost'
  );
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [coord, setCoord] = useState<LatLng | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!petId) errors.petId = t('common:required');
    if (!coord) errors.coord = t('reports:create.noCoord');
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    if (!validate() || !coord) return;

    createReport.mutate(
      {
        pet_id: petId,
        status,
        latitude: coord.lat,
        longitude: coord.lng,
        location_description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          navigate('/pets/mine');
        },
        onError: (err: Error) => {
          setApiError(err.message);
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
          {t('reports:create.title')}
        </h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Pet select */}
          <div>
            <label
              htmlFor="petId"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('reports:create.pet')} *
            </label>
            <select
              id="petId"
              value={petId}
              onChange={(e) => {
                setPetId(e.target.value);
                if (fieldErrors.petId) setFieldErrors((prev) => ({ ...prev, petId: undefined }));
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">—</option>
              {pets?.map((pet) => (
                <option key={pet.id} value={pet.id}>
                  {pet.name}
                </option>
              ))}
            </select>
            {fieldErrors.petId && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.petId}</p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('reports:create.status')} *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['lost', 'found', 'sighting'] as ReportStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    status === s
                      ? s === 'lost'
                        ? 'bg-red-500 border-red-500 text-white'
                        : s === 'found'
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'bg-yellow-400 border-yellow-400 text-white'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {t(`pets:card.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Map */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('reports:create.clickMap')}
            </p>
            <div
              className="rounded-xl overflow-hidden border border-gray-300 dark:border-gray-600"
              style={{ height: '320px' }}
            >
              <MapContainer center={MONTEVIDEO} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onCoordPicked={setCoord} />
                {coord && <Marker position={[coord.lat, coord.lng]} />}
              </MapContainer>
            </div>
            {fieldErrors.coord && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.coord}</p>
            )}
            {coord && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('reports:create.description')}
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* Date */}
          <div>
            <label
              htmlFor="date"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('reports:create.date')}
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* API Error */}
          {apiError && (
            <p className="text-red-500 text-sm">{apiError}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={createReport.isPending}
            className="w-full bg-primary hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 transition-colors"
          >
            {createReport.isPending ? t('common:loading') : t('reports:create.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
