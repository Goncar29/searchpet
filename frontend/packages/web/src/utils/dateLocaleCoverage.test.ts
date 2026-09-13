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
  // POR LÍNEAS ENTERAS, y no borrando desde el `//` hasta el fin de línea.
  //
  // La primera versión usaba `/(^|[^:])\/\/.*$/gm` y **se comía código real**:
  // con `const s = 'a // b'; const d = x.toLocaleDateString();` cortaba en el
  // `//` del STRING y el resto de la línea desaparecía del barrido. Medido, y
  // lo mismo con una regex que contenga `//`.
  //
  // Un guard ciego falla en silencio; uno ruidoso, no. Así que se elige el error
  // que se ve: acá sólo desaparece la línea cuyo PRIMER token es `//`, `/*` o
  // `*`, o sea un comentario de línea completa —la forma que usa este repo—. Un
  // comentario al final de una línea de código sobrevive y puede dar un falso
  // positivo, que es visible y se arregla; lo contrario no.
  // Los bloques `/* */` SÍ se rastrean como bloques y no por línea: los
  // comentarios largos de este repo son JSX (`{/* … */}`) y sus líneas
  // interiores empiezan con texto o con `-`, así que un filtro por línea no las
  // reconoce — y son justo las que explican estos patrones.
  //
  // Abrir un bloque falso desde un string sería el riesgo de esto, pero el
  // canario de abajo lo detecta: si el stripping se descontrola, el conteo de
  // llamadas CORRECTAS se desploma y el test se cae.
  let dentroDeBloque = false;
  return src
    .split('\n')
    .map((linea) => {
      if (dentroDeBloque) {
        if (linea.includes('*/')) dentroDeBloque = false;
        return '';
      }
      // SÓLO abre bloque un `/*` AL INICIO de la línea (o tras el `{` de un
      // comentario JSX). Ésa es la forma en que se escriben los comentarios
      // reales, y la restricción elimina de raíz el modo de falla peligroso: un
      // `/*` dentro de un string —`'algo /* raro'`— abría un bloque falso y
      // borraba EL RESTO DEL ARCHIVO del barrido, en silencio y sin que el
      // conteo global lo notara, porque los otros archivos lo sostenían.
      //
      // Se prefiere no reconocer un comentario raro (falso positivo, visible)
      // antes que dejar de revisar un archivo entero (falso negativo, mudo).
      const abreBloque = /^\s*\{?\s*\/\*/.test(linea);
      if (abreBloque && !linea.includes('*/')) {
        dentroDeBloque = true;
        return '';
      }
      if (abreBloque) return linea.replace(/\/\*[\s\S]*?\*\//g, '');
      return /^\s*\/\//.test(linea) ? '' : linea;
    })
    .join('\n');
}

/**
 * `Date` y NO `Number`: los patrones nombran `toLocaleDateString` y
 * `toLocaleTimeString` explícitamente en vez de un `toLocale(Date|Time)?String`
 * con el grupo opcional, que también matchea `Number.prototype.toLocaleString`.
 *
 * La diferencia importa por el MENSAJE: ante un `count.toLocaleString(
 * i18n.language)` el guard empujaría a usar `getDateLocale`, que para números es
 * el arreglo EQUIVOCADO — el docblock de arriba dice que ahí `i18n.language` es
 * lo correcto. Un guard que da la instrucción errónea es peor que uno ausente.
 *
 * PERO NOMBRARLOS ASÍ DEJABA AFUERA `toLocaleString` ENTERO, que es JUSTO la
 * forma de los únicos tres sitios con síntoma visible: `AdminsPage` y las dos
 * tablas de `FosterHomesAdminPage` muestran fecha **y hora**, y ahí `es` da
 * `15:04` contra `3:04 p. m.` de `es-UY`. Revertir cualquiera de los tres a un
 * `new Date(x).toLocaleString()` pelado dejaba el guard verde. O sea: el guard
 * cubría las formas sin consecuencia y era ciego a la que sí la tiene.
 *
 * La salida no es volver al grupo opcional —eso trae de vuelta a `Number`—, sino
 * ANCLAR en que la expresión hable de una fecha: `Date … .toLocaleString(`.
 *
 * LO QUE ESTE ANCLAJE NO VE, escrito para que nadie lo descubra a los golpes:
 * una fecha guardada en variable (`const d = new Date(x); … d.toLocaleString()`)
 * se le escapa, porque `Date` no está en esa línea. Los tres sitios reales
 * construyen la fecha inline, y aceptar `.toLocaleString(` a secas costaría
 * marcar todos los números — un falso positivo con la instrucción equivocada
 * pegada al lado.
 */
const MALAS = [
  { patron: /toLocale(Date|Time)String\(\s*\)/g, que: 'sin locale (usa el del navegador)' },
  { patron: /toLocale(Date|Time)String\(\s*['"`]/g, que: 'con un locale clavado' },
  { patron: /toLocale(Date|Time)String\(\s*i18n\.language\s*[,)]/g, que: 'con i18n.language sin el mapa' },

  // `[^;\n]*?` mantiene el match dentro de la MISMA sentencia y la misma línea,
  // así que `new Date(foo(x)).toLocaleString()` —con paréntesis anidados— entra,
  // y un `Date` que aparezca tres líneas más arriba no arrastra a un número.
  { patron: /Date\b[^;\n]*?\.toLocaleString\(\s*\)/g, que: 'sin locale (usa el del navegador)' },
  { patron: /Date\b[^;\n]*?\.toLocaleString\(\s*['"`]/g, que: 'con un locale clavado' },
  { patron: /Date\b[^;\n]*?\.toLocaleString\(\s*i18n\.language\s*[,)]/g, que: 'con i18n.language sin el mapa' },

  // La TERCERA forma de formatear una fecha, que el docblock de arriba promete
  // eliminar y hasta ahora nadie barría: `PetIdentityFields` armaba los nombres
  // de mes con `Intl.DateTimeFormat(i18n.language)`. Hoy `es` y `es-UY` dan los
  // mismos meses, así que no se veía — pero el invariante que este archivo
  // afirma era falso igual.
  //
  // `Intl.NumberFormat` sigue afuera a propósito (ver EXENTOS): formatea
  // números, y ahí `i18n.language` es lo correcto.
  { patron: /Intl\.DateTimeFormat\(\s*\)/g, que: 'sin locale (usa el del navegador)' },
  { patron: /Intl\.DateTimeFormat\(\s*['"`]/g, que: 'con un locale clavado' },
  { patron: /Intl\.DateTimeFormat\(\s*i18n\.language\s*[,)]/g, que: 'con i18n.language sin el mapa' },
];

/**
 * `Intl.NumberFormat` NO entra acá: formatea NÚMEROS, no fechas, y ahí
 * `i18n.language` es lo correcto —`ImpactPage` y el contador de historias lo
 * usan así—. Meterlos en el mismo barrido obligaría a exentarlos uno por uno
 * sin que ganaran nada.
 */
const EXENTOS: Array<{ archivo: string; motivo: string }> = [
  // Este mismo archivo NO va acá: el `.filter(!ruta.endsWith('.test.ts'))` de
  // abajo ya lo saca, así que la entrada nunca matcheaba. Una exención muerta se
  // lee como cobertura y no lo es.
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

  it('el barrido sigue VIENDO llamadas, no sólo leyendo archivos', () => {
    // Cuenta LLAMADAS y no archivos, y la diferencia es todo el guard: contando
    // archivos, si `sinComentarios()` se comiera el contenido —o si el glob
    // dejara de resolver— los archivos seguirían ahí, el canario seguiría verde,
    // y el barrido no encontraría nada. Un guard que revisa cero casos reporta
    // lo mismo que uno donde está todo bien.
    //
    // SE CUENTAN LOS `getDateLocale(`, NO las llamadas inline
    // `toLocale…(getDateLocale(`. La versión anterior contaba sólo la forma
    // inline, y eso la ponía en contra del propio consejo del guard: el mensaje
    // de abajo dice que una función a nivel de módulo reciba el locale POR
    // PARÁMETRO, y cada vez que alguien sigue ese consejo la llamada deja de ser
    // inline y el conteo BAJA. `GroupDetailPage`, `ProfilePage`,
    // `MonthlyImpactSection` e `ImpactPage` ya están así y no se contaban.
    //
    // Un canario que se desinfla a medida que el código adopta el patrón
    // recomendado termina fallando sobre código correcto — y eso enseña a subir
    // el umbral, que es como un guard muere.
    //
    // `getDateLocale(` lo escriben las DOS formas: la llamada inline y el call
    // site que pasa el locale por parámetro. Crece con la adopción en vez de
    // encogerse, y si el escáner deja de ver colapsa a cero igual.
    const buenas = Object.entries(fuentes)
      .filter(([ruta]) => !ruta.endsWith('.test.ts') && !ruta.endsWith('.test.tsx'))
      .reduce((n, [, src]) => n + (sinComentarios(src).match(/getDateLocale\(/g) ?? []).length, 0);

    expect(
      buenas,
      'el escáner no encontró ni una llamada correcta: dejó de ver el código ' +
        '(¿se rompió sinComentarios(), o cambió la forma de llamar al helper?)'
    ).toBeGreaterThan(10);
  });

  it('ninguna exención quedó obsoleta', () => {
    // Una allowlist que nombra archivos que ya no existen —o que ya no tienen la
    // llamada que justificaba la exención— es PEOR que ninguna: da la sensación
    // de estar al día mientras dejó de cubrir. Mismo guard que
    // `cloudinaryCoverage.test.ts`.
    const muertas = EXENTOS.filter(({ archivo }) => {
      const src = fuentes[archivo];
      if (src === undefined) return true;
      return !MALAS.some(({ patron }) => new RegExp(patron.source).test(sinComentarios(src)));
    }).map((e) => e.archivo);

    expect(
      muertas,
      `EXENTOS nombra archivos que ya no existen o que ya no formatean fechas ` +
        `fuera del helper:\n  ${muertas.join('\n  ')}\n\nSacalos de la lista.`
    ).toEqual([]);
  });

  // LA CAUSA, testeada directamente en vez de por sus consecuencias.
  //
  // Un `/*` dentro de un string abría un bloque falso y borraba EL RESTO DEL
  // ARCHIVO del barrido — en silencio, y sin que el conteo global lo notara,
  // porque los otros archivos lo sostenían. La primera versión de este test
  // buscaba las CONSECUENCIAS (líneas con código desaparecidas) y era ruidosa
  // por construcción: no puede distinguir una línea borrada dentro de un bloque
  // legítimo de una borrada por un bloque falso, así que marcaba prosa como
  // "…usa `id='report-reason'`;".
  //
  // Se testea la propiedad: sólo abre bloque un `/*` al inicio de la línea.
  it('un /* dentro de un string NO abre un bloque de comentario', () => {
    const codigo = [
      "const a = 1;",
      "const s = 'algo /* raro';",
      "const b = new Date().toLocaleDateString();",
    ].join('\n');

    const limpio = sinComentarios(codigo);

    expect(
      limpio,
      'el `/*` del string abrió un bloque falso y se comió el resto del archivo'
    ).toContain('toLocaleDateString()');
  });

  it('un bloque real SÍ se borra, incluidas sus líneas interiores', () => {
    const codigo = [
      "/**",
      " * toLocaleDateString() en prosa, que no debe contar.",
      " */",
      "const b = new Date().toLocaleDateString(getDateLocale(x));",
    ].join('\n');

    const limpio = sinComentarios(codigo);

    expect(limpio).not.toContain('en prosa');
    expect(limpio).toContain('getDateLocale(x)');
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
