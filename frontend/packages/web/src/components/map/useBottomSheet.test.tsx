import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MapPanel } from './MapPanel';
import { resumirFiltros } from '../../utils/mapFilterSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (clave: string, opciones?: { count?: number }) =>
      opciones && typeof opciones.count === 'number' ? `${clave}:${opciones.count}` : clave,
  }),
}));

/**
 * El ciclo de vida del arrastre se prueba A TRAVÉS de `MapPanel` y no del hook
 * suelto, porque lo que hay que verificar es el cableado real: quién captura el
 * puntero, sobre qué elemento, y qué pasa con el click que viene después.
 *
 * Este archivo existe por un hueco concreto: la aritmética tenía tests puros y
 * el layout se verificó en un navegador, pero la máquina de estados del gesto
 * no la cubría ninguno de los dos. Los dos defectos que cierra vivían ahí.
 */
const original = {
  set: HTMLElement.prototype.setPointerCapture,
  has: HTMLElement.prototype.hasPointerCapture,
  release: HTMLElement.prototype.releasePointerCapture,
};

beforeEach(() => {
  // Modo hoja: sin esto `onPointerDown` sale temprano y no hay arrastre.
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: true, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  HTMLElement.prototype.setPointerCapture = original.set;
  HTMLElement.prototype.hasPointerCapture = original.has;
  HTMLElement.prototype.releasePointerCapture = original.release;
});

const montar = () =>
  render(
    <MapPanel resumen={resumirFiltros({})} resultCount={0} isLoading={false}>
      <p>contenido</p>
    </MapPanel>,
  );

const arrastrar = (asa: HTMLElement, finEvento: 'pointerUp' | 'pointerCancel') => {
  fireEvent.pointerDown(asa, { clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(asa, { clientY: 300, pointerId: 1 });
  fireEvent[finEvento](asa, { clientY: 300, pointerId: 1 });
};

describe('useBottomSheet — fin del arrastre', () => {
  // Un `pointercancel` NO dispara `click`. Si el fin del arrastre arma la
  // supresión sin distinguir el motivo, la bandera queda cargada y se come el
  // PRÓXIMO toque de verdad: el usuario arrastra, el sistema le cancela el
  // gesto (una llamada entrante, un segundo dedo), toca el asa y no pasa nada.
  it('tras un pointercancel, el siguiente click del asa SÍ cicla', () => {
    montar();
    const asa = screen.getByLabelText('map:sheetToggle');
    arrastrar(asa, 'pointerCancel');

    const antes = asa.getAttribute('aria-expanded');
    fireEvent.click(asa);
    expect(asa.getAttribute('aria-expanded')).not.toBe(antes);
  });

  it('tras un pointerup con movimiento, el click que lo acompaña NO cicla de más', () => {
    montar();
    const asa = screen.getByLabelText('map:sheetToggle');
    arrastrar(asa, 'pointerUp');

    const trasSoltar = asa.getAttribute('aria-expanded');
    // El navegador dispara este click inmediatamente después del pointerup.
    fireEvent.click(asa);
    expect(asa.getAttribute('aria-expanded')).toBe(trasSoltar);
  });

  // En `pointercancel` el navegador ya liberó la captura, y la spec de Pointer
  // Events manda tirar `NotFoundError` si el pointerId no corresponde a un
  // puntero activo. Liberar sin preguntar aborta el handler ANTES del reset, y
  // la hoja queda clavada en su desplazamiento: `dragOffset` nunca vuelve a
  // null, así que ignora su clase de anclaje y deja de responder.
  it('no libera una captura que ya no tiene, y la hoja se resetea igual', () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.releasePointerCapture = vi.fn(() => {
      throw new DOMException('pointer no activo', 'NotFoundError');
    });

    montar();
    const asa = screen.getByLabelText('map:sheetToggle');
    const hoja = asa.closest('aside') as HTMLElement;

    expect(() => arrastrar(asa, 'pointerCancel')).not.toThrow();
    expect(HTMLElement.prototype.releasePointerCapture).not.toHaveBeenCalled();
    // `dragOffset` volvió a null: la hoja vuelve a obedecer su anclaje en vez
    // de quedarse con el desplazamiento inline del arrastre.
    expect(hoja.style.transform).toBe('translateY(0px)');
  });
});
