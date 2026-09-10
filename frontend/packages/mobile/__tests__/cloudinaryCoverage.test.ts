import fs from 'node:fs';
import path from 'node:path';

/**
 * Ninguna `<Image>` de la app nativa sirve una foto de Cloudinary sin achicar.
 *
 * ES EL GEMELO DE `web/src/utils/cloudinaryCoverage.test.ts`, y existe por lo
 * mismo: `CLAUDE.md` afirmaba desde el PR #171 que "no queda una sola foto de
 * Cloudinary servida cruda, **ni en web ni en mobile**". En web resultó falso —
 * habían aparecido tres consumidores crudos y nadie se enteró, porque una foto
 * sin achicar se ve idéntica y sólo gasta distinto.
 *
 * En mobile la auditoría dio limpio: 17 `<Image>`, 14 con helper y 3 previews
 * locales del ImagePicker. Pero "hoy está bien" no es una garantía: nada
 * obligaba a una pantalla nueva a usar `cloudinaryThumb`, que es exactamente
 * como web se desvió. Esto convierte la afirmación en algo que se rompe solo.
 *
 * Acá pesa más que en web: el bandwidth de Cloudinary sale de un pool
 * compartido entre las dos apps, y `constants/imageSizes.ts` documenta que en
 * una lista de veinte avatares de 44 dp servir el original son 2,1 MB.
 *
 * LO QUE NO CUBRE: sólo mira `<Image source={{ uri: ... }}>`. Una foto servida
 * por otro camino —un `ImageBackground` con la fuente armada en una variable,
 * por ejemplo— no la ve.
 */

const RAIZ = path.join(__dirname, '..');
const IGNORAR = new Set(['node_modules', '.expo', 'android', 'ios', '__tests__']);
const USA_HELPER = /cloudinary(CardThumb|Fit|Thumb)\s*\(/;

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivos(p, acc);
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) acc.push(p);
  }
  return acc;
}

/**
 * Cada `source={{ ... }}` de un `<Image>`, con su contenido.
 *
 * Se ancla en `source={{` y NO en `uri:` suelto, y esa es la diferencia entre
 * medir la cosa y medir un proxy: `uri:` aparece además en firmas de tipo
 * (`(uri: string) => ...`) y en los argumentos de las mutaciones de subida
 * (`uploadPhoto.mutateAsync({ petId, uri })`), que no pintan nada. Un barrido
 * sobre `uri:` reportaba 5 "crudas" de las cuales 3 eran ruido.
 */
function fuentes(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf('source={{', i)) !== -1) {
    let j = i + 9;
    let depth = 2; // las dos llaves de `{{`
    let quote: string | null = null;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (quote) {
        if (c === quote && src[j - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    out.push(src.slice(i + 9, j - 2).replace(/\s+/g, ' ').trim());
    i = j;
  }
  return out;
}

/**
 * Las imágenes que pueden servir su URI sin el helper, CON el motivo.
 *
 * La clave es archivo + expresión, no el archivo: una exención tiene que
 * nombrar QUÉ imagen se perdona, o vuelve a tapar a sus vecinas. (En web la
 * primera versión de este guard era por archivo y daba verde con el defecto que
 * venía a cerrar.)
 */
const EXENTOS: Array<{ archivo: string; expr: string; veces: number; motivo: string }> = [
  {
    archivo: 'components/publish/StrayFormStep.tsx',
    expr: 'uri',
    veces: 1,
    motivo: 'Preview local del ImagePicker (file://). No sale de Cloudinary.',
  },
  {
    archivo: 'components/publish/AdoptionFormStep.tsx',
    expr: 'uri',
    veces: 1,
    motivo: 'Preview local del ImagePicker (file://). No sale de Cloudinary.',
  },
  {
    archivo: 'app/pets/register.tsx',
    expr: 'uri',
    veces: 1,
    motivo: 'Preview local del ImagePicker (file://). No sale de Cloudinary.',
  },
];

/**
 * El VALOR de la clave `uri` dentro del objeto de `source`.
 *
 * Hace falta separarlo del objeto entero antes de buscar ramas: `ramas()` parte
 * por `:`, y el `:` de `uri:` no es un ternario. Sin esto las catorce imágenes
 * correctas se reportaban como crudas — un falso positivo que, de haberse
 * "arreglado" relajando la regla, habría dejado el guard sin filo.
 *
 * Con el shorthand `{ uri }` el valor ES el identificador `uri`.
 */
function valorUri(objeto: string): string {
  const m = objeto.match(/(^|[,{\s])uri\s*:/);
  if (!m) return objeto.trim(); // shorthand `{ uri }`
  let j = (m.index ?? 0) + m[0].length;
  let depth = 0;
  let quote: string | null = null;
  const desde = j;
  for (; j < objeto.length; j++) {
    const c = objeto[j];
    if (quote) {
      if (c === quote && objeto[j - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) break;
  }
  return objeto.slice(desde, j).trim();
}

/**
 * Las ramas de una expresión, partida por los operadores que eligen entre
 * valores (`? :`, `||`, `??`) al nivel más externo.
 *
 * Existe porque probar el helper contra la expresión ENTERA deja pasar
 * `uri: foto ? cloudinaryThumb(foto, X) : perfil.photo_url`: hay una llamada al
 * helper, el regex la encuentra, y la otra rama sirve el original igual. Es la
 * misma clase que el bug por-archivo del gemelo de web, un nivel más adentro.
 */
function ramas(expr: string): string[] {
  const out: string[] = [];
  let actual = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === quote && expr[i - 1] !== '\\') quote = null;
      actual += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; actual += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0) {
      // `?.` y `??` NO son ternarios: el primero es optional chaining y el
      // segundo un nullish que sí separa ramas pero ocupa dos caracteres.
      if (c === '?' && expr[i + 1] === '?') { out.push(actual); actual = ''; i++; continue; }
      if (c === '?' && expr[i + 1] === '.') { actual += c; continue; }
      if (c === '?' || c === ':') { out.push(actual); actual = ''; continue; }
      if (c === '|' && expr[i + 1] === '|') { out.push(actual); actual = ''; i++; continue; }
    }
    actual += c;
  }
  out.push(actual);
  return out.map((r) => r.trim()).filter((r) => r.length > 0);
}

/**
 * Una rama que no puede estar sirviendo una URL de Cloudinary.
 *
 * Literales, `undefined`/`null` y los identificadores que el propio componente
 * recibe ya resueltos. Todo lo demás —un acceso a propiedad tipo
 * `perfil.photo_url`— tiene que pasar por el helper.
 */
function inofensiva(rama: string): boolean {
  return /^(['"`].*['"`]|undefined|null)$/.test(rama);
}

const imagenes = archivos(RAIZ).flatMap((abs) => {
  const rel = path.relative(RAIZ, abs).replace(/\\/g, '/');
  return fuentes(fs.readFileSync(abs, 'utf8')).map((expr) => ({ rel, expr }));
});

describe('cobertura de miniaturas de Cloudinary (mobile)', () => {
  // OJO CON LA FORMA DE ESTAS ASERCIONES: acá corre **Jest**, no Vitest, y Jest
  // IGNORA el segundo argumento de `expect` (el mensaje). El gemelo de web lo
  // usa, así que copiar su forma daba un guard que al fallar sólo dice
  // "expected [...] to equal []": nombra el archivo, pero no dice qué hacer, y
  // el que se lo encuentre en CI dentro de seis meses tiene que reconstruir el
  // motivo. Por eso el mensaje va DENTRO del valor comparado, que Jest sí
  // imprime en el diff.
  // ACUERDO ENTRE DOS MEDICIONES, y no un umbral con holgura. La versión
  // anterior era `imagenes.length > 14` con 17 imágenes, o sea que toleraba
  // perder TRES — exactamente la ceguera que decía detectar. Acá el escáner se
  // compara contra un conteo crudo e independiente: si ve menos `source={{` de
  // los que hay en el texto, es que dejó de reconocer una forma.
  it('el escáner ve TODOS los source={{ que hay en el árbol', () => {
    const crudo = archivos(RAIZ).reduce(
      (n, abs) => n + (fs.readFileSync(abs, 'utf8').match(/source=\{\{/g) ?? []).length,
      0
    );
    const veredicto =
      imagenes.length === crudo
        ? 'ok'
        : `el escáner extrajo ${imagenes.length} fuentes pero en el texto hay ${crudo} ` +
          'ocurrencias de source={{ — se le escapó alguna forma, revisá fuentes().';
    expect(veredicto).toBe('ok');
  });

  it('toda <Image> usa el helper, o está exenta con motivo escrito', () => {
    // El conteo POR PAR importa: con la clave `(archivo, expr)` sola, y siendo
    // `uri` la expresión más probable de esos archivos, una exención perdonaba
    // TODAS las imágenes del archivo que la repitieran. Verificado duplicando
    // la línea exenta de `register.tsx`: la suite seguía verde. Declarar cuántas
    // se perdonan hace que la copia número dos falle.
    const usadas = new Map<string, number>();
    const exenta = (rel: string, expr: string) => {
      const e = EXENTOS.find((x) => x.archivo === rel && x.expr === expr);
      if (!e) return false;
      const clave = `${rel}|${expr}`;
      const vistas = (usadas.get(clave) ?? 0) + 1;
      usadas.set(clave, vistas);
      return vistas <= e.veces;
    };

    const crudas = imagenes
      .filter(({ rel, expr }) => {
        // Cada rama por separado: una llamada al helper en el lado verdadero de
        // un ternario no cubre el falso.
        const sinCubrir = ramas(valorUri(expr)).filter((r) => !USA_HELPER.test(r) && !inofensiva(r));
        return sinCubrir.length > 0 && !exenta(rel, expr);
      })
      .map(({ rel, expr }) => `${rel}  ->  source={{ ${expr} }}`);

    const veredicto =
      crudas.length === 0
        ? 'ninguna'
        : `Estas <Image> sirven su URI sin pasar por cloudinaryThumb:\n  ${crudas.join('\n  ')}\n\n` +
          `Si la URI sale de Cloudinary, achicala: elegí el tamaño en ` +
          `constants/imageSizes.ts (IMAGE_SIZES para cajas cuadradas, IMAGE_BOXES ` +
          `para las apaisadas) y NO escribas números sueltos.\n` +
          `Si NO sale de Cloudinary —un preview del ImagePicker, un asset local—, ` +
          `sumala a EXENTOS con el motivo escrito.`;

    expect(veredicto).toBe('ninguna');
  });

  it('ninguna exención quedó obsoleta', () => {
    // Una allowlist que nombra cosas que ya no existen es peor que ninguna: da
    // la sensación de estar al día mientras deja de cubrir.
    const vivas = new Set(imagenes.map(({ rel, expr }) => `${rel}|${expr}`));
    const muertas = EXENTOS.filter((e) => !vivas.has(`${e.archivo}|${e.expr}`)).map(
      (e) => `${e.archivo} -> source={{ ${e.expr} }}`
    );

    const veredicto =
      muertas.length === 0
        ? 'ninguna'
        : `EXENTOS nombra imágenes que ya no existen o que cambiaron de expresión:\n  ` +
          `${muertas.join('\n  ')}\n\nSacá esas entradas: una allowlist que envejece ` +
          `da la sensación de estar al día mientras deja de cubrir.`;

    expect(veredicto).toBe('ninguna');
  });

  it('cada exención trae un motivo de verdad, no un placeholder', () => {
    const flojos = EXENTOS.filter((e) => e.motivo.trim().length <= 30).map((e) => e.archivo);
    const veredicto =
      flojos.length === 0
        ? 'ninguna'
        : `estas exenciones no explican por qué lo son: ${flojos.join(', ')}`;
    expect(veredicto).toBe('ninguna');
  });
});
