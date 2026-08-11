import { useTranslation } from 'react-i18next';
import type { PetType, ReportStatus } from '@shared/types';
import type { MapFilterDraft } from '../../hooks/useMapFilters';

const TIPOS: PetType[] = ['perro', 'gato', 'pajaro', 'otro'];

// Los tres estados con su token de color. Son los MISMOS que pintan los
// marcadores y la leyenda: si alguna vez divergen, el chip deja de significar
// lo que el usuario ve en el mapa.
const ESTADOS: { valor: ReportStatus; claveTexto: string; clase: string }[] = [
  { valor: 'lost', claveTexto: 'pets:card.lost', clase: 'bg-lost' },
  { valor: 'found', claveTexto: 'pets:card.found', clase: 'bg-found' },
  { valor: 'sighting', claveTexto: 'pets:card.sighting', clase: 'bg-sighting' },
];

interface Props {
  draft: MapFilterDraft;
  onDraftChange: (patch: Partial<MapFilterDraft>) => void;
  onToggleStatus: (s: ReportStatus) => void;
  onApply: () => void;
  onReset: () => void;
  /** El rango está al revés: se avisa acá y NO se manda el request. */
  rangeError: boolean;
  /** El radio y las veterinarias NO pasan por Aplicar — ver abajo. */
  radius: number;
  onRadiusChange: (km: number) => void;
  showVets: boolean;
  onToggleVets: () => void;
}

/**
 * Panel de filtros del mapa. No tiene estado propio: recibe el borrador y avisa
 * hacia arriba.
 *
 * NO TODO PASA POR "APLICAR", y la diferencia no es caprichosa:
 *  - Tipo, estados y fechas son BORRADOR. Filtran resultados, y aplicarlos por
 *    tecla dispararía un request por letra.
 *  - El RADIO es inmediato: dibuja el círculo en pantalla. Diferirlo mostraría
 *    un círculo que no coincide con los resultados que se están viendo.
 *  - Las VETERINARIAS son inmediatas: prenden una capa del mapa, no filtran
 *    reportes.
 */
export function MapFilterPanel({
  draft,
  onDraftChange,
  onToggleStatus,
  onApply,
  onReset,
  rangeError,
  radius,
  onRadiusChange,
  showVets,
  onToggleVets,
}: Props) {
  const { t } = useTranslation(['map', 'pets', 'vets']);

  return (
    <div className="p-4 flex flex-col gap-4 border-b border-gray-200 dark:border-gray-700">
      <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('map:filtersTitle')}
      </h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="map-type" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('map:typeLabel')}
        </label>
        <select
          id="map-type"
          value={draft.type ?? ''}
          onChange={(e) => onDraftChange({ type: (e.target.value || undefined) as PetType | undefined })}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          <option value="">{t('map:typeAll')}</option>
          {TIPOS.map((tipo) => (
            <option key={tipo} value={tipo}>{t(`pets:types.${tipo}`)}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('map:statusLabel')}
        </span>
        <div className="flex flex-wrap gap-2">
          {ESTADOS.map(({ valor, claveTexto, clase }) => {
            const activo = draft.status?.includes(valor) ?? false;
            return (
              <button
                key={valor}
                type="button"
                onClick={() => onToggleStatus(valor)}
                // Sin aria-pressed un lector de pantalla lee los tres chips
                // igual y no dice cuál está activo.
                aria-pressed={activo}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border transition-colors ${
                  activo
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${clase}`} aria-hidden="true" />
                {t(claveTexto)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="map-from" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('map:dateFrom')}
          </label>
          <input
            id="map-from"
            type="date"
            value={draft.fromDay ?? ''}
            // undefined y no cadena vacía: una cadena vacía entra al queryKey
            // como un filtro presente que no filtra nada.
            onChange={(e) => onDraftChange({ fromDay: e.target.value || undefined })}
            aria-invalid={rangeError}
            aria-describedby={rangeError ? 'map-range-error' : undefined}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="map-to" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('map:dateTo')}
          </label>
          <input
            id="map-to"
            type="date"
            value={draft.toDay ?? ''}
            onChange={(e) => onDraftChange({ toDay: e.target.value || undefined })}
            aria-invalid={rangeError}
            aria-describedby={rangeError ? 'map-range-error' : undefined}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      {/* role=alert: el usuario acaba de apretar Aplicar y espera que algo
          pase. Sin esto, para un lector de pantalla no pasa NADA — la búsqueda
          no se dispara y el mensaje aparece lejos del foco. */}
      {rangeError && (
        <p id="map-range-error" role="alert" className="text-xs text-danger">
          {t('map:invalidRange')}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          className="flex-1 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
        >
          {t('map:apply')}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold"
        >
          {t('map:clear')}
        </button>
      </div>

      {/* Debajo del separador: los dos controles INMEDIATOS. Están agrupados
          aparte a propósito, para que se lea que no dependen de Aplicar. */}
      <div className="flex flex-col gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <label htmlFor="map-radius" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('map:radius')}
          </label>
          <select
            id="map-radius"
            value={radius}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            {[1, 3, 5, 10].map((km) => (
              <option key={km} value={km}>{t('map:radiusKm', { km })}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          data-testid="vets-toggle"
          onClick={onToggleVets}
          aria-pressed={showVets}
          className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors self-start ${
            showVets
              ? 'bg-secondary text-white border-secondary'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
          }`}
        >
          🏥 {showVets ? t('vets:hide') : t('vets:toggle')}
        </button>
      </div>
    </div>
  );
}
