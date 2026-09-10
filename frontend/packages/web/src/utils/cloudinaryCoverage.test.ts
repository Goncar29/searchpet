import { describe, it, expect } from 'vitest';

/**
 * Ningún `<img src={...}>` de la web sirve una foto de Cloudinary sin achicar.
 *
 * POR QUÉ EXISTE: `CLAUDE.md` afirmaba, desde el PR #171, que "no queda una sola
 * foto de Cloudinary servida cruda, ni en web ni en mobile". Era falso. Nada
 * obligaba a una pantalla nueva a usar el helper, así que en los meses
 * siguientes aparecieron TRES consumidores crudos —`StoryCard` (las dos ramas),
 * `ReportPopup` y `LostPetStep`— y ninguno rompió nada: una foto sin achicar se
 * ve idéntica, sólo gasta distinto. El bandwidth de Cloudinary es el recurso que
 * se paga (regla #55), así que el único síntoma es la factura.
 *
 * Una afirmación que nadie verifica envejece hasta ser mentira. Esto la
 * convierte en algo que se rompe solo.
 */

// `import.meta.glob` y no `fd`/`rg`: el barrido tiene que correr en CI sin
// depender de qué binarios haya instalados, y `eager` lo resuelve en build time.
const fuentes = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Usa el helper en cualquiera de sus tres formas. */
const USA_HELPER = /cloudinary(CardThumb|Fit|Thumb)\s*\(/;
/** Un `src` con expresión, o sea dinámico. `src="/icons/x.png"` no cuenta. */
const SRC_DINAMICO = /<img[^>]*\ssrc=\{/s;

/**
 * Los que pueden servir una URL sin pasarla por el helper, CON el motivo.
 *
 * Una entrada acá es una decisión, no una excepción de trámite: si agregás una,
 * escribí por qué, porque el próximo que lea esta lista va a confiar en ella.
 */
const EXENTOS: Record<string, string> = {
  '../components/PhotoBanner.tsx':
    'No se mira en pantalla: lo rasterizan PdfFlyerButton (volante IMPRESO) y ' +
    'SharePanel (story 1080x1920). Los dos necesitan la resolución del original, ' +
    'y el costo se paga una vez por descarga, no por vista.',
  '../components/publish/AdoptionFormStep.tsx':
    'Preview local de un archivo recién elegido (URL.createObjectURL). No sale de Cloudinary.',
  '../components/publish/StrayFormStep.tsx':
    'Preview local de un archivo recién elegido (URL.createObjectURL). No sale de Cloudinary.',
  '../pages/CreatePetPage.tsx':
    'Preview local de un archivo recién elegido (URL.createObjectURL). No sale de Cloudinary.',
};

describe('cobertura de miniaturas de Cloudinary', () => {
  const conImagen = Object.entries(fuentes).filter(
    ([ruta, src]) => !ruta.endsWith('.test.tsx') && SRC_DINAMICO.test(src)
  );

  it('el barrido encontró archivos — si da vacío dejó de medir', () => {
    // Sin esto, un glob mal escrito hace que el test pase revisando CERO
    // archivos, que es la forma de falla contra la que existe todo esto.
    expect(conImagen.length, 'el glob no matcheó ningún .tsx con <img src={...}>').toBeGreaterThan(15);
  });

  it('todo consumidor de fotos usa el helper, o está exento con motivo escrito', () => {
    const crudos = conImagen
      .filter(([ruta, src]) => !USA_HELPER.test(src) && !(ruta in EXENTOS))
      .map(([ruta]) => ruta);

    expect(
      crudos,
      `Estos archivos dibujan un <img src={...}> sin pasar por cloudinaryThumb/` +
        `cloudinaryCardThumb/cloudinaryFit:\n  ${crudos.join('\n  ')}\n\n` +
        `Si la URL sale de Cloudinary, miniaturizala (ver LISTING_SIZES). Si NO ` +
        `sale de Cloudinary (un preview local con URL.createObjectURL) o necesita ` +
        `la resolución del original, sumalo a EXENTOS con el motivo escrito.`
    ).toEqual([]);
  });

  it('ningún exento quedó obsoleto', () => {
    // Una allowlist que nombra archivos borrados o ya arreglados es peor que
    // ninguna: da la sensación de estar al día mientras deja de cubrir.
    const rutas = new Set(Object.keys(fuentes));
    const fantasmas = Object.keys(EXENTOS).filter((r) => !rutas.has(r));
    expect(fantasmas, `EXENTOS nombra archivos que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);

    const yaNoHaceFalta = Object.keys(EXENTOS).filter(
      (r) => rutas.has(r) && USA_HELPER.test(fuentes[r])
    );
    expect(
      yaNoHaceFalta,
      `estos ya usan el helper y sobran en EXENTOS: ${yaNoHaceFalta.join(', ')}`
    ).toEqual([]);
  });

  it('cada exento trae un motivo de verdad, no un placeholder', () => {
    for (const [ruta, motivo] of Object.entries(EXENTOS)) {
      expect(motivo.trim().length, `${ruta} está exento sin explicar por qué`).toBeGreaterThan(30);
    }
  });
});
