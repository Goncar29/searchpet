import { describe, it, expect } from 'vitest';
import { rastroMarkerHtml, MARKER_SIZE, MARKER_ANCHOR } from './rastroMarker';

const FOTO =
  'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1786328704/searchpet/pets/x/foto.webp';

describe('rastroMarkerHtml', () => {
  it('mete la foto de la mascota en la almohadilla', () => {
    const html = rastroMarkerHtml('lost', FOTO, 'Firulais');
    expect(html).toContain('<img');
    // Pedida como miniatura, nunca la original: el mapa dibuja decenas a la vez
    // y el cuello del plan gratuito de Cloudinary es el bandwidth.
    expect(html).toContain('w_64,h_64,c_fill,g_auto');
  });

  it('el anillo lleva el color del ESTADO', () => {
    // Antes el estado se codificaba en el color del marcador entero. Con la
    // foto en el centro, ese significado se muda al anillo — si no, se pierde.
    expect(rastroMarkerHtml('lost', FOTO, 'x')).toContain('var(--color-lost)');
    expect(rastroMarkerHtml('found', FOTO, 'x')).toContain('var(--color-found)');
    expect(rastroMarkerHtml('sighting', FOTO, 'x')).toContain('var(--color-sighting)');
  });

  it('sin foto no queda un hueco: la pata va solida en el color del estado', () => {
    const html = rastroMarkerHtml('found', '', 'Sin foto');
    expect(html).not.toContain('<img');
    expect(html).toContain('var(--color-found)');
  });

  it('conserva las tres huellas del rastro y los cuatro dedos', () => {
    const html = rastroMarkerHtml('lost', FOTO, 'x');
    // Sin los dedos el marcador se lee como un circulo cualquiera con una cola
    // de puntos; son ellos los que lo hacen leer como PATA.
    expect((html.match(/class="dedo"/g) ?? []).length).toBe(4);
    expect((html.match(/class="huella"/g) ?? []).length).toBe(3);
  });

  it('el alt describe la mascota, no dice "marcador"', () => {
    // Es la unica descripcion que recibe un lector de pantalla sobre este pin.
    expect(rastroMarkerHtml('lost', FOTO, 'Firulais')).toContain('alt="Firulais"');
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
