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

  // Falla ABIERTO. El modo hoja transforma el panel y le monta un arrastre;
  // activarlo por error lo dejaría corrido en una pantalla que no lo espera.
  // No activarlo sólo pierde el gesto y deja la columna fija de siempre.
  it('sin matchMedia devuelve false — el layout que ya funcionaba', () => {
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
