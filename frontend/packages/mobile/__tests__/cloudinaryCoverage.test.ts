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
const EXENTOS: Array<{ archivo: string; expr: string; motivo: string }> = [
  {
    archivo: 'components/publish/StrayFormStep.tsx',
    expr: 'uri',
    motivo: 'Preview local del ImagePicker (file://). No sale de Cloudinary.',
  },
  {
    archivo: 'components/publish/AdoptionFormStep.tsx',
    expr: 'uri',
    motivo: 'Preview local del ImagePicker (file://). No sale de Cloudinary.',
  },
  {
    archivo: 'app/pets/register.tsx',
    expr: 'uri',
    motivo: 'Preview local del ImagePicker (file://). No sale de Cloudinary.',
  },
];

const imagenes = archivos(RAIZ).flatMap((abs) => {
  const rel = path.relative(RAIZ, abs).replace(/\\/g, '/');
  return fuentes(fs.readFileSync(abs, 'utf8')).map((expr) => ({ rel, expr }));
});

describe('cobertura de miniaturas de Cloudinary (mobile)', () => {
  it('el barrido encontró imágenes — si baja, dejó de medir', () => {
    // Contra el total de IMÁGENES. Si el escáner deja de reconocer una forma,
    // el número cae y esto lo delata en vez de cubrir menos en silencio.
    expect(imagenes.length).toBeGreaterThan(14);
  });

  it('toda <Image> usa el helper, o está exenta con motivo escrito', () => {
    const exenta = (rel: string, expr: string) =>
      EXENTOS.some((e) => e.archivo === rel && e.expr === expr);

    const crudas = imagenes
      .filter(({ rel, expr }) => !USA_HELPER.test(expr) && !exenta(rel, expr))
      .map(({ rel, expr }) => `${rel}  ->  source={{ ${expr} }}`);

    expect(crudas).toEqual([]);
  });

  it('ninguna exención quedó obsoleta', () => {
    // Una allowlist que nombra cosas que ya no existen es peor que ninguna: da
    // la sensación de estar al día mientras deja de cubrir.
    const vivas = new Set(imagenes.map(({ rel, expr }) => `${rel}|${expr}`));
    const muertas = EXENTOS.filter((e) => !vivas.has(`${e.archivo}|${e.expr}`)).map(
      (e) => `${e.archivo} -> ${e.expr}`
    );
    expect(muertas).toEqual([]);
  });

  it('cada exención trae un motivo de verdad, no un placeholder', () => {
    for (const e of EXENTOS) {
      expect(e.motivo.trim().length).toBeGreaterThan(30);
    }
  });
});
