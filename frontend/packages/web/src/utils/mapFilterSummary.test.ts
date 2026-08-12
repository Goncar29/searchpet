import { describe, it, expect } from 'vitest';
import { resumirFiltros } from './mapFilterSummary';

describe('resumirFiltros', () => {
  it('sin filtros aplicados el total es cero', () => {
    const r = resumirFiltros({});
    expect(r.total).toBe(0);
    expect(r.statuses).toEqual([]);
    expect(r.hasRange).toBe(false);
  });

  it('cuenta un grupo por tipo, por estados y por rango de fechas', () => {
    expect(resumirFiltros({ type: 'gato' }).total).toBe(1);
    expect(resumirFiltros({ status: ['lost', 'found'] }).total).toBe(1);
    expect(resumirFiltros({ from: '2026-08-01T00:00:00.000Z' }).total).toBe(1);
    expect(
      resumirFiltros({ type: 'gato', status: ['lost'], to: '2026-08-01T00:00:00.000Z' }).total,
    ).toBe(3);
  });

  // Una lista vacía llega desde `useMapFilters` sólo si alguien rompe su
  // guarda, pero contarla dejaría el panel colapsado avisando "1 filtro" sobre
  // una búsqueda sin filtrar — el resumen mentiría justo cuando es la única
  // información visible.
  it('una lista de estados vacía NO cuenta como filtro', () => {
    const r = resumirFiltros({ status: [] });
    expect(r.total).toBe(0);
    expect(r.statuses).toEqual([]);
  });

  // Un solo extremo ya acota la búsqueda; exigir los dos dejaría "desde el 1º"
  // sin representación en el resumen.
  it('un solo extremo del rango ya cuenta', () => {
    expect(resumirFiltros({ from: '2026-08-01T00:00:00.000Z' }).hasRange).toBe(true);
    expect(resumirFiltros({ to: '2026-08-01T00:00:00.000Z' }).hasRange).toBe(true);
  });

  it('expone los valores para que quien renderiza los traduzca', () => {
    const r = resumirFiltros({ type: 'perro', status: ['sighting'] });
    expect(r.type).toBe('perro');
    expect(r.statuses).toEqual(['sighting']);
  });
});
