import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { usePetByID, useMyPets, useCreateReport } from '@shared/hooks';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { SharePanel } from '../components/SharePanel';
import type { Pet, ReportStatus } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { canManagePet } from '@shared/utils/petAuthorization';
import { useAuth } from '../context/AuthContext';

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
  date?: string;
}

export function CreateReportPage() {
  const { t } = useTranslation(['reports', 'pets', 'common', 'publish']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const presetPetId = searchParams.get('petId') ?? '';

  // Si viene petId en la URL → mascota bloqueada (ajena o propia desde card)
  // Si no → el usuario elige entre SUS mascotas
  const { data: presetPet, isLoading: presetLoading } = usePetByID(presetPetId);
  const { data: myPets } = useMyPets();

  const createReport = useCreateReport();

  const [petId, setPetId] = useState<string>(presetPetId);
  const [status, setStatus] = useState<ReportStatus>(
    (searchParams.get('status') as ReportStatus) ?? 'lost'
  );
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [coord, setCoord] = useState<LatLng | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [publishedPet, setPublishedPet] = useState<Pet | null>(null);

  // `lost` y `found` mueven el estado de la mascota, y eso lo decide su dueño
  // (o quien reportó la callejera). El backend lo rechaza con 403; acá se
  // esconden las opciones para no dejar que alguien llene el formulario entero
  // y recién ahí se entere. A un tercero le queda el avistamiento, que es como
  // aporta al seguimiento — después se coordina por el chat o WhatsApp.
  const petElegida = presetPet ?? myPets?.find((p) => p.id === petId) ?? null;
  const puedeCambiarEstado = canManagePet(petElegida, user?.id);

  // Hay un petId pero no se pudo resolver la mascota, y ya terminó de cargar.
  // Es distinto de "no tenés permiso" y `validate` lo trata aparte.
  const petIdSinResolver = !!petId && !petElegida && !presetLoading;

  // Mientras no haya mascota elegida todavía no hay nada que restringir, así
  // que se muestran las tres. Colapsar a una sola y expandir después de elegir
  // hacía saltar el control y dejaba `lost` marcado sin que nadie lo tocara.
  const opcionesEstado: ReportStatus[] =
    !petElegida || puedeCambiarEstado ? ['lost', 'found', 'sighting'] : ['sighting'];

  // Si el usuario no puede cambiar el estado, lo que viaja es `sighting`, aunque
  // la URL pidiera otra cosa.
  //
  // Se DERIVA en vez de escribirse con un efecto, y no es un detalle de estilo:
  // con un `useEffect` que pisaba `status`, el primer render ocurre con la
  // mascota todavía sin cargar, o sea `puedeCambiarEstado === false`, y el
  // efecto reescribía `status` a 'sighting'. Cuando la mascota cargaba y
  // resultaba ser del usuario, nada lo devolvía: la DUEÑA entrando en frío a
  // ?status=lost terminaba publicando un avistamiento. Verificado en el
  // navegador con caché fría — con caché caliente no se reproduce, que es por
  // qué es fácil que pase desapercibido.
  //
  // Derivado no puede desincronizarse: vale en todos los renders, cargue cuando
  // cargue.
  const statusEfectivo: ReportStatus = puedeCambiarEstado ? status : 'sighting';

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!petId) errors.petId = t('common:required');
    // "No tenés permiso" y "no pude cargar la mascota" son lo MISMO para
    // canManagePet: los dos dan false. Pero significan cosas opuestas, y
    // colapsarlos silenciosamente es peor que fallar.
    //
    // Sin esto: el dueño abre ?status=lost, `GET /api/pets/:id` falla —un
    // arranque en frío de Render devolviendo 502 alcanza—, `statusEfectivo` cae
    // a `sighting`, el backend contesta 201 y lo mandamos a /pets/mine como si
    // hubiera salido bien. La búsqueda nunca se abrió y nadie se lo dijo.
    //
    // Con la mascota sin resolver no se reescribe el pedido: se corta y se
    // avisa. Se chequea `!presetLoading` para no bloquear mientras carga.
    else if (petIdSinResolver) errors.petId = t('pets:detail.notFound');
    if (!coord) errors.coord = t('reports:create.noCoord');
    if (date && new Date(date) > new Date()) errors.date = t('reports:create.noFutureDate');
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
        status: statusEfectivo,
        latitude: coord.lat,
        longitude: coord.lng,
        location_description: description.trim() || undefined,
        occurred_at: date ? `${date}T00:00:00Z` : undefined,
      },
      {
        onSuccess: () => {
          // Un reporte `lost` no es sólo un reporte: deja la mascota en
          // búsqueda activa, y lo que hace que la búsqueda sirva es que el
          // aviso circule. Antes este formulario mandaba derecho a
          // /pets/mine, así que quien publicaba su mascota como perdida se
          // quedaba sin el link para compartir — que es el producto entero de
          // publicar. Los otros dos estados (`found`, `sighting`) no abren
          // ninguna búsqueda, así que siguen yendo al listado como antes.
          const pet = presetPet ?? myPets?.find((p) => p.id === petId);
          if (statusEfectivo === 'lost' && pet) {
            setPublishedPet(pet);
            return;
          }
          navigate('/pets/mine');
        },
        onError: (err) => {
          setApiError(getErrorMessage(err, t));
        },
      }
    );
  };

  if (publishedPet) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
              {t('publish:success.lostTitle')}
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t('publish:success.lostDescription')}
            </p>
          </div>

          <SharePanel petId={publishedPet.id} petName={publishedPet.name} pet={publishedPet} />

          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to={`/pets/${publishedPet.id}`}
              className="inline-flex items-center justify-center px-6 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg transition-colors"
            >
              {t('publish:success.viewPet')}
            </Link>
            <Link
              to="/pets/mine"
              className="inline-flex items-center justify-center px-6 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {t('pets:mine.title')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
          {t('reports:create.title')}
        </h1>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Pet selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('reports:create.pet')} *
            </label>

            {presetPetId ? (
              /* Flujo desde card o detalle: mascota bloqueada, no editable */
              presetLoading ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
              ) : presetPet ? (
                <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 dark:bg-primary/10 px-4 py-3">
                  <PawPlaceholder className="w-6" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{presetPet.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{presetPet.type}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-red-500">{t('pets:detail.notFound')}</p>
              )
            ) : (
              /* Flujo directo: el usuario elige entre SUS mascotas */
              <select
                value={petId}
                aria-label={t('reports:create.selectPet')}
                onChange={(e) => {
                  setPetId(e.target.value);
                  if (fieldErrors.petId) setFieldErrors((prev) => ({ ...prev, petId: undefined }));
                }}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— {t('reports:create.selectPet')} —</option>
                {myPets?.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {pet.name} ({pet.type}{pet.breed ? ` · ${pet.breed}` : ''})
                  </option>
                ))}
              </select>
            )}

            {fieldErrors.petId && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.petId}</p>
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('reports:create.status')} *
            </label>
            <div className={`grid gap-2 ${opcionesEstado.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {opcionesEstado.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    statusEfectivo === s
                      ? s === 'lost'
                        ? 'bg-red-600 border-red-600 text-white'
                        : s === 'found'
                        ? 'bg-green-700 border-green-700 text-white'
                        : 'bg-amber-700 border-amber-700 text-white'
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
              max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]}
              onChange={(e) => {
                setDate(e.target.value);
                if (fieldErrors.date) setFieldErrors(prev => ({ ...prev, date: undefined }));
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.date && (
              <p className="text-red-500 dark:text-red-400 text-sm mt-1">{fieldErrors.date}</p>
            )}
          </div>

          {apiError && (
            <p className="text-red-500 text-sm">{apiError}</p>
          )}

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
