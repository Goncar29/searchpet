import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { rastroMarkerHtml, MARKER_SIZE, MARKER_ANCHOR } from './rastroMarker';
import { Logo } from '../Logo';

const FOTO =
  'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1786328704/searchpet/pets/x/foto.webp';

/**
 * Describe cada figura por su geometria Y por la cadena de transforms que
 * la afecta. Sin los transforms, dos marcas con la misma elipse pero escalas
 * distintas se verian iguales desde el test — que es justo como se colo la
 * deformacion.
 */
function figuras(raiz: Element): string[] {
  return Array.from(raiz.querySelectorAll('circle, ellipse')).map((el) => {
    const cadena: string[] = [];
    for (let p = el.parentElement; p && p !== raiz.parentElement; p = p.parentElement) {
      const t = p.getAttribute('transform');
      if (t) cadena.unshift(t);
    }
    const g = ['cx', 'cy', 'r', 'rx', 'ry'].map((a) => `${a}=${el.getAttribute(a) ?? '-'}`);
    return `${el.tagName.toLowerCase()} ${g.join(' ')} [${cadena.join(' | ')}]`;
  });
}

describe('rastroMarkerHtml', () => {
  it('LA GEOMETRIA ES LA DEL LOGO, figura por figura', () => {
    // Este es el test que faltaba. El marcador anterior usaba "proporciones
    // ajustadas": otras huellas, otros dedos, y la almohadilla ELIPTICA
    // reemplazada por un div circular. El resultado era el logo deformado, y
    // nada en la suite podia verlo porque no habia con que comparar.
    const { container } = render(<Logo />);
    const logo = container.querySelector('svg > g') as Element;

    const div = document.createElement('div');
    div.innerHTML = rastroMarkerHtml('lost', FOTO, 'x');
    // Solo el cuerpo de la marca: el clipPath y el anillo son del marcador.
    const marca = div.querySelector('svg > g[transform]') as Element;

    expect(figuras(marca)).toEqual(figuras(logo));
  });

  it('la caja respeta el ASPECTO del logo', () => {
    // 122x72 metido en una caja 56x64 es, literalmente, estirar la marca. El
    // aspecto de la caja tiene que ser el del viewBox o el logo se deforma sin
    // que ninguna figura cambie de numero.
    const [w, h] = MARKER_SIZE;
    expect(w / h).toBeCloseTo(122 / 72, 2);
  });

  it('mete la foto de la mascota en la almohadilla', () => {
    const html = rastroMarkerHtml('lost', FOTO, 'Firulais');
    expect(html).toContain('<image');
    // Recortada CONTRA la elipse de la almohadilla, no metida en un cuadrado.
    expect(html).toContain('clip-path="url(#rastro-pad-');
    // `slice`: la foto cubre y se recorta. Con `meet` se deformaria para
    // llenar una caja que no es cuadrada — el mismo error, un nivel mas abajo.
    expect(html).toContain('preserveAspectRatio="xMidYMid slice"');
    // Pedida como miniatura, nunca la original: el mapa dibuja decenas a la vez
    // y el cuello del plan gratuito de Cloudinary es el bandwidth.
    expect(html).toContain('w_64,h_64,c_lfill,g_auto');
  });

  it('cada marcador trae su PROPIO id de recorte', () => {
    // Los ids de SVG son globales al documento y el mapa dibuja decenas de
    // pines: con un id compartido, sacar uno del DOM se lleva puesta la
    // definicion que los demas siguen referenciando.
    const a = rastroMarkerHtml('lost', FOTO, 'Firulais');
    const b = rastroMarkerHtml('found', FOTO, 'Michi');
    const id = (h: string) => h.match(/id="(rastro-pad-[^"]+)"/)?.[1];
    expect(id(a)).toBeTruthy();
    expect(id(a)).not.toBe(id(b));
  });

  it('el anillo lleva el color del ESTADO', () => {
    // Antes el estado se codificaba en el color del marcador entero. Con la
    // foto en el centro, ese significado se muda al anillo — si no, se pierde.
    expect(rastroMarkerHtml('lost', FOTO, 'x')).toContain('var(--color-lost)');
    expect(rastroMarkerHtml('found', FOTO, 'x')).toContain('var(--color-found)');
    expect(rastroMarkerHtml('sighting', FOTO, 'x')).toContain('var(--color-sighting)');
  });

  it('sin foto no queda un hueco: queda el LOGO, solido en el color del estado', () => {
    const html = rastroMarkerHtml('found', '', 'Sin foto');
    expect(html).not.toContain('<image');
    expect(html).toContain('var(--color-found)');
  });

  it('conserva las tres huellas del rastro y los cuatro dedos', () => {
    const html = rastroMarkerHtml('lost', FOTO, 'x');
    // Sin los dedos el marcador se lee como un circulo cualquiera con una cola
    // de puntos; son ellos los que lo hacen leer como PATA.
    expect((html.match(/class="dedo"/g) ?? []).length).toBe(4);
    expect((html.match(/class="huella"/g) ?? []).length).toBe(3);
  });

  it('el nombre describe la mascota, no dice "marcador"', () => {
    // Es la unica descripcion que recibe un lector de pantalla sobre este pin.
    // Va como <title> del svg y no como alt: ahora la foto es un <image> de
    // SVG, que no tiene alt.
    expect(rastroMarkerHtml('lost', FOTO, 'Firulais')).toContain('<title>Firulais</title>');
  });

  it('escapa el nombre para que no rompa el HTML del icono', () => {
    // divIcon recibe una CADENA de HTML: un nombre con comillas cerraria el
    // atributo. Cualquiera puede poner comillas en el nombre de su mascota.
    const html = rastroMarkerHtml('lost', FOTO, 'El "Rey" <b>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&quot;');
  });

  it('el ancla cae en la huella chica de la izquierda', () => {
    // Esa punta es la que toca la coordenada real. Si el ancla fuera el centro,
    // el pin marcaria un lugar que no es donde se vio a la mascota.
    const [x, y] = MARKER_ANCHOR;
    expect(x).toBeLessThan(MARKER_SIZE[0] / 2);
    expect(y).toBeGreaterThan(MARKER_SIZE[1] / 2);
  });
});
