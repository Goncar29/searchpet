// Deriva "cuánto hace que se vio a este animal" desde la fecha que manda el
// backend en `last_seen_at`.
//
// Espeja la forma de petAge.ts a propósito: un cómputo PURO y estructurado
// (`computeLastSeen`) separado del formateo traducido (`formatLastSeen`). La
// separación no es ceremonia — el cómputo se puede testear con fechas fijas sin
// montar i18n, y ahí están todos los bordes.
//
// LO QUE ESTE ARCHIVO NO HACE, Y ES DELIBERADO: no sabe nada de caducidad. El
// plazo de 90 días vive en domain.StraySightingTTL y no cruza al cliente. Acá
// sólo se muestra un HECHO; el juicio "esto venció" no se emite nunca, porque
// es jerga nuestra y sugiere que el animal ya no está — que es justo lo que no
// sabemos.

export type LastSeenUnit = 'year' | 'month' | 'day';

export interface LastSeenAmount {
  unit: LastSeenUnit;
  value: number;
}

const DIA_MS = 86_400_000;

/**
 * Cuánto hace que se lo vio, o null si no hay fecha o no parsea.
 *
 * Los cortes son 30 días para pasar a meses y 365 para pasar a años. Son
 * aproximaciones a propósito: quien lee esto quiere saber si algo está fresco o
 * viejo, no cuántos días exactos pasaron. La fecha exacta viaja aparte.
 */
export function computeLastSeen(
  iso: string | undefined,
  now: Date = new Date()
): LastSeenAmount | null {
  if (!iso) return null;
  const visto = new Date(iso);
  if (Number.isNaN(visto.getTime())) return null;

  // Se compara por día de CALENDARIO y no por instante: si no, algo visto
  // "ayer a las 23:00" mirado hoy a las 08:00 daría 0 días y diría "hoy", que
  // es una afirmación falsa sobre cuándo se vio al animal.
  //
  // Y el calendario es el LOCAL, no el UTC, porque la otra línea de la misma
  // tarjeta sale de `toLocaleDateString`, que es local. Con UTC acá las dos
  // líneas se contradecían entre sí: medido en Montevideo (UTC-3), un
  // avistamiento a las 01:00Z daba "hoy" arriba y "6 de septiembre" abajo, el
  // mismo día. Un solo calendario para las dos, o la tarjeta discute consigo
  // misma en la franja de 00:00 a 03:00 UTC.
  const aDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((aDia(now) - aDia(visto)) / DIA_MS);

  // Una fecha futura es alcanzable con relojes desfasados entre el server y el
  // device. "hace -3 días" es peor que decir "hoy".
  if (dias <= 0) return { unit: 'day', value: 0 };
  if (dias < 30) return { unit: 'day', value: dias };
  if (dias < 365) return { unit: 'month', value: Math.floor(dias / 30) };
  return { unit: 'year', value: Math.floor(dias / 365) };
}

/**
 * El texto ya traducido, en sus dos formas, o null si no hay fecha.
 *
 * Devuelve las DOS porque hay dos lectores distintos: el relativo responde
 * "¿esto está fresco?" de un vistazo, y la fecha exacta responde "¿coincide con
 * el día que se me escapó?" — que es literalmente el usuario para el que existe
 * el plazo de 90 días de StraySightingTTL.
 *
 * Recibe `t` en vez de importar i18next: `shared/` es agnóstico de web y mobile.
 * La pluralización va por `{{count}}`, igual que petAge.ts, y NO por
 * `Intl.RelativeTimeFormat`: Hermes no lo trae.
 */
export function formatLastSeen(
  t: (key: string, options?: Record<string, unknown>) => string,
  iso: string | undefined,
  locale: string,
  now: Date = new Date()
): { relative: string; absolute: string } | null {
  const amount = computeLastSeen(iso, now);
  if (!amount || !iso) return null;

  let cuando: string;
  if (amount.unit === 'day' && amount.value === 0) {
    cuando = t('pets:lastSeen.today');
  } else if (amount.unit === 'day' && amount.value === 1) {
    cuando = t('pets:lastSeen.yesterday');
  } else {
    // `ago` es su propia clave y no se concatena en código porque el orden
    // cambia entre idiomas: "hace 4 meses" contra "4 months ago".
    cuando = t('pets:lastSeen.ago', {
      time: t(`pets:lastSeen.${amount.unit}s`, { count: amount.value }),
    });
  }

  return {
    relative: t('pets:lastSeen.line', { when: cuando }),
    absolute: new Date(iso).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
}
