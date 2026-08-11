import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { geocode } from '@shared/utils/geocode';

interface Props {
  /** Recibe el lugar encontrado. El mapa se mueve; la búsqueda no filtra. */
  onFound: (lat: number, lng: number, label: string) => void;
}

type Estado =
  | { fase: 'quieto' }
  | { fase: 'buscando' }
  | { fase: 'movido'; lugar: string }
  | { fase: 'vacio' }
  | { fase: 'error' };

/**
 * Buscador de lugares del panel del mapa.
 *
 * NAVEGA, NO FILTRA. Escribir "Pocitos" mueve el mapa a Pocitos y la búsqueda
 * sigue corriendo sobre el centro + radio de siempre. Ese fue el punto de
 * diseño: el mapa ya responde "dónde", y una segunda fuente para la misma
 * pregunta produce resultados que no coinciden con ninguno de los dos
 * controles que el usuario tiene en pantalla.
 *
 * Se dispara con ENTER y nunca por tecla: la política de uso de Nominatim topea
 * en un request por segundo, y escribir un barrio la violaría sola.
 */
export function PlaceSearch({ onFound }: Props) {
  const { t, i18n } = useTranslation(['map']);
  const [valor, setValor] = useState('');
  const [estado, setEstado] = useState<Estado>({ fase: 'quieto' });

  /**
   * La búsqueda EN VUELO. Sin esto, dos Enter seguidos son una carrera que
   * gana la respuesta más LENTA: buscás "Colonia", después "Punta del Este", y
   * si la primera tarda más, aterriza última y mueve el mapa a Colonia con el
   * input diciendo "Punta del Este". Es exactamente la divergencia entre lo
   * que se lee y lo que se ve que MapViewSync vino a arreglar, entrando por
   * otra puerta.
   */
  const enVuelo = useRef<AbortController | null>(null);

  // Cancelar al desmontar evita, además, un setState sobre un componente que
  // ya no existe.
  useEffect(() => () => enVuelo.current?.abort(), []);

  const buscar = async () => {
    // La anterior se cancela ANTES de arrancar la nueva: mientras haya una sola
    // vigente, no hay carrera que perder.
    enVuelo.current?.abort();
    const ctrl = new AbortController();
    enVuelo.current = ctrl;

    // El mensaje anterior se limpia ANTES de preguntar: un error que sobrevive
    // a una búsqueda exitosa hace creer que falló.
    setEstado({ fase: 'buscando' });

    // geocode se traga sus propios errores y siempre devuelve un resultado,
    // pero el try igual va: si alguna vez tirara, esta pantalla quedaría clavada
    // en "Buscando..." para siempre y sin salida — el usuario no tendría forma
    // de saber que ya no va a pasar nada.
    try {
      const r = await geocode(valor, { language: i18n.language, signal: ctrl.signal });

      // Llegó tarde: ya hay una búsqueda más nueva. No se toca NADA — ni el
      // mapa ni el mensaje —, porque la que manda es la otra.
      if (ctrl.signal.aborted || r?.kind === 'aborted') return;

      if (r?.kind === 'ok') {
        // El éxito también se anuncia. Antes el `role=status` sólo cubría
        // buscando/vacío/error, así que quien usa lector de pantalla no se
        // enteraba de que el mapa se había movido: la única señal era visual.
        setEstado({ fase: 'movido', lugar: r.label });
        onFound(r.lat, r.lng, r.label);
        return;
      }
      setEstado({ fase: r?.kind === 'empty' ? 'vacio' : 'error' });
    } catch {
      if (!ctrl.signal.aborted) setEstado({ fase: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="map-place" className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('map:searchPlace')}
      </label>
      <input
        id="map-place"
        type="search"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void buscar();
          }
        }}
        placeholder={t('map:searchPlaceHint')}
        className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />

      {/* role=status + aria-live: sin esto un lector de pantalla no se entera
          de que la búsqueda falló, porque el mensaje aparece lejos del foco. */}
      <p role="status" aria-live="polite" className="text-xs min-h-4">
        {estado.fase === 'buscando' && (
          <span className="text-gray-500 dark:text-gray-400">{t('map:searchingPlace')}</span>
        )}
        {/* Los dos desenlaces dicen cosas DISTINTAS: uno manda a reescribir, el
            otro a reintentar. Colapsarlos manda a corregir un texto que estaba
            bien. */}
        {estado.fase === 'vacio' && (
          <span className="text-gray-500 dark:text-gray-400">{t('map:searchNotFound')}</span>
        )}
        {estado.fase === 'error' && (
          <span className="text-danger">{t('map:searchError')}</span>
        )}
        {/* El nombre lo devuelve Nominatim, o sea un tercero. Va como texto en
            JSX, que React escapa — nunca a innerHTML. */}
        {estado.fase === 'movido' && (
          <span className="text-gray-500 dark:text-gray-400">
            {t('map:movedTo', { place: estado.lugar })}
          </span>
        )}
      </p>
    </div>
  );
}
