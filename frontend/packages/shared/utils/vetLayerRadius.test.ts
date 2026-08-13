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

  // Sin el piso, el radio por defecto (3 km) mostraria 45 veterinarias donde
  // antes se dibujaban 50 — o sea que "arreglar" el bug habria empeorado el
  // sintoma que lo origino.
  it('nunca baja del piso, aunque el selector pida menos', () => {
    expect(vetLayerRadiusMeters(1)).toBe(VET_LAYER_MIN_RADIUS_METERS);
    expect(vetLayerRadiusMeters(3)).toBe(VET_LAYER_MIN_RADIUS_METERS);
  });

  it('en el borde exacto del piso devuelve el piso', () => {
    expect(vetLayerRadiusMeters(5)).toBe(VET_LAYER_MIN_RADIUS_METERS);
  });
});
