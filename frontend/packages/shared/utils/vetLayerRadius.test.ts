import { describe, it, expect } from 'vitest';
import { vetLayerRadiusMeters, VET_LAYER_MIN_RADIUS_METERS } from './vetLayerRadius';

describe('vetLayerRadiusMeters', () => {
  it('convierte kilometros a metros: el hook toma metros y el selector da km', () => {
    expect(vetLayerRadiusMeters(10)).toBe(10_000);
  });

  it('sigue al selector cuando el usuario abre el radio por encima del piso', () => {
    expect(vetLayerRadiusMeters(10)).toBe(10_000);
    expect(vetLayerRadiusMeters(25)).toBe(25_000);
  });

  // El piso se afirma contra el LITERAL 5000, no contra la constante. Comparar
  // la constante consigo misma deja su valor sin fijar: bajarla a 3000 mantiene
  // todo en verde mientras el comportamiento que el piso existe para garantizar
  // — ver las 69 que hay dentro de 5 km — se degrada en silencio al resultado
  // de 45 que el doc del modulo describe como PEOR que el bug original.
  it('el piso vale 5000 metros', () => {
    expect(VET_LAYER_MIN_RADIUS_METERS).toBe(5_000);
  });

  it('nunca baja del piso, aunque el selector pida menos', () => {
    expect(vetLayerRadiusMeters(1)).toBe(5_000);
    expect(vetLayerRadiusMeters(3)).toBe(5_000);
  });

  it('en el borde exacto del piso devuelve el piso', () => {
    expect(vetLayerRadiusMeters(5)).toBe(5_000);
  });
});
