import type { BirthDatePrecision } from '../types';

// Deriva la edad a partir de birth_date + su precisión.
//
// La edad NO se guarda: guardar "3 años" es guardar un dato que queda viejo
// solo al pasar el año. Se deriva en cada render.
//
// LO IMPORTANTE ES QUE RESPETA LA PRECISIÓN. Con precisión 'year' el backend
// guarda "2022-01-01" porque la columna es DATE y necesita un día, pero ese
// 1 de enero es RELLENO: la mascota pudo nacer cualquier día de 2022. Bajar
// desde ahí a "hace 7 meses" inventaría hasta 11 meses de certeza que el dueño
// nunca dio — el error exacto que la precisión existe para evitar.
//
// Por eso la unidad más fina que se devuelve depende de la precisión:
//   'day'   → años, meses o días
//   'month' → años o meses
//   'year'  → sólo años
//
// Se devuelve un valor estructurado y no un string armado: la pluralización y
// el "aprox." son cosa del i18n del consumidor, en tres idiomas.

export type PetAgeUnit = 'year' | 'month' | 'day';

export interface PetAge {
  unit: PetAgeUnit;
  value: number;
  /** true cuando la precisión guardada no alcanza para afirmar el número exacto. */
  approximate: boolean;
}

/**
 * La edad ya formateada y traducida, o '' si no hay fecha.
 *
 * Vive acá y no en cada pantalla porque la regla del "aprox." es un INVARIANTE,
 * no una decisión de presentación: sólo la precisión 'day' afirma el día
 * exacto, así que sólo ella puede mostrarse sin atenuar. Con una copia por
 * pantalla, arreglarlo en una dejaría a la otra —la landing pública, que es la
 * que ven más desconocidos— haciendo la afirmación más fuerte.
 *
 * Recibe la función de traducción en vez de importar i18next: `shared/` es
 * agnóstico de web y mobile.
 */
export function formatPetAge(
  t: (key: string, options?: Record<string, unknown>) => string,
  birthDate: string | undefined,
  precision: BirthDatePrecision | '' | undefined,
  now: Date = new Date()
): string {
  const age = computePetAge(birthDate, precision, now);
  if (!age) return '';
  const base = t(`pets:age.${age.unit}s`, { count: age.value });
  return age.approximate ? t('pets:age.approximate', { age: base }) : base;
}

export function computePetAge(
  birthDate: string | undefined,
  precision: BirthDatePrecision | '' | undefined,
  now: Date = new Date()
): PetAge | null {
  if (!birthDate || !precision) return null;
  // Sólo día de calendario plano. Un instante ISO no es lo que guarda esta
  // columna, y adivinar su día reintroduce el corrimiento por zona horaria.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!m) return null;

  const [, y, mo, d] = m.map(Number) as unknown as [string, number, number, number];
  const nacimiento = new Date(y, mo - 1, d);
  const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Una fecha futura existe: el backend tolera un día de gracia sobre UTC.
  // "-1 años" es peor que no mostrar nada.
  if (nacimiento.getTime() > hoy.getTime()) return null;

  // 'day' es la única precisión que afirma el día exacto.
  const approximate = precision !== 'day';

  let anios = hoy.getFullYear() - nacimiento.getFullYear();
  const cumpleFuePasado =
    hoy.getMonth() > nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() >= nacimiento.getDate());
  if (!cumpleFuePasado) anios -= 1;

  if (anios >= 1 || precision === 'year') {
    return { unit: 'year', value: Math.max(anios, 0), approximate };
  }

  let meses = (hoy.getFullYear() - nacimiento.getFullYear()) * 12 + (hoy.getMonth() - nacimiento.getMonth());
  if (hoy.getDate() < nacimiento.getDate()) meses -= 1;

  if (meses >= 1 || precision === 'month') {
    return { unit: 'month', value: Math.max(meses, 0), approximate };
  }

  const dias = Math.floor((hoy.getTime() - nacimiento.getTime()) / 86_400_000);
  return { unit: 'day', value: dias, approximate };
}
