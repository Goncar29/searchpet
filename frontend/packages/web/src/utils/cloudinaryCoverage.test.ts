import { describe, it, expect } from 'vitest';

/**
 * Ningún `<img src={...}>` de la web sirve una foto de Cloudinary sin achicar.
 *
 * POR QUÉ EXISTE: `CLAUDE.md` afirmaba, desde el PR #171, que "no queda una sola
 * foto de Cloudinary servida cruda". Era falso: aparecieron tres consumidores
 * crudos y ninguno rompió nada, porque una foto sin achicar se ve idéntica y
 * sólo gasta distinto. El bandwidth es el recurso que se paga (regla #55), así
 * que el único síntoma es la factura.
 *
 * POR QUÉ ES POR `<img>` Y NO POR ARCHIVO — la primera versión de este test
 * preguntaba "¿este ARCHIVO menciona el helper?", y con eso una sola llamada en
 * cualquier parte blanqueaba todas las demás imágenes del archivo. Era ciego al
 * defecto exacto que vino a cerrar: `StoryCard` tiene DOS `<img>`, el panel ya
 * usaba el helper, y con la rama overlay servida cruda el test daba VERDE.
 *
 * Lo peor no fue el bug sino la verificación: el rojo se comprobó revirtiendo
 * `ReportPopup`, un archivo de UNA sola imagen, donde revertir borra la única
 * llamada al helper. *Se eligió el sujeto que hacía pasar la prueba.* Medido
 * después: por archivo se veían 26 unidades, por `<img>` son 38, y tres crudas
 * (`CreateStoryPage`, `EditPetPage`, `HomePage`) eran invisibles.
 *
 * LO QUE ESTE BARRIDO **NO** CUBRE, para que nadie lea de más: sólo mira
 * `<img src={...}>` en `.tsx`. Una foto servida por `background-image` o por un
 * `<image href>` de SVG no la ve — los dos consumidores conocidos de esa clase
 * tienen su propia aserción abajo, pero un tercero nuevo pasaría sin ser visto.
 */

// `import.meta.glob` y no `fd`/`rg`: el barrido tiene que correr en CI sin
// depender de qué binarios haya instalados, y `eager` lo resuelve en build time.
const fuentes = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const USA_HELPER = /cloudinary(CardThumb|Fit|Thumb)\s*\(/;

/**
 * Extrae cada tag `<img ...>` completo.
 *
 * Un escáner y no un regex, porque `/<img[^>]*src=\{/` **no puede cruzar un
 * `>`**: con `<img onError={(e) => ...} src={foto} />` —un patrón de lo más
 * común— el `=>` corta el match y la imagen desaparece del barrido *sin que
 * nada falle*, porque además deja de contar para el canario de abajo. Esto
 * cuenta llaves y comillas, así que los `>` dentro de una expresión o de un
 * string no terminan el tag.
 */
function imgTags(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf('<img', i)) !== -1) {
    let j = i + 4;
    let depth = 0;
    let quote: string | null = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) {
        if (c === quote && src[j - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      j++;
    }
    out.push(src.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

/** La expresión de adentro de `src={...}`, o null si el `src` es un literal. */
function srcExpr(tag: string): string | null {
  const m = tag.indexOf('src={');
  if (m === -1) return null;
  let j = m + 5;
  let depth = 1;
  while (j < tag.length && depth > 0) {
    if (tag[j] === '{') depth++;
    else if (tag[j] === '}') depth--;
    j++;
  }
  return tag.slice(m + 5, j - 1).replace(/\s+/g, ' ').trim();
}

/**
 * Las imágenes que pueden servir una URL sin pasarla por el helper, CON motivo.
 *
 * La clave es el par archivo + expresión, no el archivo: una exención tiene que
 * nombrar exactamente QUÉ imagen se perdona, o vuelve a tapar a sus vecinas.
 */
const EXENTOS: Array<{ archivo: string; expr: string; motivo: string }> = [
  {
    archivo: '../components/PhotoBanner.tsx',
    expr: 'photoUrl',
    motivo:
      'Lo rasterizan PdfFlyerButton (volante que se IMPRIME) y SharePanel (story ' +
      '1080x1920): necesita la resolución del original, y una miniatura de listado ' +
      'degradaría el impreso. OJO: hoy el template se monta SIEMPRE, no al generar ' +
      '— ver el comentario del archivo, que explica el costo real.',
  },
  {
    archivo: '../components/publish/AdoptionFormStep.tsx',
    expr: 'url',
    motivo: 'Preview local de un archivo recién elegido (URL.createObjectURL). No sale de Cloudinary.',
  },
  {
    archivo: '../components/publish/StrayFormStep.tsx',
    expr: 'url',
    motivo: 'Preview local de un archivo recién elegido (URL.createObjectURL). No sale de Cloudinary.',
  },
  {
    archivo: '../pages/CreatePetPage.tsx',
    expr: 'url',
    motivo: 'Preview local de un archivo recién elegido (URL.createObjectURL). No sale de Cloudinary.',
  },
  {
    archivo: '../pages/CreateStoryPage.tsx',
    expr: 'photoPreview',
    motivo: 'Preview local: se libera con URL.revokeObjectURL. No sale de Cloudinary.',
  },
  {
    archivo: '../pages/EditPetPage.tsx',
    expr: 'previewURL',
    motivo: 'Preview local del archivo recién elegido. No sale de Cloudinary.',
  },
  {
    archivo: '../pages/HomePage.tsx',
    expr: 'HERO_IMAGE_SRC',
    motivo: "Asset propio servido desde public/ ('/hero.jpg'). No pasa por Cloudinary.",
  },
];

/** Todas las imágenes del proyecto, una entrada por `<img src={...}>`. */
const imagenes = Object.entries(fuentes)
  .filter(([ruta]) => !ruta.endsWith('.test.tsx'))
  .flatMap(([ruta, src]) =>
    imgTags(src)
      .map((tag) => srcExpr(tag))
      .filter((expr): expr is string => expr !== null)
      .map((expr) => ({ ruta, expr }))
  );

describe('cobertura de miniaturas de Cloudinary', () => {
  it('el barrido encontró imágenes — si baja, dejó de medir', () => {
    // Contra el total de IMÁGENES y no de archivos. Al pasar de archivo a `<img>`
    // el número saltó de 26 a 38: si vuelve a caer, el escáner dejó de ver
    // formas que antes veía, que es la falla que este canario cubre.
    expect(imagenes.length, 'el escáner no encontró <img src={...}>').toBeGreaterThan(30);
  });

  it('toda imagen usa el helper, o está exenta con motivo escrito', () => {
    const exenta = (ruta: string, expr: string) =>
      EXENTOS.some((e) => e.archivo === ruta && e.expr === expr);

    const crudas = imagenes
      .filter(({ ruta, expr }) => !USA_HELPER.test(expr) && !exenta(ruta, expr))
      .map(({ ruta, expr }) => `${ruta}  ->  src={${expr}}`);

    expect(
      crudas,
      `Estas imágenes sirven su URL sin pasar por cloudinaryThumb/` +
        `cloudinaryCardThumb/cloudinaryFit:\n  ${crudas.join('\n  ')}\n\n` +
        `Si la URL sale de Cloudinary, miniaturizala (ver LISTING_SIZES). Si NO ` +
        `sale de Cloudinary (un preview de URL.createObjectURL, un asset de ` +
        `public/) o necesita la resolución del original, sumala a EXENTOS con el ` +
        `motivo escrito.`
    ).toEqual([]);
  });

  it('ninguna exención quedó obsoleta', () => {
    // Una allowlist que nombra cosas que ya no existen es peor que ninguna: da la
    // sensación de estar al día mientras deja de cubrir.
    //
    // Se compara contra el par archivo+expresión REAL, no contra el archivo: con
    // granularidad de archivo, que una imagen vecina se arreglara marcaba la
    // exención como sobrante y obligaba a borrarla — y una vez borrada, la imagen
    // que sí seguía cruda pasaba en silencio.
    const vivas = new Set(imagenes.map(({ ruta, expr }) => `${ruta}|${expr}`));
    const muertas = EXENTOS.filter((e) => !vivas.has(`${e.archivo}|${e.expr}`)).map(
      (e) => `${e.archivo} -> src={${e.expr}}`
    );
    expect(
      muertas,
      `EXENTOS nombra imágenes que ya no existen o que cambiaron de expresión:\n  ${muertas.join('\n  ')}`
    ).toEqual([]);
  });

  it('cada exención trae un motivo de verdad, no un placeholder', () => {
    for (const e of EXENTOS) {
      expect(
        e.motivo.trim().length,
        `${e.archivo} -> src={${e.expr}} está exenta sin explicar por qué`
      ).toBeGreaterThan(30);
    }
  });

  // Los consumidores que NO son `<img>` y por eso el barrido de arriba no ve.
  //
  // Se afirma LA CONSTRUCCIÓN CONCRETA y no "el archivo menciona el helper",
  // que es el error que este mismo commit vino a arreglar y que la primera
  // versión de este bloque reintrodujo tres funciones más abajo: `PetDetailPage`
  // sirve la MISMA foto dos veces —un `<img>` y el fondo borroso— así que con
  // granularidad de archivo se podía dejar el fondo crudo y el test seguía
  // verde, porque el `<img>` de al lado usaba el helper. Comprobado.
  const NO_IMG = [
    {
      archivo: '../pages/PetDetailPage.tsx',
      que: 'el fondo borroso, en background-image',
      // La llamada tiene que estar DENTRO del `url(...)`, no en cualquier parte.
      patrones: [/backgroundImage:\s*`url\(\$\{cloudinary(CardThumb|Fit|Thumb)\(/],
    },
    {
      archivo: '../components/map/rastroMarker.tsx',
      que: 'la foto del pin, en un <image href> de SVG',
      // Acá la URL se calcula en una variable y se interpola después, así que
      // hay que afirmar LAS DOS MITADES: que `thumb` sale del helper, y que el
      // href interpola `thumb` y no la URL cruda. Con una sola, cambiar la otra
      // pasa sin ser vista.
      patrones: [
        /const thumb = cloudinary(CardThumb|Fit|Thumb)\(/,
        /<image href="\$\{escaparHtml\(thumb\)\}"/,
      ],
    },
  ] as const;

  it('los consumidores que no son <img> siguen usando el helper', () => {
    for (const { archivo, que, patrones } of NO_IMG) {
      const src = fuentes[archivo];
      expect(src, `${archivo} ya no existe — actualizá esta lista`).toBeTypeOf('string');
      for (const p of patrones) {
        expect(
          p.test(src),
          `${archivo}: ${que} — dejó de coincidir con ${p}. Si la construcción ` +
            `cambió a propósito, actualizá el patrón; si dejó de usar el helper, ` +
            `esa imagen se está sirviendo cruda.`
        ).toBe(true);
      }
    }
  });
});
