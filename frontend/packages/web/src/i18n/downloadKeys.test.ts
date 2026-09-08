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

  it('la página usa claves (si esto da 0, el barrido dejó de barrer)', () => {
    // Sin esta guarda, un cambio de comillas simples a backticks vaciaría el
    // barrido y los tests de abajo pasarían por vacuidad — verde sin mirar nada.
    expect(used.length).toBeGreaterThan(15);
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
});
