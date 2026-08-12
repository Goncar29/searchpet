import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEsHoja, CONSULTA_HOJA } from './useEsHoja';

const originalMatchMedia = window.matchMedia;

function montarMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: CONSULTA_HOJA,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const espia = vi.fn(() => mql);
  Object.defineProperty(window, 'matchMedia', { value: espia, configurable: true, writable: true });
  return espia;
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: originalMatchMedia,
    configurable: true,
    writable: true,
  });
});

describe('useEsHoja', () => {
  // La regla #29 en su forma exacta: `lg:` de Tailwind emite `(width >= 64rem)`,
  // y en una media query el `rem` se resuelve contra la fuente por defecto del
  // NAVEGADOR. Con `1024px` acá, alguien con la fuente agrandada tendría el CSS
  // dibujando una columna mientras el JS cree que es una hoja.
  it('pregunta en REM, la misma unidad que el breakpoint de Tailwind', () => {
    const espia = montarMatchMedia(true);
    renderHook(() => useEsHoja());
    expect(espia).toHaveBeenCalledWith(CONSULTA_HOJA);
    expect(CONSULTA_HOJA).toContain('64rem');
    expect(CONSULTA_HOJA).not.toContain('px');
  });

  it('devuelve true cuando la consulta matchea', () => {
    montarMatchMedia(true);
    const { result } = renderHook(() => useEsHoja());
    expect(result.current).toBe(true);
  });

  // `false` es la respuesta correcta, pero NO porque deje "el layout de
  // siempre": abajo de 1024px deja la hoja abierta y trabada (ver el comentario
  // del hook). Es correcta porque es la única que no rompe escritorio, que es
  // donde la falla sería visible. El escenario no es alcanzable igual: sin
  // matchMedia la app no renderiza, otros dos componentes la llaman sin guarda.
  it('sin matchMedia devuelve false — la única respuesta que no rompe escritorio', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { result } = renderHook(() => useEsHoja());
    expect(result.current).toBe(false);
  });

  it('se suscribe a los cambios y se desuscribe al desmontar', () => {
    const espia = montarMatchMedia(false);
    const { unmount } = renderHook(() => useEsHoja());
    const mql = espia.mock.results[0].value;
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
