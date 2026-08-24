import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { usePetByID, useMyPets, useCreateReport } from '@shared/hooks';
import { PawPlaceholder } from '../components/PawPlaceholder';
import { SharePanel } from '../components/SharePanel';
import { FormPage } from '../components/form/FormPage';
import { FormSection } from '../components/form/FormSection';
import { FormField } from '../components/form/FormField';
import { FormActions, formSubmitClass } from '../components/form/FormActions';
import type { ReportStatus } from '@shared/types';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { canManagePet } from '@shared/utils/petAuthorization';
import { useAuth } from '../context/AuthContext';
import { calendarDayToISO, isFutureCalendarDay } from '@shared/utils/reportDate';

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
  const [searchParams, setSearchParams] = useSearchParams();

  const presetPetId = searchParams.get('petId') ?? '';

  // "Ya reportaste" vive en la URL y NO en useState. Con useState moría en el
  // REMONTE, y esa es exactamente la forma del bug: publicabas, tocabas "Ver
  // mascota" desde la pantalla de éxito y volvías con el botón atrás — el
  // componente se remontaba con el estado en null y te devolvía el FORMULARIO
  // LIMPIO en la MISMA URL, porque la URL no distinguía "vení a reportar" de
  // "ya reportaste". Confirmarlo otra vez creaba un SEGUNDO reporte, y la
  // mascota quedaba con doble historial. Reproducido en el navegador: 2 POST
  // /api/reports, 2 entradas en el timeline.
  //
  // Es la regla #52 aplicada a esta pantalla. El paso del wizard se movió a la
  // URL en el #136 por este mismo motivo; este formulario nunca lo recibió.
  const publicado = searchParams.get('publicado');

  // Si viene petId en la URL → mascota bloqueada (ajena o propia desde card)
  // Si no → el usuario elige entre SUS mascotas
  const { data: presetPet, isLoading: presetLoading } = usePetByID(presetPetId);
  // `isLoading` de las DOS consultas, no sólo de una: `petElegida` sale de
  // `presetPet ?? myPets.find(...)`, así que mirar sólo `presetLoading` para
  // decidir "cargando o no encontrada" es mirar la mitad de sus fuentes.
  const { data: myPets, isLoading: myPetsLoading } = useMyPets();

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
    // `new Date(date) > new Date()` comparaba el string como UTC contra el
    // instante actual: el mismo error de zona que corría la fecha un día.
    if (date && isFutureCalendarDay(date)) errors.date = t('reports:create.noFutureDate');
    // Una fecha que no parsea daba undefined y se descartaba en SILENCIO: el
    // reporte se guardaba sin fecha, sin error y sin avisar nada.
    else if (date && !calendarDayToISO(date)) errors.date = t('publish:location.dateInvalid');
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
        occurred_at: calendarDayToISO(date),
      },
      {
        onSuccess: (report) => {
          // Un reporte `lost` no es sólo un reporte: deja la mascota en
          // búsqueda activa, y lo que hace que la búsqueda sirva es que el
          // aviso circule. Antes este formulario mandaba derecho a
          // /pets/mine, así que quien publicaba su mascota como perdida se
          // quedaba sin el link para compartir — que es el producto entero de
          // publicar. Los otros dos estados (`found`, `sighting`) no abren
          // ninguna búsqueda, así que siguen yendo al listado como antes.
          //
          // `replace: true` es la mitad del arreglo, y no es cosmético: la
          // entrada del formulario se REEMPLAZA, así que después de publicar no
          // queda ninguna entrada de history que devuelva a un formulario vivo.
          // El petId viaja en la URL porque el flujo directo lo tenía sólo en
          // estado local, y sin él la pantalla de éxito no se puede reconstruir
          // tras un remonte.
          if (statusEfectivo === 'lost') {
            setSearchParams(
              { petId, status: statusEfectivo, publicado: report.id },
              { replace: true }
            );
            return;
          }
          // Mismo motivo que arriba: sin `replace`, el atrás desde /pets/mine
          // devuelve este formulario y deja re-enviarlo.
          navigate('/pets/mine', { replace: true });
        },
        onError: (err) => {
          setApiError(getErrorMessage(err, t));
        },
      }
    );
  };

  // Con `publicado` en la URL el formulario queda INALCANZABLE, pase lo que
  // pase con la carga de la mascota. Caer al formulario ante un fallo sería
  // reabrir el mismo agujero por otra puerta: dejaría un formulario vivo y
  // re-enviable en la URL de un reporte que ya existe.
  //
  // Pero `publicado` viene de la URL, así que por sí solo no prueba NADA: mover
  // el estado de éxito de useState a la barra de direcciones lo convirtió en
  // entrada de usuario. Sin este permiso, `/reports/create?petId=<ajena>&
  // publicado=x` le afirmaba a cualquiera "tu mascota está marcada como
  // perdida" sobre una mascota que no es suya —y `GET /api/pets/:id` es
  // público, así que resuelve cualquier id—. Esta pantalla existe para copiar
  // links: alguien que copia la barra de direcciones en vez del link del panel
  // manda justo esa URL.
  //
  // Se reusa `canManagePet`, que ya es la fuente única de esta regla en el
  // resto del proyecto (dueño, o quien reportó la callejera).
  //
  // Se evaluó exigir ADEMÁS `status === 'lost'` y se dejó afuera. Sospeché que
  // metería un parpadeo de "mascota no encontrada" sobre el camino feliz,
  // porque tras publicar el refetch todavía viaja con la mascota en
  // `registered` — y lo medí en el navegador con las dos consultas lentas y
  // sirviendo el dato viejo: ESE PARPADEO NO OCURRE. El motivo real de dejarlo
  // afuera es otro: `canManagePet` ya cierra el caso que importa (una mascota
  // ajena), y un status exacto rebotaría a quien publica sobre su propia
  // callejera, que llega acá en `stray`. Lo único que cerraría de más es un
  // favorito viejo de tu PROPIA mascota ya encontrada — una imprecisión sobre
  // algo tuyo, no una afirmación sobre la mascota de otro.
  if (publicado) {
    if (!petElegida || !puedeCambiarEstado) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10 px-4">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            {!petElegida && (presetLoading || myPetsLoading) ? (
              <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
            ) : (
              <>
                <p className="text-gray-700 dark:text-gray-300">{t('pets:detail.notFound')}</p>
                <Link
                  to="/pets/mine"
                  className="inline-flex items-center justify-center px-6 py-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg transition-colors"
                >
                  {t('pets:mine.title')}
                </Link>
              </>
            )}
          </div>
        </div>
      );
    }

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

          <SharePanel petId={petElegida.id} petName={petElegida.name} pet={petElegida} inline />

          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to={`/pets/${petElegida.id}`}
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
    <FormPage title={t('reports:create.title')}>
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <FormSection title={t('reports:create.sectionWhat')}>
          <div className="space-y-6">
            {presetPetId ? (
              // Mascota BLOQUEADA (se llegó desde una card o el detalle). No es
              // un control, así que no va en FormField: un `htmlFor` apuntando a
              // un input que no existe deja un label huérfano, que es justo lo
              // que la auditoría de accesibilidad del #180 marca como defecto.
              // Lleva su propia fila de etiqueta, con el asterisco fuera del
              // texto y aria-hidden, igual que FormField.
              <div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {t('reports:create.pet')}
                  </span>
                  <span aria-hidden="true" className="text-danger">*</span>
                </div>
                {presetLoading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
                ) : presetPet ? (
                  <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 dark:bg-primary/10 px-4 py-3">
                    <PawPlaceholder className="w-6" />
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{presetPet.name}</p>
                      {/* El valor crudo (`perro`, `gato`) es el que guarda la base:
                          sin traducir se leía en minúscula y en español aunque la
                          app estuviera en inglés o portugués. Mismo patrón que
                          LostPetStep.tsx:94. */}
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t(`pets:types.${presetPet.type}`)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-danger text-sm">{t('pets:detail.notFound')}</p>
                )}
                {fieldErrors.petId && (
                  <p role="alert" className="text-danger text-sm mt-2">{fieldErrors.petId}</p>
                )}
              </div>
            ) : (
              /* Flujo directo: el usuario elige entre SUS mascotas */
              <FormField
                label={t('reports:create.pet')}
                htmlFor="report-pet"
                required
                error={fieldErrors.petId}
              >
                {(control) => (
                  // Sin `aria-label`: acá el <label> del FormField ya nombra al
                  // control, y un aria-label lo PISA — el nombre accesible
                  // pasaba a ser el placeholder del selector en vez de "Mascota".
                  <select
                    {...control}
                    value={petId}
                    onChange={(e) => {
                      setPetId(e.target.value);
                      if (fieldErrors.petId) setFieldErrors((prev) => ({ ...prev, petId: undefined }));
                    }}
                  >
                    <option value="">— {t('reports:create.selectPet')} —</option>
                    {myPets?.map((pet) => (
                      <option key={pet.id} value={pet.id}>
                        {/* Mismo motivo que la rama de arriba: el tipo se guarda
                            crudo y sin traducir se leía `perro` aun con la app en
                            inglés o portugués. Esta rama es el flujo DIRECTO
                            (/reports/create sin ?petId=), así que era la más vista
                            de las dos. */}
                        {pet.name} ({t(`pets:types.${pet.type}`)}{pet.breed ? ` · ${pet.breed}` : ''})
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}

            {/* El estado son tres BOTONES, no un input, así que tampoco va en
                FormField. `role="group"` + `aria-labelledby` es lo que le da un
                nombre accesible al conjunto; el <label> sin `for` que había acá
                no etiquetaba nada. */}
            <div>
              <div className="flex items-baseline gap-1 mb-2">
                <span id="report-status-label" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {t('reports:create.status')}
                </span>
                <span aria-hidden="true" className="text-danger">*</span>
              </div>
              <div
                role="group"
                aria-labelledby="report-status-label"
                className={`grid gap-2 ${opcionesEstado.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}
              >
                {opcionesEstado.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    // `aria-pressed` porque son botones de alternancia: sin él,
                    // cuál está elegido viaja SÓLO en el color, que un lector de
                    // pantalla no anuncia.
                    aria-pressed={statusEfectivo === s}
                    className={`py-3 rounded-xl text-sm font-semibold border transition-colors ${
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
          </div>
        </FormSection>

        {/* El MapContainer queda EXACTAMENTE como estaba: sólo cambia la card
            que lo enmarca. Mismo criterio que LocationStep en el #180 — este
            cambio es de presentación, y el mapa es lo único de esta pantalla que
            no lo es. */}
        <FormSection title={t('reports:create.sectionPlace')}>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
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
            <p role="alert" className="text-danger text-sm mt-2">{fieldErrors.coord}</p>
          )}
          {coord && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
            </p>
          )}
        </FormSection>

        <FormSection title={t('reports:create.sectionDetails')}>
          <div className="space-y-6">
            <FormField label={t('reports:create.description')} htmlFor="description">
              {(control) => (
                <textarea
                  {...control}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={`${control.className} resize-none`}
                />
              )}
            </FormField>

            <FormField label={t('reports:create.date')} htmlFor="date" error={fieldErrors.date}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  value={date}
                  max={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]}
                  onChange={(e) => {
                    setDate(e.target.value);
                    if (fieldErrors.date) setFieldErrors((prev) => ({ ...prev, date: undefined }));
                  }}
                />
              )}
            </FormField>
          </div>
        </FormSection>

        {apiError && (
          <p role="alert" className="text-danger text-sm text-center">{apiError}</p>
        )}

        <FormActions
          submit={
            <button type="submit" disabled={createReport.isPending} className={formSubmitClass}>
              {createReport.isPending ? t('common:loading') : t('reports:create.submit')}
            </button>
          }
        />
      </form>
    </FormPage>
  );
}
