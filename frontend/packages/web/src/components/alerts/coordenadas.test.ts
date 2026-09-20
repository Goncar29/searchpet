import { describe, it, expect } from 'vitest';
import { redondearCoordenada } from './coordenadas';

describe('redondearCoordenada', () => {
  // El caso real: lo que devolvió Leaflet al tocar el mapa en el navegador.
  it('recorta la precision de un click de Leaflet a algo legible', () => {
    expect(redondearCoordenada(-34.899025460930744)).toBe(-34.899025);
    expect(redondearCoordenada(-56.17052078247071)).toBe(-56.170521);
  });

  // Devuelve NÚMERO y no string: el valor va a un `<input type="number">` y al
  // cuerpo del POST, así que un `"-34.899025"` con comillas rompería los dos.
  // `toFixed` devuelve string, y es el error fácil de cometer acá.
  it('devuelve un numero, no el string de toFixed', () => {
    expect(typeof redondearCoordenada(-34.899025460930744)).toBe('number');
  });

  // Y no agrega ceros a la derecha: `(-34.9).toFixed(6)` es "-34.900000", que
  // dentro del input se leería peor que el valor original.
  it('no infla un valor corto con ceros', () => {
    expect(redondearCoordenada(-34.9)).toBe(-34.9);
    expect(redondearCoordenada(0)).toBe(0);
  });

  // Seis decimales son ~11 cm. La alerta más chica tiene 1 km de radio, así que
  // lo que se descarta no puede cambiar ninguna decisión del producto.
  it('lo que descarta es despreciable frente al radio mas chico', () => {
    const original = -34.90112345678;
    const error = Math.abs(original - redondearCoordenada(original));
    // En grados: 1e-6 ≈ 0,11 m. El radio mínimo es 1000 m.
    expect(error).toBeLessThan(1e-6);
  });
});
