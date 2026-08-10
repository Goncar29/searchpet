import type { BirthDatePrecision } from '../types';

// Conversión entre los tres selects del formulario (año / mes / día) y el par
// { birth_date, birth_date_precision } que espera el backend.
//
// POR QUÉ TRES SELECTS Y NO UN INPUT DE FECHA CON UN SELECTOR DE PRECISIÓN:
// la precisión se DERIVA de cuánto llenó el usuario, así que el par incoherente
// que el backend rechaza con 400 —fecha sin precisión, precisión sin fecha, o
// un día exacto declarado como "sólo sé el año"— no se puede construir desde la
// UI. La regla que el servidor defiende y la forma del formulario son la misma
// cosa, en vez de dos reglas que hay que mantener sincronizadas.
//
// NO hay conversión de zona horaria acá, y es a propósito: `birth_date` viaja
// como día de calendario plano ("2022-03-01"), no como instante ISO. La columna
// es DATE y se queda sólo con el día, así que un instante le hace perder la
// zona y corre la fecha un día entero. Es la diferencia con reportDate.ts, cuyo
// `occurred_at` sí es timestamptz.

export interface BirthDateParts {
  year: string;
  month: string;
  day: string;
}

export interface BirthDatePayload {
  birth_date: string;
  birth_date_precision: BirthDatePrecision;
}

const VACIO: BirthDateParts = { year: '', month: '', day: '' };

/**
 * Los años que ofrece el select, del actual hacia atrás.
 *
 * Cubre los mismos 150 que tolera el backend (`birthDateMaxAge`), no un rango
 * "razonable" más corto. Una versión anterior ofrecía 30 justificando que
 * "alcanza para perros y gatos", y eso CONTRADECÍA al dominio: el piso es 150
 * justamente porque el tipo `otro` incluye tortugas y loros. Dos consecuencias
 * que se evitan cubriendo el rango completo:
 *
 *  - el año de una mascota longeva era imposible de cargar desde la web;
 *  - si ese valor ya existía (cargado por la API), el `<select>` no tenía la
 *    opción y React lo dejaba en `selectedIndex = -1`: el año se veía VACÍO
 *    mientras mes y día seguían llenos, y el dueño podía "corregirlo" eligiendo
 *    otro año, reescribiendo un dato real sin enterarse.
 *
 * Van del más nuevo al más viejo, así el caso común queda arriba.
 */
export function birthDateYears(now: Date = new Date()): number[] {
  const actual = now.getFullYear();
  return Array.from({ length: BIRTH_DATE_MAX_AGE + 1 }, (_, i) => actual - i);
}

/** Espeja domain.birthDateMaxAge: el backend rechaza fechas más viejas. */
export const BIRTH_DATE_MAX_AGE = 150;

/**
 * Los meses elegibles para ese año: 1..12, salvo en el año actual, donde se
 * corta en el mes de hoy.
 *
 * Acotar la OFERTA es la mitad estructural del arreglo — igual que derivar la
 * precisión, lo que no se puede elegir no hay que validarlo. Sin esto el
 * formulario ofrecía diciembre en el año en curso, `composeBirthDate` devolvía
 * `undefined` por ser futura, y el update mandaba el par vacío: la fecha
 * guardada se BORRABA en silencio y el usuario terminaba en "Mis mascotas" sin
 * un solo mensaje.
 */
export function selectableMonths(year: string, now: Date = new Date()): number[] {
  const tope = Number(year) === now.getFullYear() ? now.getMonth() + 1 : 12;
  return Array.from({ length: tope }, (_, i) => i + 1);
}

/** Los días elegibles: los del mes, cortados en hoy si es el mes en curso. */
export function selectableDays(year: string, month: string, now: Date = new Date()): number[] {
  const enElMes = daysInMonth(year, month);
  const esMesActual = Number(year) === now.getFullYear() && Number(month) === now.getMonth() + 1;
  const tope = esMesActual ? Math.min(enElMes, now.getDate()) : enElMes;
  return Array.from({ length: tope }, (_, i) => i + 1);
}

/**
 * Arma el par a partir de lo que eligió el usuario, o `undefined` si no hay
 * nada que mandar (o si lo que hay no es una fecha válida).
 *
 * El año es lo único obligatorio: sin él no hay fecha. Un día sin mes se
 * descarta en vez de rechazar todo — "el 9 de algún mes de 2022" no es
 * representable con tres niveles de precisión, así que se conserva lo que sí
 * se sabe.
 */
export function composeBirthDate(parts: BirthDateParts, now: Date = new Date()): BirthDatePayload | undefined {
  const year = parts.year.trim();
  if (!/^\d{4}$/.test(year)) return undefined;
  // El piso de 150 años se valida ACÁ y no sólo acotando la oferta del select.
  // En web alcanzaba con acotarla —lo que no se puede elegir no hay que
  // validarlo— pero mobile pide el año en un campo de TEXTO LIBRE: ahí la
  // garantía estructural no existe. Un "1022" tipeado en vez de "2022" pasaba
  // esta función y moría en el backend con un 400 genérico que nunca nombra el
  // campo. La invariante vive en la función compartida, no en la forma que cada
  // plataforma le da al control.
  if (Number(year) < now.getFullYear() - BIRTH_DATE_MAX_AGE) return undefined;

  const month = parts.month.trim();
  const day = parts.day.trim();

  // La precisión es cuánto llenó, no un campo aparte.
  let precision: BirthDatePrecision = 'year';
  if (month) precision = day ? 'day' : 'month';

  const y = Number(year);
  // Los componentes no significativos van en 01. El backend guarda la fecha
  // completa igual —la columna es DATE— y la precisión es lo que dice cuáles
  // de esos componentes hay que creer.
  const m = month ? Number(month) : 1;
  const d = precision === 'day' ? Number(day) : 1;

  const fecha = new Date(y, m - 1, d);
  // Rebota los días inexistentes: new Date(2022, 1, 30) da el 2 de marzo EN
  // SILENCIO, así que sin este chequeo se guardaría una fecha que nadie eligió.
  if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) {
    return undefined;
  }
  // Nadie nació mañana. Se compara contra el día LOCAL: el backend tolera un
  // día de gracia para los usuarios adelantados de UTC, así que rechazar acá lo
  // que es futuro para el propio usuario nunca choca con el servidor.
  if (fecha.getTime() > new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    return undefined;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    // El backend parsea con el layout "2006-01-02" EXACTO: un "2022-3-9" no
    // matchea y vuelve 400.
    birth_date: `${year}-${pad(m)}-${pad(d)}`,
    birth_date_precision: precision,
  };
}

/**
 * La inversa: del par guardado a los tres selects, para el formulario de
 * edición.
 *
 * Devuelve SÓLO los componentes que la precisión declara reales. Es la parte
 * más importante del módulo: con precisión 'year' el backend guarda
 * "2022-01-01", y rehidratar mes=enero y día=1 le mostraría al usuario una
 * fecha exacta que nunca afirmó. Peor: al guardar otra vez quedaría como 'day'.
 * El dato se contaminaría solo, con abrir y cerrar la pantalla.
 */
export function decomposeBirthDate(
  birthDate: string | undefined,
  precision: BirthDatePrecision | '' | undefined
): BirthDateParts {
  if (!birthDate || !precision) return { ...VACIO };
  // Un instante ISO no es un día de calendario; es justo el formato que el
  // backend rechaza. Si llega uno, algo se rompió aguas arriba: no se adivina.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!m) return { ...VACIO };

  const [, year, month, day] = m;
  if (precision === 'year') return { year, month: '', day: '' };
  if (precision === 'month') return { year, month: String(Number(month)), day: '' };
  return { year, month: String(Number(month)), day: String(Number(day)) };
}

/** Los días que tiene ese mes de ese año, para acotar el select del día. */
export function daysInMonth(year: string, month: string): number {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return 31;
  // El día 0 del mes siguiente es el último del actual.
  return new Date(y, m, 0).getDate();
}
