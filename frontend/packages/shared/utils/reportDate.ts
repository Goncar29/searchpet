// Conversión entre el día de calendario que elige el usuario (YYYY-MM-DD) y el
// instante ISO que guarda el backend en `occurred_at`.
//
// Existe porque la conversión obvia está MAL y ya se había colado en producción:
//
//   `${'2026-08-03'}T00:00:00Z`  →  2026-08-03 00:00 UTC
//                                →  2026-08-02 21:00 en Uruguay (UTC-3)
//
// El instante es correcto, pero cuando se muestra en la zona del usuario dice
// el día ANTERIOR. Alguien escribe "se perdió el 3" y su reporte queda fechado
// el 2 — un día de corrimiento justo en el dato que existe para acotar la
// búsqueda. Con zonas al este de UTC el corrimiento va para el otro lado.
//
// Un `<input type="date">` no elige un instante, elige un DÍA. Lo que hay que
// mandar es la medianoche LOCAL de ese día, que es el instante que vuelve a
// leerse como ese mismo día en la zona de quien lo cargó.

/**
 * Convierte YYYY-MM-DD (día de calendario local) al ISO UTC del comienzo de ese
 * día en la zona del usuario. Devuelve undefined si el string está vacío o no
 * es una fecha real.
 */
export function calendarDayToISO(day: string): string | undefined {
  const limpio = day.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return undefined;
  const [y, m, d] = limpio.split('-').map(Number);
  // El constructor con componentes numéricos interpreta en hora LOCAL, que es
  // exactamente lo que se quiere. `new Date('2026-08-03')` NO sirve: el string
  // en formato fecha se parsea como UTC, que es el bug original.
  const fecha = new Date(y, m - 1, d);
  // Rebota los días que no existen: new Date(2026, 1, 31) da el 3 de marzo.
  if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) {
    return undefined;
  }
  return fecha.toISOString();
}

/**
 * El día de HOY según la zona del usuario, en YYYY-MM-DD. Sirve de `max` para
 * un input de fecha. No se usa toISOString() porque devuelve el día en UTC, que
 * al este de Greenwich puede ser mañana y al oeste, ayer.
 */
export function todayAsCalendarDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** true si el día de calendario es posterior a hoy en la zona del usuario. */
export function isFutureCalendarDay(day: string, now: Date = new Date()): boolean {
  return day.trim() > todayAsCalendarDay(now);
}
