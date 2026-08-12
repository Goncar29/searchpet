import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  PEEK_VISIBLE_PX,
  SNAP_HALF_FRACTION,
  limitarOffset,
  snapMasCercano,
  type SnapPoint,
} from './bottomSheetSnap';

/**
 * El desplazamiento de cada punto, expresado en CSS.
 *
 * Se derivan de las MISMAS constantes que usa la aritmética del arrastre. Con
 * dos juegos de números, soltar la hoja la movería unos píxeles respecto de
 * donde el CSS la dejaba — un salto chico, permanente y muy difícil de explicar.
 */
export const CSS_POR_SNAP: Record<SnapPoint, string> = {
  full: '0px',
  half: `${SNAP_HALF_FRACTION * 100}%`,
  peek: `calc(100% - ${PEEK_VISIBLE_PX}px)`,
};

/** Debajo de esto el gesto fue un toque, no un arrastre. */
const UMBRAL_ARRASTRE_PX = 6;

/** El click del asa abre de a poco. Desde `full` vuelve a cerrar. */
const CICLO: Record<SnapPoint, SnapPoint> = {
  peek: 'half',
  half: 'full',
  full: 'peek',
};

interface Arrastre {
  /** Qué dedo abrió este arrastre. Los demás se ignoran mientras dure. */
  pointerId: number;
  yInicial: number;
  offsetInicial: number;
  alto: number;
  movio: boolean;
}

/**
 * Arrastre y anclaje de la hoja inferior.
 *
 * Sólo el ASA arrastra. Un arrastre que empieza sobre el contenido scrollea la
 * lista, y uno que empieza sobre el mapa lo panea — el mapa ni se entera de
 * estos eventos, porque la hoja es un hermano de `.leaflet-container` y Leaflet
 * escucha sobre su propio contenedor, no sobre el div que los envuelve.
 */
export function useBottomSheet(activo: boolean, inicial: SnapPoint = 'peek') {
  const [snap, setSnap] = useState<SnapPoint>(inicial);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const hojaRef = useRef<HTMLElement | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  /**
   * Un arrastre termina en `pointerup`, y el navegador dispara `click` justo
   * después. Sin esta marca, soltar la hoja la anclaría y acto seguido el click
   * la mandaría al punto siguiente.
   */
  const suprimirClick = useRef(false);

  const ciclar = useCallback(() => setSnap((s) => CICLO[s]), []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = hojaRef.current;
    const padre = el?.parentElement;
    if (!activo || !el || !padre) return;
    // Un arrastre en curso manda: un segundo dedo sobre el asa NO lo reinicia.
    // Pisando el origen, los movimientos del primer dedo pasaban a medirse
    // contra el del segundo y la hoja pegaba un salto.
    if (arrastre.current) return;

    // Cada gesto arranca con la bandera limpia. Antes se limpiaba SÓLO cuando
    // llegaba el click que venía a suprimir — y el navegador no manda click
    // cuando el toque se movió más allá del umbral de tap, así que la bandera
    // quedaba cargada y se comía el toque siguiente. No se puede depender de un
    // evento que puede no llegar.
    suprimirClick.current = false;

    const rect = el.getBoundingClientRect();
    const rectPadre = padre.getBoundingClientRect();
    // El desplazamiento actual se LEE DEL DOM en vez de derivarse del snap: así
    // el arrastre arranca donde la hoja está de verdad, incluso a mitad de una
    // transición. Sin transformar, su borde superior cae en
    // `padre.bottom - alto`; la diferencia contra el real es el desplazamiento.
    arrastre.current = {
      pointerId: e.pointerId,
      yInicial: e.clientY,
      offsetInicial: rect.top - rectPadre.bottom + rect.height,
      alto: rect.height,
      movio: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [activo]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const a = arrastre.current;
    if (!a || a.pointerId !== e.pointerId) return;
    const delta = e.clientY - a.yInicial;
    if (Math.abs(delta) > UMBRAL_ARRASTRE_PX) a.movio = true;
    setDragOffset(limitarOffset(a.offsetInicial + delta, a.alto));
  }, []);

  /**
   * Fin del arrastre. `cancelado` distingue `pointercancel` de `pointerup`, y
   * esa diferencia decide dos cosas distintas — de ahí que sea un parámetro y
   * no dos handlers.
   */
  const terminar = useCallback((e: ReactPointerEvent<HTMLElement>, cancelado: boolean) => {
    const a = arrastre.current;
    // El `pointerup` de OTRO dedo no termina este arrastre: el que lo abrió
    // puede seguir apoyado.
    if (!a || a.pointerId !== e.pointerId) return;
    arrastre.current = null;

    // Se PREGUNTA antes de liberar. En `pointercancel` el navegador ya liberó
    // la captura, y la spec de Pointer Events manda tirar `NotFoundError` si el
    // pointerId no corresponde a un puntero activo. Esa excepción abortaba el
    // handler acá mismo, o sea ANTES del reset de abajo: `dragOffset` no volvía
    // nunca a null, la hoja ignoraba su clase de anclaje y quedaba clavada a
    // mitad de camino, sin responder ni al arrastre ni al click.
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    // Un gesto CANCELADO no lo terminó el usuario, así que no compromete nada:
    // ni un anclaje nuevo ni la supresión del click.
    //
    // Comprometerlo era además apoyarse en las coordenadas de un
    // `pointercancel`, que la spec no garantiza significativas: con un
    // `clientY` de 0 el desplazamiento final se acota a cero y la hoja se abre
    // entera, tapando el 80% del mapa después de una llamada entrante.
    if (a.movio && !cancelado) {
      suprimirClick.current = true;
      const offsetFinal = limitarOffset(a.offsetInicial + (e.clientY - a.yInicial), a.alto);
      setSnap(snapMasCercano(offsetFinal, a.alto));
    }
    // Siempre, haya movido o no: mientras `dragOffset` no sea null la hoja
    // ignora su clase de anclaje y se queda clavada donde la soltaron.
    setDragOffset(null);
  }, []);

  /**
   * El asa es un BOTÓN y el click cicla los tres puntos. No es un extra: quien
   * navega con teclado no puede arrastrar, y sin esto la hoja se le queda en
   * `peek` para siempre, con los filtros inalcanzables.
   */
  const onClick = useCallback(() => {
    if (suprimirClick.current) {
      suprimirClick.current = false;
      return;
    }
    ciclar();
  }, [ciclar]);

  const asaProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => terminar(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => terminar(e, true),
    onClick,
    // Sin esto el navegador se queda con el gesto vertical para scrollear la
    // página y los `pointermove` dejan de llegar a mitad del arrastre.
    style: { touchAction: 'none' as const },
  };

  return { snap, setSnap, ciclar, dragOffset, hojaRef, asaProps };
}
