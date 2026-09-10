import { describe, it, expect } from 'vitest';
// `?raw` de Vite y NO `readFileSync(new URL(..., import.meta.url))`: bajo vitest
// ese `import.meta.url` no es scheme `file:` y tira "The URL must be of scheme
// file". Esto además no depende del cwd desde el que se corran los tests.
import storiesPageSource from '../pages/StoriesPage.tsx?raw';
import storyCardSource from '../components/StoryCard.tsx?raw';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    )
    .sort();
}

function resolve(dict: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) =>
      acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
    dict
  );
}

describe('stories — paridad de claves en los tres idiomas', () => {
  it('en tiene exactamente las mismas claves que es', () => {
    expect(flatten(en.stories)).toEqual(flatten(es.stories));
  });

  it('pt tiene exactamente las mismas claves que es', () => {
    expect(flatten(pt.stories)).toEqual(flatten(es.stories));
  });

  // Una traducción vacía no es una clave faltante: pasa la comparación de
  // arriba y en pantalla se ve un hueco. Ningún test de componente lo puede
  // ver, porque esos mockean `t` devolviendo la clave.
  it('ninguna traducción quedó vacía', () => {
    for (const [lang, dict] of [
      ['es', es],
      ['en', en],
      ['pt', pt],
    ] as const) {
      const walk = (o: Record<string, unknown>, path = '') => {
        for (const [k, v] of Object.entries(o)) {
          if (v !== null && typeof v === 'object') walk(v as Record<string, unknown>, `${path}${k}.`);
          else expect(String(v).trim(), `${lang}.stories.${path}${k}`).not.toBe('');
        }
      };
      walk(dict.stories as unknown as Record<string, unknown>);
    }
  });

  it('los placeholders sobreviven la traducción', () => {
    for (const [lang, dict] of [
      ['es', es],
      ['en', en],
      ['pt', pt],
    ] as const) {
      for (const key of ['likeCount_one', 'likeCount_other']) {
        expect(
          resolve(dict.stories as unknown as Record<string, unknown>, key),
          `${lang}.stories.${key}`
        ).toContain('{{count}}');
      }
    }
  });
});

// LO QUE ESTE BLOQUE AGREGA sobre la paridad de arriba: comparar en/pt contra es
// NO ve una clave que falta en LOS TRES. Ese caso —escribir `t('stories:ctaTitle')`
// cuando el locale dice `cta.title`— sólo lo caza leyendo los call sites reales.
describe('stories — las claves que la pantalla usa existen de verdad', () => {
  // DOS fuentes con DOS formas distintas, y esa asimetría es el punto:
  //
  // - `StoriesPage` hace `useTranslation(['stories', 'common'])`, así que
  //   convive con otro namespace y sus llamadas van prefijadas: `t('stories:x')`.
  // - `StoryCard` hace `useTranslation('stories')` y llama SIN prefijo:
  //   `t('like')`. Ahí todo `t(` es de este namespace.
  //
  // Barrer las dos con el mismo regex dejaría fuera una de las dos mitades sin
  // que nada falle.
  const EN_PAGINA = /\bt\(\s*'stories:([a-zA-Z0-9_.]+)'/g;
  const EN_TARJETA = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;

  const usadas = [
    ...[...storiesPageSource.matchAll(EN_PAGINA)].map((m) => m[1]),
    ...[...storyCardSource.matchAll(EN_TARJETA)].map((m) => m[1]),
  ].sort();

  it('el barrido vio TODAS las llamadas de las DOS fuentes', () => {
    // La tarjeta: contra el total de `t('`, porque ahí sólo vive este namespace.
    const candidatasTarjeta = [...storyCardSource.matchAll(/\bt\(\s*'/g)].length;
    expect(
      [...storyCardSource.matchAll(EN_TARJETA)].length,
      'una llamada de StoryCard quedó fuera del barrido'
    ).toBe(candidatasTarjeta);

    // La página NO se puede contar igual: convive con `common`, así que un
    // `t('common:x')` no debe barrerse. Se cuentan sólo las que nombran este
    // namespace, pero **en cualquier comilla** — más ancho que el extractor, que
    // sólo lee comilla simple. Ésa es la única forma de que el guard vea lo que
    // el extractor NO ve: con `t("stories:cta.title")` en comillas dobles,
    // `EN_PAGINA` matchea una clave menos y sin esto la suite quedaba verde
    // cubriendo menos — exactamente el modo de falla que este test promete
    // cerrar.
    const candidatasPagina = [...storiesPageSource.matchAll(/\bt\(\s*['"`]stories:/g)].length;
    expect(
      [...storiesPageSource.matchAll(EN_PAGINA)].length,
      'una llamada de StoriesPage quedó fuera del barrido (¿comillas dobles o backtick?)'
    ).toBe(candidatasPagina);

    // Y contra el total de las dos, no contra un número mágico: `> 6` lo
    // satisfacía la tarjeta sola, así que las claves de la página podían
    // desaparecer del barrido sin que nada fallara.
    expect(usadas.length, 'el barrido dejó de matchear').toBe(
      candidatasTarjeta + candidatasPagina
    );
  });

  it('cada clave usada existe en los tres idiomas', () => {
    for (const [lang, dict] of [
      ['es', es],
      ['en', en],
      ['pt', pt],
    ] as const) {
      const ns = dict.stories as unknown as Record<string, unknown>;
      for (const key of usadas) {
        // Una clave PLURAL no existe con su nombre pelado: i18next la resuelve a
        // `<key>_one` / `<key>_other` según el `count`. `likeCount` es así, y sin
        // esta rama sería un falso positivo del barrido, no un defecto.
        //
        // Exigir las DOS formas no es de más: con sólo `_one` en el locale, un
        // conteo de 2 cae al fallback y muestra "2 me gusta" en singular.
        if (typeof resolve(ns, key) === 'string') continue;

        const one = resolve(ns, `${key}_one`);
        const other = resolve(ns, `${key}_other`);
        expect(
          typeof one === 'string' && typeof other === 'string',
          `${lang}.stories.${key} — la usan StoriesPage/StoryCard y no está en el locale ` +
            `(ni como clave directa ni como plural _one/_other)`
        ).toBe(true);
      }
    }
  });

  // El namespace tiene que estar registrado en los TRES bloques de
  // `i18n/index.ts`, o la pantalla renderiza las claves crudas (regla #21). Los
  // asserts de arriba leen los JSON directamente, así que ninguno lo vería.
  it('el namespace está registrado en LOS TRES bloques', async () => {
    // `hasResourceBundle` y no `t()`, y esta es la diferencia entera:
    // `i18n/index.ts` tiene `fallbackLng: 'es'`, así que con `stories` faltando
    // SÓLO en el bloque `en`, `t('stories:title')` devuelve el string EN ESPAÑOL
    // — una cadena perfectamente válida que ninguna comparación contra la clave
    // puede distinguir. El usuario en inglés ve la página entera en español y
    // nada más falla.
    const i18n = (await import('./index')).default;
    for (const lang of ['es', 'en', 'pt'] as const) {
      expect(
        i18n.hasResourceBundle(lang, 'stories'),
        `el namespace 'stories' no está registrado para "${lang}" en i18n/index.ts`
      ).toBe(true);
    }
  });

  it('el namespace resuelve en la instancia real de i18next', async () => {
    const i18n = (await import('./index')).default;
    for (const lang of ['es', 'en', 'pt'] as const) {
      await i18n.changeLanguage(lang);
      for (const key of usadas) {
        const full = `stories:${key}`;
        // `count` SIEMPRE, y no sólo para las plurales: sin él, i18next no puede
        // elegir entre `_one` y `_other` y devuelve la clave — que este test
        // leería como "el namespace no resuelve".
        const value = i18n.t(full, { count: 1 });
        // Las DOS formas, y la segunda es la que importa: cuando el namespace no
        // está registrado, i18next devuelve la clave SIN el prefijo (`title`),
        // no la cadena completa.
        expect(value, `${full} no resuelve en "${lang}"`).not.toBe(full);
        expect(value, `${full} no resuelve en "${lang}" (namespace sin registrar)`).not.toBe(key);
      }
    }
  });
});
