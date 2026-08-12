import { describe, it, expect } from 'vitest';
// Se lee del DISCO y no con `import ... from './index.css?raw'`: la config de
// vitest tiene `css: false`, que stubea los módulos CSS y devuelve cadena
// vacía — probado. El `@ts-expect-error` es porque el tsconfig de web no
// incluye los tipos de node, y sumarlos por un test cambiaría la superficie de
// tipos del paquete entero.
// @ts-expect-error — node:fs sin @types/node, a propósito (ver arriba)
import { readFileSync } from 'node:fs';

// Ruta relativa a la raíz del paquete, que es donde vitest fija el cwd. No sirve
// `import.meta.url`: acá no es un `file:` sino la URL del servidor de Vite. Si
// esta ruta alguna vez deja de resolver, el primer test del bloque lo grita en
// vez de dejar pasar un archivo vacío.
const css: string = readFileSync('src/index.css', 'utf8');

/**
 * El sistema de color, verificado contra el CSS de verdad.
 *
 * Existe por un defecto que no se ve: `text-danger` se usaba en cinco lugares
 * del mapa desde la rebanada 2 y `--color-danger` **nunca se definió**. Una
 * clase de Tailwind que apunta a un token inexistente no rompe el build, no
 * avisa en consola y no se ve rota — resuelve a un color inválido y pinta
 * NEGRO. Los tres mensajes de error del mapa se leían igual que el texto
 * normal.
 *
 * Los umbrales se CALCULAN acá y no se copian de un comentario: un comentario
 * que afirma un contraste no es evidencia de que alguien lo esté midiendo.
 */
function tokensDe(bloque: 'tema' | 'oscuro'): Record<string, string> {
  const inicio = bloque === 'tema' ? css.indexOf('@theme {') : css.indexOf('.dark {');
  const fin = css.indexOf('\n}', inicio);
  const cuerpo = css.slice(inicio, fin);
  const tokens: Record<string, string> = {};
  for (const m of cuerpo.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

const canal = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminancia = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
};

const contraste = (a: string, b: string) => {
  const [hi, lo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const AA_TEXTO_NORMAL = 4.5;

describe('tokens de color', () => {
  const tema = tokensDe('tema');
  const oscuro = tokensDe('oscuro');

  // Antes de creerle a nada de lo de abajo: que el parser esté leyendo algo.
  it('el parser encuentra los tokens de los dos bloques', () => {
    expect(Object.keys(tema).length).toBeGreaterThan(5);
    expect(tema.primary).toBe('#C24E1A');
    expect(oscuro.surface).toBe('#111827');
  });

  it('--color-danger está definido en los DOS temas', () => {
    expect(tema.danger).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(oscuro.danger).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('danger cumple WCAG AA en claro y en oscuro', () => {
    expect(contraste(tema.danger, '#ffffff')).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    expect(contraste(oscuro.danger, oscuro.surface)).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });

  // La tentación es "danger ya es rojo, usá --color-lost". Son dos significados
  // que pueden divergir, y encima ese rojo no alcanza el umbral sobre blanco.
  it('danger NO puede ser --color-lost: ese rojo no pasa AA sobre blanco', () => {
    expect(contraste(tema.lost, '#ffffff')).toBeLessThan(AA_TEXTO_NORMAL);
    expect(tema.danger).not.toBe(tema.lost);
  });

  // El comentario del tema afirma 4.77 para primary con texto blanco. Acá se
  // mide, así que si alguien retoca el color el número deja de ser una promesa.
  it('primary sostiene el contraste que su comentario declara', () => {
    expect(contraste(tema.primary, '#ffffff')).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
    expect(contraste(tema['primary-dark'], '#ffffff')).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL);
  });
});
