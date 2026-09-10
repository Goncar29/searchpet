import { describe, it, expect } from 'vitest';

/**
 * Toda fecha de la web se formatea con el idioma de la APP, no con el del
 * navegador ni con un locale clavado.
 *
 * POR QUÉ EXISTE: web había derivado a TRES formas conviviendo, y ninguna
 * rompía nada visible por separado:
 *
 *   1. `toLocaleDateString('es-UY')`  — clavado: ignora el idioma elegido
 *   2. `toLocaleDateString()`         — el locale del NAVEGADOR, que no tiene
 *                                       por qué coincidir con el de la app
 *   3. `toLocaleDateString(i18n.language)` — casi bien, pero sin el mapa
 *
 * Mobile no había derivado porque tenía `getDateLocale` desde el principio.
 *
 * DÓNDE SE VE DE VERDAD, medido: para fechas solas `es` y `es-UY` son
 * idénticos, así que las formas 1 y 3 eran indistinguibles. La diferencia
 * aparece al mostrar HORA — `es` da `15:04` y `es-UY` da `3:04 p. m.` — y hay
 * dos lugares que muestran hora, los dos en el panel admin, que usaban la
 * forma 2. O sea: el síntoma visible estaba en la forma que nadie había
 * anotado como problema.
 */

const fuentes = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Las llamadas a `toLocale*` que NO pasan por el helper.
 *
 * Cubre las tres formas malas de una sola vez: sin argumento, con un literal, o
 * con `i18n.language` pelado. Lo único que se acepta es `getDateLocale(...)`.
 */
/**
 * Saca comentarios antes de barrer.
 *
 * No es cosmético: los comentarios de este repo EXPLICAN estos mismos patrones
 * —"`i18n.language` y no `toLocaleString()` pelado…"— así que sin esto el guard
 * se reporta a sí mismo. La primera corrida marcó `StoryCard` y `StoriesPage`
 * como infractores por el texto que justifica que estén bien.
 *
 * Y el modo de falla es peor que el ruido: un guard que grita sobre casos
 * correctos entrena a la gente a ignorarlo.
 */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const MALAS = [
  { patron: /toLocale(Date|Time)?String\(\s*\)/g, que: 'sin locale (usa el del navegador)' },
  { patron: /toLocale(Date|Time)?String\(\s*['"`]/g, que: 'con un locale clavado' },
  { patron: /toLocale(Date|Time)?String\(\s*i18n\.language\s*[,)]/g, que: 'con i18n.language sin el mapa' },
];

/**
 * `Intl.NumberFormat` NO entra acá: formatea NÚMEROS, no fechas, y ahí
 * `i18n.language` es lo correcto —`ImpactPage` y el contador de historias lo
 * usan así—. Meterlos en el mismo barrido obligaría a exentarlos uno por uno
 * sin que ganaran nada.
 */
const EXENTOS: Array<{ archivo: string; motivo: string }> = [
  {
    archivo: '../utils/dateLocaleCoverage.test.ts',
    motivo: 'Este mismo archivo: los patrones de arriba contienen el texto que busca.',
  },
  {
    archivo: '../pages/HomePage.tsx',
    motivo:
      "`toLocaleDateString('en-CA')` NO es presentación: es el truco para obtener " +
      'la fecha LOCAL en formato YYYY-MM-DD, que es lo que `en-CA` produce. ' +
      'Traducirlo rompe la comparación que hace con ese string.',
  },
  {
    archivo: '../components/PdfFlyerButton.tsx',
    motivo:
      'El volante está ENTERO en español fijo —"¡MASCOTA PERDIDA!", "SearchPet — ' +
      'Ayudamos a reunir mascotas"— porque se imprime y se pega en la calle, en ' +
      'Uruguay. Traducir sólo la fecha dejaría un documento en dos idiomas.',
  },
];

describe('cobertura de locale en fechas (web)', () => {
  const hallazgos = Object.entries(fuentes)
    .filter(([ruta]) => !ruta.endsWith('.test.ts') && !ruta.endsWith('.test.tsx'))
    .filter(([ruta]) => !EXENTOS.some((e) => e.archivo === ruta))
    .flatMap(([ruta, src]) =>
      MALAS.flatMap(({ patron, que }) =>
        [...sinComentarios(src).matchAll(patron)].map(
          (m) => `${ruta}  ->  ${m[0].trim()}  (${que})`
        )
      )
    );

  it('el barrido leyó archivos — si da vacío, dejó de medir', () => {
    // Sin esto, un glob mal escrito hace que el test pase revisando CERO
    // archivos, que es la forma de falla contra la que existe todo esto.
    expect(Object.keys(fuentes).length).toBeGreaterThan(50);
  });

  it('ninguna fecha se formatea sin getDateLocale', () => {
    expect(
      hallazgos,
      `Estas llamadas no siguen el idioma de la app:\n  ${hallazgos.join('\n  ')}\n\n` +
        `Usá getDateLocale(i18n.language) de @shared/utils/dateLocale. Si la ` +
        `función vive a nivel de módulo y no puede leer el hook, pasale el locale ` +
        `por parámetro (ver formatDate en GroupDetailPage).`
    ).toEqual([]);
  });
});
