import { useState, useCallback } from 'react';
import type { NearbyReportFilters, PetType, ReportStatus } from '@shared/types';

/** Lo que el usuario está editando: días de calendario, no instantes. */
export interface MapFilterDraft {
  type?: PetType;
  status?: ReportStatus[];
  /** YYYY-MM-DD, tal como lo devuelve <input type="date">. */
  fromDay?: string;
  toDay?: string;
}

/**
 * Separa lo que el usuario EDITA de lo que la búsqueda USA.
 *
 * Existe por el patrón borrador/aplicado que este repo adoptó después de
 * encontrar filtros que disparaban un request por cada tecla. El botón
 * "Aplicar" del diseño de Stitch es la misma decisión, dibujada.
 *
 * La conversión de día a instante vive acá y NO en el servidor: el servidor no
 * puede saber en qué zona horaria está el usuario, y "un día" es exactamente lo
 * que el usuario quiso decir donde el usuario está.
 */
/**
 * Orden CANÓNICO del estado, y no el de clicks.
 *
 * `['lost','found']` y `['found','lost']` describen la misma búsqueda, pero
 * hashean a dos claves distintas de React Query y serializan a dos query
 * strings distintas: dos entradas de cache y dos viajes idénticos para el mismo
 * resultado. Ordenar acá lo vuelve una sola.
 */
const ORDEN_ESTADO: ReportStatus[] = ['lost', 'found', 'sighting'];

const ordenarEstados = (ss: ReportStatus[]): ReportStatus[] =>
  [...ss].sort((a, b) => ORDEN_ESTADO.indexOf(a) - ORDEN_ESTADO.indexOf(b));

/**
 * Convierte un día de calendario (`YYYY-MM-DD`) al instante que le corresponde
 * en la zona del usuario, o `null` si no es una fecha usable.
 *
 * El `null` no es defensa de más: `new Date(NaN, …).toISOString()` tira
 * `RangeError`, y acá eso pasaría DENTRO del onClick de "Aplicar" — o sea una
 * excepción sin manejar en el camino principal de la pantalla.
 */
function diaAInstante(dia: string, finDelDia: boolean): Date | null {
  const [y, m, d] = dia.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return finDelDia
    // Fin del día, no medianoche: quien elige "hasta el 10" espera que el 10
    // entre entero. Con las 00:00 se pierde el día completo y el filtro parece
    // roto sin decir por qué.
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function useMapFilters() {
  const [draft, setDraftState] = useState<MapFilterDraft>({});
  const [applied, setApplied] = useState<NearbyReportFilters>({});
  const [rangeError, setRangeError] = useState(false);

  const setDraft = useCallback((patch: Partial<MapFilterDraft>) => {
    // El aviso muere en cuanto el usuario toca algo: un error que sobrevive a
    // la corrección hace creer que sigue roto.
    setRangeError(false);
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleStatus = useCallback((s: ReportStatus) => {
    setRangeError(false);
    setDraftState((prev) => {
      const actual = prev.status ?? [];
      const siguiente = actual.includes(s)
        ? actual.filter((x) => x !== s)
        : [...actual, s];
      // undefined y no lista vacía: `status=` es un filtro que no filtra nada
      // pero ensucia la URL y la clave de cache.
      return { ...prev, status: siguiente.length > 0 ? siguiente : undefined };
    });
  }, []);

  // Lee `draft` del closure y NO desde dentro de un updater de estado. Meter
  // setApplied adentro de setDraftState pondría un efecto dentro de una función
  // que React puede invocar dos veces en StrictMode — activo en desarrollo —,
  // así que sería un bug que aparece sólo a veces.
  const apply = useCallback(() => {
    const desde = draft.fromDay ? diaAInstante(draft.fromDay, false) : null;
    const hasta = draft.toDay ? diaAInstante(draft.toDay, true) : null;

    // El rango al revés se ataja ACÁ y no en el servidor. No es cortesía: el
    // handler contesta 400 ante `from > to` (`report_handler.go`,
    // `From.After(To)`), React Query deja `data` en undefined, y la lista leía
    // eso como "no hay resultados" — o sea que la pantalla le respondía al
    // usuario una búsqueda que nunca ocurrió. Mientras el rango esté al revés
    // no se toca `applied`: la búsqueda anterior sigue en pantalla, que es
    // verdad, en vez de un vacío que no lo es.
    if (desde && hasta && desde.getTime() > hasta.getTime()) {
      setRangeError(true);
      return;
    }

    const next: NearbyReportFilters = {};
    if (draft.type) next.type = draft.type;
    if (draft.status && draft.status.length > 0) next.status = ordenarEstados(draft.status);
    if (desde) next.from = desde.toISOString();
    if (hasta) next.to = hasta.toISOString();

    setRangeError(false);
    setApplied(next);
  }, [draft]);

  const reset = useCallback(() => {
    setDraftState({});
    setApplied({});
    setRangeError(false);
  }, []);

  return { draft, applied, rangeError, setDraft, toggleStatus, apply, reset };
}
