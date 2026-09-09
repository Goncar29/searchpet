import { describe, it, expect } from 'vitest';
// `?raw` de Vite y NO `readFileSync(new URL(..., import.meta.url))`: bajo
// vitest ese `import.meta.url` no es un URL `file:` y tira "The URL must be of
// scheme file". Esto además no depende del cwd desde el que se corran los tests.
import downloadPageSource from '../pages/DownloadPage.tsx?raw';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

// Las claves se comparan APLANADAS: `download.android` es un objeto anidado, y
// comparar sólo el primer nivel no vería una traducción que se olvidó el `note`
// adentro.
function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  ).sort();
}

function resolve(dict: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) =>
      acc !== null && typeof acc === 'object'
        ? (acc as Record<string, unknown>)[part]
        : undefined,
    dict
  );
}

describe('download — paridad de claves en los tres idiomas', () => {
  it('en tiene exactamente las mismas claves que es', () => {
    expect(flatten(en.download)).toEqual(flatten(es.download));
  });

  it('pt tiene exactamente las mismas claves que es', () => {
    expect(flatten(pt.download)).toEqual(flatten(es.download));
  });

  // Una traducción vacía no es una clave faltante: pasa la comparación de
  // arriba y en pantalla se ve un hueco. Ningún test de componente lo ve,
  // porque esos mockean `t` devolviendo la clave.
  // WCAG 2.5.3 (Label in Name): el nombre accesible tiene que CONTENER el texto
  // visible. Si no, quien maneja el sitio por voz lee "Abrir ahora", lo dice, y
  // no pasa nada — porque el nombre que expone el botón es otro.
  //
  // Va como test y no como nota porque es una propiedad que se rompe sola al
  // traducir: en inglés y portugués el `aria-label` decía "Download THE APK" y
  // "Baixar O APK", y ese artículo de más basta para romper la contención. Se
  // rompió en 5 de los 12 pares con sólo escribir las traducciones.
  it('cada aria-label contiene el texto visible de su botón', () => {
    for (const [lang, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      const d = dict.download;
      const pares: Array<[string, string, string]> = [
        ['android.cta', d.android.cta, d.android.ctaLabel],
        ['webApp.cta', d.webApp.cta, d.webApp.ctaLabel],
        ['expo.android', d.expo.android, d.expo.androidLabel],
        ['expo.ios', d.expo.ios, d.expo.iosLabel],
      ];
      for (const [nombre, visible, label] of pares) {
        expect(
          label,
          `${lang}.download.${nombre}: el aria-label "${label}" no contiene el texto visible "${visible}"`
        ).toContain(visible);
      }
    }
  });

  it('ninguna traducción quedó vacía', () => {
    for (const [lang, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      const walk = (o: Record<string, unknown>, path = '') => {
        for (const [k, v] of Object.entries(o)) {
          if (v !== null && typeof v === 'object') walk(v as Record<string, unknown>, `${path}${k}.`);
          else expect(String(v).trim(), `${lang}.download.${path}${k}`).not.toBe('');
        }
      };
      walk(dict.download);
    }
  });
});

// LO QUE ESTE BLOQUE AGREGA sobre la paridad de arriba, y es el punto: comparar
// en/pt contra es NO ve una clave que falta en LOS TRES. Ese caso —el más
// probable, porque es el de escribir `t('android.notes')` cuando el locale dice
// `note`— sólo lo caza leyendo los call sites reales y buscándolos en el
// diccionario. Es el hueco que `CLAUDE.md` anota sobre `profile:public.*`.
describe('download — las claves que la página usa existen de verdad', () => {
  const used = [...downloadPageSource.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]).sort();

  it('el barrido ve TODAS las llamadas a t(), no sólo algunas', () => {
    // Contar contra el total de `t(` y no contra un número mágico. Un `>15` sólo
    // prueba que encontró ALGUNAS: hoy hay 26 claves, así que podrían
    // desaparecer 10 —por un `t('x', { ns })`, o una llamada reformateada en
    // varias líneas— y la guarda seguiría pasando mientras esas claves dejan de
    // verificarse. Esto exige que el barrido haya visto cada call site.
    const total = [...downloadPageSource.matchAll(/\bt\(/g)].length;
    expect(used.length).toBe(total);
    expect(total).toBeGreaterThan(15);
  });

  it('cada clave usada existe en los tres idiomas', () => {
    for (const [lang, dict] of [['es', es], ['en', en], ['pt', pt]] as const) {
      for (const key of used) {
        expect(
          resolve(dict.download as unknown as Record<string, unknown>, key),
          `${lang}.download.${key} — la usa DownloadPage.tsx y no está en el locale`
        ).toBeTypeOf('string');
      }
    }
  });

  // LO QUE ESTO AGREGA sobre el bloque de arriba, y es un hueco distinto: los
  // asserts anteriores leen los JSON DIRECTAMENTE, así que i18next nunca
  // participa. Un namespace que existe en los locales pero NO está registrado en
  // los tres bloques de `i18n/index.ts` los pasa todos — y en producción la
  // página renderiza `title`, `android.title`, `webApp.step1` literales. Es
  // exactamente el modo de falla de la regla #21.
  //
  // Verificado: borrando las tres líneas `download: es.download` de
  // `i18n/index.ts`, la suite entera quedaba VERDE. Con esto, se pone roja.
  it('el namespace está registrado y resuelve en la instancia real', async () => {
    const i18n = (await import('./index')).default;

    for (const lang of ['es', 'en', 'pt'] as const) {
      await i18n.changeLanguage(lang);
      for (const key of used) {
        // `count` SIEMPRE: sin él, i18next no puede elegir entre `_one` y
        // `_other` en una clave plural y devuelve la clave, que este test
        // leería como "el namespace no resuelve". Hoy `download` no tiene
        // plurales — esto evita el falso positivo el día que tenga una.
        const value = i18n.t(`download:${key}`, { count: 1 });
        expect(value, `download:${key} no resuelve en "${lang}"`).not.toBe(key);
        expect(value, `download:${key} no resuelve en "${lang}"`).not.toBe(`download:${key}`);
      }
    }
  });
});
