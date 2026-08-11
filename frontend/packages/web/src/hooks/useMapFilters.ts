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
export function useMapFilters() {
  const [draft, setDraftState] = useState<MapFilterDraft>({});
  const [applied, setApplied] = useState<NearbyReportFilters>({});

  const setDraft = useCallback((patch: Partial<MapFilterDraft>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleStatus = useCallback((s: ReportStatus) => {
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
    const next: NearbyReportFilters = {};
    if (draft.type) next.type = draft.type;
    if (draft.status && draft.status.length > 0) next.status = draft.status;

    if (draft.fromDay) {
      const [y, m, d] = draft.fromDay.split('-').map(Number);
      next.from = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
    }
    if (draft.toDay) {
      const [y, m, d] = draft.toDay.split('-').map(Number);
      // Fin del día, no medianoche: quien elige "hasta el 10" espera que el 10
      // entre entero. Con las 00:00 se pierde el día completo y el filtro
      // parece roto sin decir por qué.
      next.to = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
    }

    setApplied(next);
  }, [draft]);

  const reset = useCallback(() => {
    setDraftState({});
    setApplied({});
  }, []);

  return { draft, applied, setDraft, toggleStatus, apply, reset };
}
