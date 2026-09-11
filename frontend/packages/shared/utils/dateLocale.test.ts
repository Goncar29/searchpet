import { describe, it, expect } from 'vitest';
import { getDateLocale } from './dateLocale';

describe('getDateLocale', () => {
  it('mapea los tres idiomas de la app', () => {
    expect(getDateLocale('es')).toBe('es-UY');
    expect(getDateLocale('en')).toBe('en-US');
    expect(getDateLocale('pt')).toBe('pt-BR');
  });

  it('cae a es-UY con cualquier otra cosa', () => {
    expect(getDateLocale('fr')).toBe('es-UY');
    expect(getDateLocale('')).toBe('es-UY');
  });

  // LA RAZÓN DE SER DEL MAPA, medida y no supuesta. Si esto alguna vez deja de
  // ser cierto —porque cambie el CLDR de la plataforma—, el helper pasa a ser
  // ceremonia y conviene enterarse acá y no discutiéndolo de memoria.
  //
  // Para FECHAS `es` y `es-UY` son idénticos; la diferencia aparece SÓLO al
  // formatear hora, y sólo en español.
  it('en español el mapa cambia la HORA, no la fecha', () => {
    const d = new Date('2026-03-07T15:04:00Z');
    const opts = { timeZone: 'UTC' } as const;

    expect(d.toLocaleDateString('es'), 'la fecha sola no cambia').toBe(
      d.toLocaleDateString('es-UY')
    );

    const pelado = d.toLocaleTimeString('es', opts);
    const mapeado = d.toLocaleTimeString('es-UY', opts);
    expect(pelado, 'si esto deja de diferir, el mapa dejó de tener sentido').not.toBe(mapeado);
    expect(pelado).toMatch(/^15:/); // 24 h
    expect(mapeado).toMatch(/p\.\s?m\./); // 12 h con meridiano
  });

  it('en inglés y portugués el mapa no cambia nada, y está bien', () => {
    const d = new Date('2026-03-07T15:04:00Z');
    const opts = { timeZone: 'UTC' } as const;
    // Se mapean igual por consistencia, no porque haga falta: tener las tres
    // entradas juntas evita que alguien "optimice" el mapa dejando sólo `es` y
    // después no entienda por qué un idioma nuevo no aparece.
    expect(d.toLocaleString('en', opts)).toBe(d.toLocaleString('en-US', opts));
    expect(d.toLocaleString('pt', opts)).toBe(d.toLocaleString('pt-BR', opts));
  });
});
