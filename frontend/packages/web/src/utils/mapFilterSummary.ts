import type { NearbyReportFilters, PetType, ReportStatus } from '@shared/types';

/**
 * Lo que el panel muestra cuando está CERRADO — la barra de peek en celular y
 * la columna colapsada en escritorio.
 *
 * Existe porque el estado colapsado no puede confundirse con "sin filtros": si
 * el usuario cierra el panel y la pantalla deja de mencionar que está filtrando
 * por gatos, la lista incompleta que ve pasa a parecer la realidad.
 */
export interface ResumenFiltros {
  /** Cuántos GRUPOS están activos: tipo, estados y rango cuentan uno cada uno. */
  total: number;
  type?: PetType;
  statuses: ReportStatus[];
  hasRange: boolean;
}

export function resumirFiltros(applied: NearbyReportFilters): ResumenFiltros {
  const statuses = applied.status ?? [];
  // Una lista vacía no es un filtro: no acota nada. Contarla haría que el
  // resumen anunciara un filtro que no existe.
  const hayEstados = statuses.length > 0;
  // Un solo extremo ya acota. Exigir los dos dejaría "desde el 1º de agosto"
  // sin representación en el resumen.
  const hasRange = Boolean(applied.from || applied.to);

  return {
    total: (applied.type ? 1 : 0) + (hayEstados ? 1 : 0) + (hasRange ? 1 : 0),
    type: applied.type,
    statuses,
    hasRange,
  };
}
