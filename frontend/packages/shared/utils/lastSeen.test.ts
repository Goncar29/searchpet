import { describe, it, expect } from 'vitest';
import { computeLastSeen } from './lastSeen';

const ahora = new Date(Date.UTC(2026, 8, 7)); // 7 de septiembre de 2026

describe('computeLastSeen', () => {
  it('devuelve null sin fecha', () => {
    expect(computeLastSeen(undefined, ahora)).toBeNull();
    expect(computeLastSeen('', ahora)).toBeNull();
  });

  it('devuelve null ante una fecha que no parsea', () => {
    expect(computeLastSeen('no-es-una-fecha', ahora)).toBeNull();
  });

  it('hoy es 0 días', () => {
    expect(computeLastSeen('2026-09-07T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 0 });
  });

  it('ayer es 1 día', () => {
    expect(computeLastSeen('2026-09-06T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 1 });
  });

  it('29 días siguen siendo días', () => {
    expect(computeLastSeen('2026-08-09T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 29 });
  });

  it('30 días ya son un mes', () => {
    expect(computeLastSeen('2026-08-08T08:00:00Z', ahora)).toEqual({ unit: 'month', value: 1 });
  });

  it('cuatro meses', () => {
    expect(computeLastSeen('2026-05-03T08:00:00Z', ahora)).toEqual({ unit: 'month', value: 4 });
  });

  it('365 días ya son un año', () => {
    expect(computeLastSeen('2025-09-07T08:00:00Z', ahora)).toEqual({ unit: 'year', value: 1 });
  });

  // Una fecha futura es alcanzable: relojes desfasados entre el server y el
  // device. "hace -3 días" es peor que decir "hoy".
  it('una fecha futura se trata como hoy', () => {
    expect(computeLastSeen('2026-12-01T08:00:00Z', ahora)).toEqual({ unit: 'day', value: 0 });
  });

  // La comparación es por día de calendario y no por instante. Sin eso, algo
  // visto ayer a las 23:00 mirado hoy a las 08:00 daría 0 días y diría "hoy",
  // que es una afirmación falsa sobre cuándo se vio al animal.
  it('cuenta días de calendario, no instantes', () => {
    const hoyTemprano = new Date(Date.UTC(2026, 8, 7, 8, 0, 0));
    expect(computeLastSeen('2026-09-06T23:00:00Z', hoyTemprano)).toEqual({ unit: 'day', value: 1 });
  });
});
