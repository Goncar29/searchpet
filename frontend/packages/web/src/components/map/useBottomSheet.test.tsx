import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MapPanel } from './MapPanel';
import { CSS_POR_SNAP } from './useBottomSheet';
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
    <MapPanel resumen={resumirFiltros({})} resultCount={0} isLoading={false} isError={false}>
      <p>contenido</p>
    </MapPanel>,
  );

const arrastrar = (asa: HTMLElement, finEvento: 'pointerUp' | 'pointerCancel') => {
  fireEvent.pointerDown(asa, { clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(asa, { clientY: 300, pointerId: 1 });
  fireEvent[finEvento](asa, { clientY: 300, pointerId: 1 });
};

/** Un toque limpio: baja, sube sin moverse, y el navegador manda el click. */
const tocar = (asa: HTMLElement) => {
  fireEvent.pointerDown(asa, { clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(asa, { clientY: 400, pointerId: 1 });
  fireEvent.click(asa);
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

  // El navegador SUPRIME el click cuando el toque se movió más allá del umbral
  // de tap: un arrastre táctil termina en `pointerup` y ahí se acaba, sin click.
  // Armar la supresión esperando un evento que puede no llegar deja la bandera
  // cargada, y se come el PRÓXIMO toque de verdad.
  //
  // La bandera se limpia en `pointerdown` para no depender de esa suposición:
  // cada gesto arranca con el estado limpio, dispare o no el navegador el click
  // del gesto anterior.
  it('un arrastre que NO terminó en click no se come el toque siguiente', () => {
    montar();
    const asa = screen.getByLabelText('map:sheetToggle');

    // Arrastre táctil: pointerup y nada más. El navegador no manda click.
    fireEvent.pointerDown(asa, { clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(asa, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(asa, { clientY: 200, pointerId: 1 });

    const antes = asa.getAttribute('aria-expanded');
    tocar(asa);
    expect(asa.getAttribute('aria-expanded')).not.toBe(antes);
  });

  // Un gesto cancelado no es un gesto: no lo terminó el usuario. Comprometer un
  // punto de anclaje con las coordenadas de un `pointercancel` —que la spec no
  // garantiza significativas— puede dejar la hoja abierta al 80% después de una
  // llamada entrante. Se descarta el arrastre y queda el anclaje anterior.
  it('un pointercancel descarta el arrastre en vez de comprometer un anclaje', () => {
    montar();
    const asa = screen.getByLabelText('map:sheetToggle');
    const antes = asa.getAttribute('aria-expanded');

    fireEvent.pointerDown(asa, { clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(asa, { clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(asa, { clientY: 0, pointerId: 1 });

    expect(asa.getAttribute('aria-expanded')).toBe(antes);
  });

  // Un segundo dedo sobre el asa pisaba el origen del arrastre en curso, así que
  // los movimientos del primero pasaban a medirse contra el origen del segundo y
  // la hoja pegaba un salto. Peor: el `pointerup` del segundo mataba el arrastre
  // del primero, que seguía apoyado.
  it('ignora los punteros que no son el del arrastre en curso', () => {
    montar();
    const asa = screen.getByLabelText('map:sheetToggle');
    const hoja = asa.closest('aside') as HTMLElement;

    fireEvent.pointerDown(asa, { clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(asa, { clientY: 300, pointerId: 1 });

    // Segundo dedo: baja y sube mientras el primero sigue apoyado.
    fireEvent.pointerDown(asa, { clientY: 800, pointerId: 2 });
    fireEvent.pointerUp(asa, { clientY: 800, pointerId: 2 });

    // El arrastre del primero sigue vivo: su movimiento todavía mueve la hoja.
    fireEvent.pointerMove(asa, { clientY: 250, pointerId: 1 });
    expect(hoja.style.transform).toMatch(/^translateY\(\d+px\)$/);
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
    // Lo que importa es que `dragOffset` volvió a null: la hoja obedece de
    // nuevo su CLASE de anclaje en vez de quedarse clavada en el
    // desplazamiento inline del arrastre. Se compara contra la constante y no
    // contra un valor escrito a mano, así el test sigue diciendo lo mismo si
    // los anclajes cambian de número.
    expect(hoja.style.transform).toBe(`translateY(${CSS_POR_SNAP.peek})`);
  });
});
