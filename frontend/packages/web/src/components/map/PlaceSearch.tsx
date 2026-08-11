import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { geocode, type GeocodePlace } from '@shared/utils/geocode';

interface Props {
  /** Recibe el lugar elegido. El mapa se mueve; la búsqueda no filtra. */
  onFound: (lat: number, lng: number, label: string) => void;
  /**
   * Dónde está mirando el usuario, para preferir lugares de su región.
   * Sin esto, "Colonia" resuelve a Köln, Alemania.
   */
  near?: { lat: number; lng: number };
}

type Estado =
  | { fase: 'quieto' }
  | { fase: 'buscando' }
  /** Hay más de un candidato: elige el usuario, no nosotros. */
  | { fase: 'eligiendo'; lugares: GeocodePlace[] }
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
export function PlaceSearch({ onFound, near }: Props) {
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

  const elegir = (lugar: GeocodePlace) => {
    // El éxito también se anuncia. Antes el `role=status` sólo cubría
    // buscando/vacío/error, así que quien usa lector de pantalla no se enteraba
    // de que el mapa se había movido: la única señal era visual.
    setEstado({ fase: 'movido', lugar: lugar.label });
    onFound(lugar.lat, lugar.lng, lugar.label);
  };

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
      const r = await geocode(valor, { language: i18n.language, signal: ctrl.signal, near });

      // Llegó tarde: ya hay una búsqueda más nueva. No se toca NADA — ni el
      // mapa ni el mensaje —, porque la que manda es la otra.
      if (ctrl.signal.aborted || r?.kind === 'aborted') return;

      if (r?.kind === 'ok') {
        // UN solo candidato no es ambiguo: no hay nada que elegir, así que
        // pedir un tap extra sería ceremonia. "Pocitos" sigue siendo un Enter.
        if (r.places.length === 1) {
          elegir(r.places[0]);
          return;
        }
        // Varios: decide el usuario. Elegir nosotros es lo que mandaba a
        // Alemania a alguien que buscaba Colonia del Sacramento.
        setEstado({ fase: 'eligiendo', lugares: r.places });
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
        onChange={(e) => {
          setValor(e.target.value);
          // La lista de candidatos muere al cambiar la consulta. Si sobreviviera,
          // el usuario podría escribir "Montevideo" y elegir de una lista de
          // "Colonia" — el mapa en un lugar y el input diciendo otro, que es
          // exactamente la divergencia que MapViewSync y la guarda de la
          // carrera vinieron a cerrar.
          if (estado.fase === 'eligiendo') setEstado({ fase: 'quieto' });
        }}
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
        {estado.fase === 'eligiendo' && (
          <span className="text-gray-500 dark:text-gray-400">
            {/* `n` y NO `count`: con `count` i18next activa la pluralizacion y
                busca `pickPlace_one`/`pickPlace_other`, que no existen. */}
            {t('map:pickPlace', { n: estado.lugares.length })}
          </span>
        )}
      </p>

      {/* LA DESAMBIGUACION. "Colonia" son tres lugares distintos y el ranking
          global pone primero a Köln, Alemania: con limit=1 mandabamos a alguien
          que busca a su mascota a 11.000 km. El sesgo por region reordena, pero
          NO elimina la ambiguedad — la elige quien sabe a cual se referia.

          Se muestra el display_name COMPLETO, que es lo unico que distingue
          "Colonia del Sacramento, Colonia, Uruguay" de "Colonia, Alemania".
          Recortarlo a la primera palabra dejaria dos filas identicas. */}
      {estado.fase === 'eligiendo' && (
        <ul className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          {estado.lugares.map((lugar) => (
            <li key={`${lugar.lat},${lugar.lng}`}>
              <button
                type="button"
                onClick={() => elegir(lugar)}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border-b last:border-b-0 border-gray-200 dark:border-gray-700 transition-colors"
              >
                {lugar.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
