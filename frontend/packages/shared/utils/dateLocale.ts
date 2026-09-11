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
/**
 * Un locale ya mapeado, listo para `toLocaleDateString`.
 *
 * ES UN TIPO Y NO UN `string` A SECAS PORQUE EL REGEX NO ALCANZA. El barrido de
 * `dateLocaleCoverage.test.ts` sólo ve las llamadas inline: en cuanto el locale
 * viaja por una prop (`<Badge language={i18n.language}>`) o por un parámetro
 * (`formatLastSeen(t, iso, locale)`), el guard queda ciego — y se descubrió que
 * SIETE sitios lo evadían así mientras el test daba verde. Peor: el mensaje de
 * error del propio guard recomendaba pasar el locale por parámetro, o sea
 * prescribía la forma de evadirlo.
 *
 * Con un tipo distinguible, quien exige un `DateLocale` no acepta el
 * `i18n.language` pelado, y el error aparece en el borde exacto donde está el
 * problema. Lo que un regex no puede seguir, el compilador sí.
 */
export type DateLocale = string & { readonly __dateLocale: unique symbol };

const DATE_LOCALE_MAP: Record<string, DateLocale> = {
  es: 'es-UY' as DateLocale,
  en: 'en-US' as DateLocale,
  pt: 'pt-BR' as DateLocale,
};

/**
 * El fallback es `es-UY` y no el idioma recibido: la app es de Uruguay y sus
 * tres idiomas están en el mapa, así que llegar acá significa que alguien pasó
 * algo inesperado — y ahí es mejor una fecha uruguaya que una cadena que
 * `toLocaleDateString` podría rechazar con RangeError.
 */
export function getDateLocale(lang: string): DateLocale {
  return DATE_LOCALE_MAP[lang] ?? ('es-UY' as DateLocale);
}
