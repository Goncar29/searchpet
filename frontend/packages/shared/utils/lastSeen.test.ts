import { describe, it, expect } from 'vitest';
import { computeLastSeen, formatLastSeen } from './lastSeen';
// `getDateLocale('es')` y no el literal `'es-UY'`: desde que `DateLocale` es un
// tipo marcado, el literal NO compila (`TS2345`). Vitest no typechequea y el
// `tsconfig` de web sólo incluye `src`, así que esto pasaba verde mientras el
// archivo dejaba de typechequear — un rojo que aparecería después, en otra rama,
// pareciendo no tener nada que ver.
import { getDateLocale } from './dateLocale';

const ES_UY = getDateLocale('es');

// "Ahora" en calendario LOCAL, que es el mismo que usa el helper. Construirlo
// con Date.UTC haría que los casos pasen o fallen según el huso del runner.
const ahora = new Date(2026, 8, 7, 12, 0, 0); // 7 de septiembre de 2026, mediodía

/** El instante ISO (UTC) que corresponde a una fecha/hora LOCAL dada. */
const isoDesdeLocal = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m, d, h, 0, 0).toISOString();

describe('computeLastSeen', () => {
  it('devuelve null sin fecha', () => {
    expect(computeLastSeen(undefined, ahora)).toBeNull();
    expect(computeLastSeen('', ahora)).toBeNull();
  });

  it('devuelve null ante una fecha que no parsea', () => {
    expect(computeLastSeen('no-es-una-fecha', ahora)).toBeNull();
  });

  it('hoy es 0 días', () => {
    expect(computeLastSeen(isoDesdeLocal(2026, 8, 7, 8), ahora)).toEqual({ unit: 'day', value: 0 });
  });

  it('ayer es 1 día', () => {
    expect(computeLastSeen(isoDesdeLocal(2026, 8, 6, 8), ahora)).toEqual({ unit: 'day', value: 1 });
  });

  it('29 días siguen siendo días', () => {
    expect(computeLastSeen(isoDesdeLocal(2026, 7, 9), ahora)).toEqual({ unit: 'day', value: 29 });
  });

  it('30 días ya son un mes', () => {
    expect(computeLastSeen(isoDesdeLocal(2026, 7, 8), ahora)).toEqual({ unit: 'month', value: 1 });
  });

  it('cuatro meses', () => {
    expect(computeLastSeen(isoDesdeLocal(2026, 4, 3), ahora)).toEqual({ unit: 'month', value: 4 });
  });

  it('365 días ya son un año', () => {
    expect(computeLastSeen(isoDesdeLocal(2025, 8, 7), ahora)).toEqual({ unit: 'year', value: 1 });
  });

  // Una fecha futura es alcanzable: relojes desfasados entre el server y el
  // device. "hace -3 días" es peor que decir "hoy".
  it('una fecha futura se trata como hoy', () => {
    expect(computeLastSeen(isoDesdeLocal(2026, 11, 1), ahora)).toEqual({ unit: 'day', value: 0 });
  });

  // La comparación es por día de calendario y no por instante. Sin eso, algo
  // visto ayer a las 23:00 mirado hoy a las 08:00 daría 0 días y diría "hoy".
  it('cuenta días de calendario, no instantes', () => {
    const hoyTemprano = new Date(2026, 8, 7, 8, 0, 0);
    expect(computeLastSeen(isoDesdeLocal(2026, 8, 6, 23), hoyTemprano)).toEqual({
      unit: 'day',
      value: 1,
    });
  });
});

// LAS DOS LÍNEAS DE LA TARJETA TIENEN QUE HABLAR DEL MISMO DÍA.
//
// El relativo se bucketea por calendario y el absoluto sale de
// `toLocaleDateString`, que es LOCAL. Mientras el bucket usaba UTC, los dos se
// contradecían en la franja donde los calendarios no coinciden: medido en
// Montevideo (UTC-3), un avistamiento a las 01:00Z daba "hoy" arriba y
// "6 de septiembre" abajo — el mismo día, dos respuestas.
//
// Este test recorre esa franja hora por hora. Es la única aserción que mira las
// DOS salidas juntas: verificar cada una por separado no puede ver que se
// contradigan, que es exactamente cómo el defecto sobrevivió a los diez tests
// de arriba.
describe('las dos líneas no se contradicen', () => {
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (key === 'pets:lastSeen.today') return 'hoy';
    if (key === 'pets:lastSeen.yesterday') return 'ayer';
    if (key === 'pets:lastSeen.line') return `Visto ${opts?.when}`;
    if (key === 'pets:lastSeen.ago') return `hace ${opts?.time}`;
    return `${opts?.count} ${key.split('.').pop()}`;
  };

  it('cuando dice "hoy", la fecha exacta ES la de hoy', () => {
    for (let hora = 0; hora < 24; hora++) {
      const visto = new Date(2026, 8, 7, hora, 0, 0);
      const mirandoALas17 = new Date(2026, 8, 7, 17, 0, 0);
      const salida = formatLastSeen(t, visto.toISOString(), ES_UY, mirandoALas17);
      expect(salida).not.toBeNull();
      expect(salida!.relative, `hora local ${hora}`).toBe('Visto hoy');
      // El día del mes de la línea absoluta tiene que ser el 7.
      expect(salida!.absolute, `hora local ${hora}`).toMatch(/\b7\b/);
    }
  });

  it('cuando dice "ayer", la fecha exacta ES la de ayer', () => {
    for (let hora = 0; hora < 24; hora++) {
      const visto = new Date(2026, 8, 6, hora, 0, 0);
      const mirandoALas17 = new Date(2026, 8, 7, 17, 0, 0);
      const salida = formatLastSeen(t, visto.toISOString(), ES_UY, mirandoALas17);
      expect(salida!.relative, `hora local ${hora}`).toBe('Visto ayer');
      expect(salida!.absolute, `hora local ${hora}`).toMatch(/\b6\b/);
    }
  });
});
