import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { FormSection } from '../form/FormSection';
import { FormField } from '../form/FormField';
import { FormActions, formSubmitClass, formCancelClass } from '../form/FormActions';
import type { InitialReportRequest } from '@shared/types';
import { calendarDayToISO, todayAsCalendarDay, isFutureCalendarDay, isoToCalendarDay } from '@shared/utils/reportDate';

const MONTEVIDEO: [number, number] = [-34.9011, -56.1645];

const pinIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function RecenterOnChange({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(position);
  }, [map, position]);
  return null;
}

interface LocationStepProps {
  value: InitialReportRequest | null;
  onPublish: (location: InitialReportRequest) => void;
  onBack: () => void;
  isPending: boolean;
}

export function LocationStep({ value, onPublish, onBack, isPending }: LocationStepProps) {
  const { t } = useTranslation('publish');
  const [position, setPosition] = useState<[number, number]>(
    value ? [value.latitude, value.longitude] : MONTEVIDEO
  );
  const [note, setNote] = useState(value?.note ?? '');
  // El día LOCAL del instante guardado, no `iso.slice(0, 10)`: el slice lee el
  // día en UTC y al este de Greenwich rehidrata el día anterior, restando uno
  // más en cada ida y vuelta por el paso de login. Ver shared/utils/reportDate.
  const [date, setDate] = useState(() => isoToCalendarDay(value?.occurred_at));
  const [dateError, setDateError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // El backend rechaza cualquier fecha futura con invalid_input, así que el
  // input no deja ni elegirla: es el mismo límite, dicho antes de enviar.
  // Día LOCAL, no el de toISOString(), que es el de UTC y puede diferir.
  const today = todayAsCalendarDay();

  const useMyLocation = () => {
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => setPosition([pos.coords.latitude, pos.coords.longitude]),
      () => setLocationError(t('location.locationDenied'))
    );
  };

  // El `max` del input orienta al date picker pero NO impide tipear una fecha
  // a mano. Sin este chequeo, quien la escribe recibe el 400 del backend como
  // "los datos ingresados no son válidos": un mensaje genérico que no dice qué
  // campo ni por qué. Mobile ya nombraba el problema; esto empareja las dos.
  const handlePublish = () => {
    if (date && isFutureCalendarDay(date)) {
      setDateError(t('location.dateFuture'));
      return;
    }
    // Un valor que no parsea devuelve undefined y se iba en SILENCIO: publicaba
    // sin fecha, sin error y sin decir nada. Sólo pasa donde el input de fecha
    // degrada a texto, pero descartar dato del usuario sin avisar es peor que
    // el caso raro que lo produce. Mobile ya nombraba este error.
    const iso = date ? calendarDayToISO(date) : undefined;
    if (date && !iso) {
      setDateError(t('location.dateInvalid'));
      return;
    }
    setDateError(null);
    onPublish({
      latitude: position[0],
      longitude: position[1],
      note: note.trim() || undefined,
      occurred_at: iso,
    });
  };

  return (
    // El paso NO usa FormPage: el frame lo pone PublishWizardPage. Ver la nota
    // equivalente en StrayFormStep.
    <div className="space-y-6">
      <h1 className="font-display text-headline text-gray-900 dark:text-gray-50 text-center">
        {t('location.title')}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('location.instructions')}</p>

      <FormSection title={t('location.sectionPlace')}>
      {/* El MapContainer queda EXACTAMENTE como estaba: este cambio es de
          presentación, y el mapa es lo único de esta pantalla que no es
          presentación. Sólo cambia la card que lo enmarca. */}
      <div className="h-72 rounded-xl overflow-hidden">
        <MapContainer center={position} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={position}
            draggable
            icon={pinIcon}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const latLng = marker.getLatLng();
                setPosition([latLng.lat, latLng.lng]);
              },
            }}
          />
          <RecenterOnChange position={position} />
        </MapContainer>
      </div>

      <button
        type="button"
        onClick={useMyLocation}
        className="mt-4 w-full border-2 border-primary text-primary font-semibold rounded-lg px-4 py-2 hover:bg-primary/5 transition-colors"
      >
        {t('location.useMyLocation')}
      </button>
      {locationError && (
        <p role="alert" className="mt-2 text-yellow-600 dark:text-yellow-400 text-sm text-center">
          {locationError}
        </p>
      )}
      </FormSection>

      <FormSection title={t('location.sectionDetails')}>
        <div className="space-y-6">
          <FormField
            label={t('location.dateLabel')}
            htmlFor="location-date"
            error={dateError ?? undefined}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                value={date}
                max={today}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (dateError) setDateError(null);
                }}
              />
            )}
          </FormField>
          {/* La ayuda se esconde cuando hay error: FormField ya muestra el
              mensaje ahí, y dos textos bajo el mismo campo compiten. */}
          {!dateError && (
            <p className="-mt-4 text-xs text-gray-500 dark:text-gray-400">
              {t('location.dateHelp')}
            </p>
          )}

          <FormField label={t('location.noteLabel')} htmlFor="location-note">
            {(control) => (
              <textarea
                {...control}
                className={`${control.className} resize-y`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('location.notePlaceholder')}
                rows={2}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      <FormActions
        cancel={
          <button type="button" onClick={onBack} className={formCancelClass}>
            {t('location.back')}
          </button>
        }
        submit={
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPending}
            className={formSubmitClass}
          >
            {t('location.publish')}
          </button>
        }
      />
    </div>
  );
}
