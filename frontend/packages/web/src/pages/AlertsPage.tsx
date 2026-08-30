import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAlerts,
  useCreateAlert,
  useUpdateAlert,
  useDeleteAlert,
} from '@shared/hooks';
import type { LocationAlert } from '@shared/types';
import type { PetType } from '@shared/types';
import { ListState } from '../components/list/ListState';
import { FormSection } from '../components/form/FormSection';
import { FormField, controlClass } from '../components/form/FormField';
import { FormChoiceGroup } from '../components/form/FormChoiceGroup';
import { FormActions, formSubmitClass, formCancelClass } from '../components/form/FormActions';

const PET_TYPES: PetType[] = ['perro', 'gato', 'pajaro', 'otro'];

// Los valores del radio son strings porque `FormChoiceGroup` trabaja sobre
// `T extends string` — es lo que el `value` de un `<input type="radio">` nativo
// lleva de todas formas. Se convierten a número una sola vez, al enviar.
const RADIUS_OPTIONS = ['1', '2', '5', '10', '25'] as const;
type RadiusKm = (typeof RADIUS_OPTIONS)[number];

const MAX_ALERTS = 10;

/** Un único nodo de error para el par de coordenadas, referenciado por los dos controles. */
const COORD_ERROR_ID = 'alert-coords-error';

export function AlertsPage() {
  // Los dos namespaces se declaran explícitos en vez de confiar en que el
  // prefijo `pets:` resuelva por recursos precargados: si algún día no
  // resolviera, el modo de falla es una clave cruda en pantalla que ningún test
  // ve, porque en los tests `t` está mockeado.
  const { t } = useTranslation(['alerts', 'pets']);
  const alertsQuery = useAlerts();
  const createAlert = useCreateAlert();
  const updateAlert = useUpdateAlert();
  const deleteAlert = useDeleteAlert();

  // `undefined` cuando no hay respuesta, y cada consumidor decide qué hacer con
  // esa ignorancia por separado — los dos viven FUERA de la rama que envuelve
  // `ListState`, así que el port no los alcanza solo:
  //
  //   · el título NO afirma un número que no sabe. Con `?? 0` decía
  //     "Mis alertas (0/10)" al lado del cartel que dice que no pudimos leer
  //     nada: la misma mentira que toda esta primitiva viene a matar.
  //   · el botón falla ABIERTO (`?? 0`), que es el comportamiento de hoy: el
  //     tope real lo aplica el backend, así que bloquear por las dudas le
  //     sacaría al usuario una acción válida por un fallo nuestro.
  const alertCount = alertsQuery.data?.length;

  // ── Form state ──────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [radiusKm, setRadiusKm] = useState<RadiusKm>('5');
  const [petType, setPetType] = useState('');
  const [formLat, setFormLat] = useState<number | null>(null);
  const [formLng, setFormLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [coordError, setCoordError] = useState('');

  // Pre-fill coordinates from browser geolocation on mount
  useEffect(() => {
    if (navigator.geolocation) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormLat(pos.coords.latitude);
          setFormLng(pos.coords.longitude);
          setLocating(false);
        },
        () => {
          setLocating(false);
        }
      );
    }
  }, []);

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormLat(pos.coords.latitude);
        setFormLng(pos.coords.longitude);
        setLocating(false);
        setCoordError('');
      },
      () => {
        setLocating(false);
      }
    );
  };

  const resetForm = () => {
    setName('');
    setRadiusKm('5');
    setPetType('');
    setCoordError('');
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formLat === null || formLng === null) {
      setCoordError(t('coordError'));
      return;
    }
    setCoordError('');
    await createAlert.mutateAsync({
      latitude: formLat,
      longitude: formLng,
      radius_km: Number(radiusKm),
      name: name.trim() || undefined,
      pet_type: petType || undefined,
    });
    resetForm();
  };

  const handleToggle = (alert: LocationAlert) => {
    updateAlert.mutate({ id: alert.id, data: { is_active: !alert.is_active } });
  };

  const handleDelete = (alert: LocationAlert) => {
    const label = alert.name ?? t('thisAlert');
    if (window.confirm(t('confirmDelete', { name: label }))) {
      deleteAlert.mutate(alert.id);
    }
  };

  // El error de coordenadas se cuelga de CADA input y no del `<fieldset>`: un
  // `aria-describedby` en el contenedor no se anuncia cuando el foco entra al
  // control, así que el usuario oiría el `role="alert"` una vez, tabularía para
  // corregir y no recibiría nada. Es la misma regla que documenta
  // `FormChoiceGroup`, y por eso el mensaje sigue siendo UN solo nodo.
  const coordInvalid = coordError
    ? { 'aria-invalid': true as const, 'aria-describedby': COORD_ERROR_ID }
    : {};

  // Editar una coordenada retira el error, y no es cosmético: el mensaje dice
  // "ingresá las coordenadas", así que dejarlo puesto mientras el usuario las
  // ingresa deja a los dos campos anunciándose "inválido" con un motivo que su
  // propio contenido desmiente. La revalidación sigue siendo en el submit —
  // es lo que hacen `RegisterPage`, `LoginPage`, `EditPetPage` y
  // `CreateReportPage`.
  const editarCoordenada = (setter: (v: number | null) => void) => (valor: string) => {
    setter(valor ? Number(valor) : null);
    if (coordError) setCoordError('');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {alertCount !== undefined
            ? t('title', { count: alertCount, max: MAX_ALERTS })
            : t('titleNoCount')}
        </h1>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            disabled={(alertCount ?? 0) >= MAX_ALERTS}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('newAlert')}
          </button>
        )}
      </div>

      {/* Create form.
          No usa `FormPage`: el frame lo pone esta página, que es una pantalla de
          LISTA con un formulario plegable adentro, no una pantalla-formulario.
          Mismo criterio que los pasos del wizard en el #180. */}
      {showForm && (
        <form onSubmit={handleSubmit} noValidate className="space-y-6 mb-6">
          <FormSection title={t('formTitle')}>
            <div className="space-y-6">
              <FormField label={t('nameLabel')} htmlFor="alert-name" hint={t('optionalHint')}>
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder={t('namePlaceholder')}
                  />
                )}
              </FormField>

              {/* `<fieldset>` + `<legend>` y no un `<label>` suelto: "Coordenadas"
                  agrupa dos controles, así que no puede etiquetar a ninguno con
                  `htmlFor` sin dejar huérfano al otro. Cada input lleva ahora su
                  propia etiqueta VISIBLE — antes su único nombre era el
                  `aria-label`, con el placeholder haciendo de etiqueta. */}
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {t('coordsLabel')}
                </legend>
                <div className="grid sm:grid-cols-2 gap-6">
                  <FormField label={t('latLabel')} htmlFor="alert-lat">
                    {(control) => (
                      <input
                        {...control}
                        {...coordInvalid}
                        className={controlClass(!!coordError)}
                        type="number"
                        step="any"
                        value={formLat ?? ''}
                        onChange={(e) => editarCoordenada(setFormLat)(e.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label={t('lngLabel')} htmlFor="alert-lng">
                    {(control) => (
                      <input
                        {...control}
                        {...coordInvalid}
                        className={controlClass(!!coordError)}
                        type="number"
                        step="any"
                        value={formLng ?? ''}
                        onChange={(e) => editarCoordenada(setFormLng)(e.target.value)}
                      />
                    )}
                  </FormField>
                </div>
                <button
                  type="button"
                  onClick={handleGeolocate}
                  disabled={locating}
                  className="mt-3 inline-flex items-center justify-center px-4 py-2 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-orange-50 dark:hover:bg-orange-950 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {locating ? t('locating') : t('useMyLocation')}
                </button>
                {coordError && (
                  <p id={COORD_ERROR_ID} role="alert" className="text-danger text-sm mt-2">
                    {coordError}
                  </p>
                )}
              </fieldset>

              {/* Radios nativos y no los botones con `role="radiogroup"` que había
                  acá: ese patrón exige un único tab stop y navegación con flechas,
                  y declararlo sin implementar el teclado promete un comportamiento
                  que no está. Con controles nativos lo pone el navegador. */}
              <FormChoiceGroup
                id="alert-radius"
                legend={t('radiusLabel')}
                type="radio"
                options={RADIUS_OPTIONS.map((r) => ({ value: r, label: `${r} km` }))}
                value={radiusKm}
                onToggle={setRadiusKm}
              />

              <FormField label={t('petTypeLabel')} htmlFor="alert-pet-type">
                {(control) => (
                  <select
                    {...control}
                    value={petType}
                    onChange={(e) => setPetType(e.target.value)}
                  >
                    <option value="">{t('allTypes')}</option>
                    {PET_TYPES.map((pt) => (
                      <option key={pt} value={pt}>
                        {t(`pets:types.${pt}`)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          </FormSection>

          <FormActions
            cancel={
              <button type="button" onClick={resetForm} className={formCancelClass}>
                {t('cancel')}
              </button>
            }
            submit={
              <button type="submit" disabled={createAlert.isPending} className={formSubmitClass}>
                {createAlert.isPending ? t('creating') : t('createButton')}
              </button>
            }
          />
        </form>
      )}

      {/* Los tres bloques hermanos —cargando, vacío y lista— colapsan en uno:
          eran tres condiciones sueltas que había que mantener mutuamente
          excluyentes a mano, y ninguna de las tres cubría el cuarto estado. */}
      <ListState
        query={alertsQuery}
        loading={
          <div className="text-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500 dark:text-gray-400">{t('loading')}</p>
          </div>
        }
        empty={
          // El vacío sigue callado mientras el formulario está abierto:
          // decirle "no tenés alertas, creá la primera" a alguien que la está
          // creando justo ahí es ruido. El cartel de error NO comparte esa
          // lógica y por eso no lleva el gate — que la lista no haya cargado
          // es información nueva, y el usuario la necesita igual.
          !showForm ? (
            <div className="text-center py-16">
              <p className="text-5xl mb-4">🔔</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('emptyTitle')}</p>
              <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm">
                {t('emptyText')}
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors"
              >
                {t('createFirst')}
              </button>
            </div>
          ) : null
        }
      >
        {(alerts: LocationAlert[]) => (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {alert.name ?? t('unnamed')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {alert.alert_latitude.toFixed(3)}, {alert.alert_longitude.toFixed(3)}
                  {' · '}{alert.radius_km} km
                  {alert.pet_type ? ` · ${t(`pets:types.${alert.pet_type}`)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alert.is_active}
                    onChange={() => handleToggle(alert)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {alert.is_active ? t('active') : t('inactive')}
                  </span>
                </label>
                <button
                  onClick={() => handleDelete(alert)}
                  className="text-xs font-medium text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
        )}
      </ListState>
    </div>
  );
}
