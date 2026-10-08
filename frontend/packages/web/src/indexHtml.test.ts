import { describe, it, expect } from 'vitest';
// Se lee del disco por lo mismo que index.css.test.ts: el tsconfig de web no
// incluye los tipos de node, y sumarlos por un test cambiaría la superficie de
// tipos del paquete entero.
// @ts-expect-error — node:fs sin @types/node, a propósito
import { readFileSync, existsSync } from 'node:fs';

// Rutas relativas a la raíz del paquete, donde vitest fija el cwd.
const html: string = readFileSync('index.html', 'utf8');

/**
 * Lo que `index.html` carga antes de que corra una línea de JS.
 *
 * Una hoja de estilos en el <head> bloquea el primer render hasta que llega,
 * y si viene de otro dominio suma además la conexión. Dos lo hacían: el
 * `leaflet.css` de unpkg (785 ms, y era un duplicado del que ya trae el bundle)
 * y Google Fonts (~840 ms en el Lighthouse mobile del 2026-10-08). Ninguno
 * rompe nada al volver: la página se ve igual, sólo tarda más en aparecer, y
 * por eso hace falta un test que lo diga.
 */
describe('index.html', () => {
  it('no carga hojas de estilo de otros dominios', () => {
    const externas = [...html.matchAll(/<link\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => /rel="stylesheet"/.test(tag) && /href="(https?:)?\/\//.test(tag));

    expect(externas).toEqual([]);
  });

  it('precarga el hero con la misma media query que `lg:`', () => {
    // Sin la media query, un celular descarga una foto que nunca ve: la columna
    // es `hidden lg:block`. Y en px en vez de rem dejaría de coincidir con
    // `lg:` cuando el usuario agranda la fuente del navegador (regla #29).
    expect(html).toMatch(
      /<link rel="preload" as="image" href="\/hero\.webp"[^>]*media="\(min-width: 64rem\)"/,
    );
  });
});

describe('public/', () => {
  it('sirve un robots.txt propio', () => {
    // Sin el archivo, Vercel responde /robots.txt con el index.html del SPA y
    // los buscadores lo leen como un robots.txt inválido.
    expect(existsSync('public/robots.txt')).toBe(true);
  });
});
