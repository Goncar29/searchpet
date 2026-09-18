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
import { AlertZonePicker } from '../components/alerts/AlertZonePicker';
import { AlertsMap } from '../components/alerts/AlertsMap';
import { redondearCoordenada } from '../components/alerts/coordenadas';
import { Icon } from '../components/Icon';
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

  // Qué zona está mirando el mapa de resumen. `null` = el conjunto entero.
  const [focused, setFocused] = useState<string | null>(null);

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

  // La ÚNICA puerta por la que entra un par de coordenadas completo: la usan el
  // mapa (arrastrar el pin o tocar) y el botón de geolocalización. Tener dos
  // caminos que escriben el mismo estado con reglas distintas es exactamente
  // cómo uno de los dos se olvida de retirar el mensaje de error.
  //
  // Y redondea, porque los dos orígenes traen basura: Leaflet devuelve el
  // click con toda la precisión del `double` y la geolocalización del
  // navegador otro tanto. Ese valor cae crudo en un `<input type="number">`
  // que el usuario tiene que poder leer y corregir — `-34,899025460930744` no
  // se lee ni se tipea. Lo vi en el navegador; ningún test lo miraba.
  const elegirZona = (latitude: number, longitude: number) => {
    setFormLat(redondearCoordenada(latitude));
    setFormLng(redondearCoordenada(longitude));
    setCoordError('');
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        elegirZona(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
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
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      {/* La banda del lenguaje de las públicas (`AdoptPage`, `LeaderboardPage`).
          Esta pantalla no la tenía: arrancaba directo en un `<h1>` de
          `text-2xl font-bold`, sin `font-display`.

          El `<h1>` NO lleva peso explícito, y es a propósito: `--text-display` y
          `--text-display-sm` ya declaran `font-weight: 700` (ver `index.css`),
          así que acá agregarlo sería ruido. Es lo contrario del caso del panel
          admin, donde `text-xl` no trae peso y sin `font-semibold` el título se
          caía a 400 — la regresión del #161. La regla no es "poné siempre el
          peso": es "asegurate de que ALGUIEN lo declare". */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          {/* El conteo se queda DENTRO del `<h1>`, y eso no es inercia: dos
              tests lo afirman, incluido que con la query caída el título NO
              afirme un conteo. Un "Mis alertas (0/5)" cuando la lectura falló
              es la misma mentira que una lista vacía sobre un error. */}
          <h1 className="font-display text-display-sm md:text-display mb-3">
            {alertCount !== undefined
              ? t('title', { count: alertCount, max: MAX_ALERTS })
              : t('titleNoCount')}
          </h1>
          <p className="text-lg text-white max-w-2xl mx-auto">{t('subtitle')}</p>
        </div>
      </section>

      {/* `max-w-7xl` como el navbar (la convención aprobada el 2026-08-05); la
          columna interna se queda angosta porque acá adentro hay un FORMULARIO,
          y un campo de 1216px no se llena cómodo. Lo que la regla corrige es que
          la PÁGINA fuera ~450px más angosta que su propia barra, no que el
          contenido tenga que estirarse hasta el borde. */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-3xl mx-auto">
          {/* El botón sale del encabezado: en la banda no entra —las hermanas no
              ponen acciones ahí— y acá queda pegado a la lista sobre la que
              actúa. */}
          {!showForm && (
            <div className="flex justify-end mb-6">
              <button
                onClick={() => setShowForm(true)}
                disabled={(alertCount ?? 0) >= MAX_ALERTS}
                className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('newAlert')}
              </button>
            </div>
          )}

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

                {/* El mapa es la vía VISUAL de elegir la zona; los dos inputs de
                    abajo son la vía accesible, y siguen siendo los que llevan
                    etiqueta, `aria-invalid` y el mensaje de error. Los dos
                    escriben el mismo estado, así que cualquiera alcanza para
                    crear la alerta.

                    El círculo dibuja el radio elegido: antes ese control iba de
                    1 a 25 sin ninguna referencia de cuánto era eso en la calle. */}
                <div className="mb-4">
                  <AlertZonePicker
                    latitude={formLat}
                    longitude={formLng}
                    radiusKm={Number(radiusKm)}
                    onPick={elegirZona}
                    hint={t('mapHint')}
                  />
                </div>

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
              {/* Decorativo: el texto de abajo ya dice todo. Sin `aria-hidden`
                  un lector de pantalla anuncia "campana" antes del mensaje.
                  Se queda como emoji porque el set de `Icon` no tiene campana,
                  y mapearlo a `campaign` (un megáfono) diría otra cosa. */}
              <p className="text-5xl mb-4" aria-hidden="true">🔔</p>
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
        <div className="space-y-6">
          {/* El mapa vive DENTRO de la rama de datos, así que no puede aparecer
              sobre un error ni sobre la lista vacía: un mapa sin un solo
              círculo diría "no estás vigilando nada" justo cuando lo que pasa
              es que no pudimos leer. */}
          <AlertsMap
            alerts={alerts}
            focused={focused}
            labelFor={(alert) => alert.name ?? t('unnamed')}
          />

          <div className="grid sm:grid-cols-2 gap-4">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {alert.name ?? t('unnamed')}
                  </h2>
                  {/* El estado se anuncia como interruptor y no como casilla:
                      lo que se dice es "activa / pausada", no "marcada". Sigue
                      siendo un `<input type="checkbox">` nativo —el `role` sólo
                      cambia cómo se nombra— así que el teclado, el foco y el
                      espacio los sigue poniendo el navegador. */}
                  <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={alert.is_active}
                      onChange={() => handleToggle(alert)}
                      className="w-4 h-4 accent-primary"
                    />
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        alert.is_active
                          ? 'bg-primary/10 text-primary'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {alert.is_active ? t('active') : t('inactive')}
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    {t('radiusBadge', { km: alert.radius_km })}
                  </span>
                  {alert.pet_type && (
                    <span className="text-xs font-medium px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                      {t(`pets:types.${alert.pet_type}`)}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 mt-auto">
                  {/* Las coordenadas eran texto inerte: tres decimales que
                      nadie puede ubicar. Ahora son el control que lleva el mapa
                      de arriba a ESTA zona — el dato sigue estando, y encima
                      hace algo. */}
                  {/* El nombre accesible dice QUÉ hace el botón; las coordenadas
                      son lo que se ve. Al revés —un botón que se llama
                      "-34.901, -56.164"— quien lo oye no tiene forma de saber
                      que sirve para algo. */}
                  <button
                    type="button"
                    onClick={() => setFocused(alert.id)}
                    aria-label={t('showOnMap', { name: alert.name ?? t('unnamed') })}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary transition-colors min-w-0"
                  >
                    <Icon name="location-on" className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {alert.alert_latitude.toFixed(3)}, {alert.alert_longitude.toFixed(3)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDelete(alert)}
                    className="text-xs font-medium text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors shrink-0"
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}
      </ListState>
        </div>
      </section>
    </div>
  );
}
