/**
 * El locale con el que formatear fechas y horas, a partir del idioma de la app.
 *
 * POR QUÉ NO ALCANZA CON `i18n.language` PELADO, medido y no supuesto: para
 * FECHAS los dos dan lo mismo, pero para HORAS no.
 *
 *   es     ->  7/3/2026, 15:04:00        (24 h)
 *   es-UY  ->  7/3/2026, 3:04:00 p. m.   (12 h)
 *
 *   en / en-US  ->  idénticos
 *   pt / pt-BR  ->  idénticos
 *
 * O sea que la diferencia existe en **un solo idioma y sólo al mostrar la
 * hora**. Es justo la clase de detalle que se arregla en una pantalla, se
 * olvida en la siguiente, y termina con la misma app mostrando las dos formas.
 *
 * ESTE ARCHIVO VIVE EN `shared` Y NO EN `mobile` a propósito: mobile ya lo tenía
 * y web no, así que web había derivado a TRES formas conviviendo —`'es-UY'`
 * cableado, `i18n.language` pelado, y nada (el locale del NAVEGADOR, que no
 * tiene por qué coincidir con el idioma elegido en la app)—. `mobile/i18n/
 * dateLocale.ts` reexporta desde acá para no tocar sus siete call sites.
 */
const DATE_LOCALE_MAP: Record<string, string> = {
  es: 'es-UY',
  en: 'en-US',
  pt: 'pt-BR',
};

/**
 * El fallback es `es-UY` y no el idioma recibido: la app es de Uruguay y sus
 * tres idiomas están en el mapa, así que llegar acá significa que alguien pasó
 * algo inesperado — y ahí es mejor una fecha uruguaya que una cadena que
 * `toLocaleDateString` podría rechazar con RangeError.
 */
export function getDateLocale(lang: string): string {
  return DATE_LOCALE_MAP[lang] ?? 'es-UY';
}
