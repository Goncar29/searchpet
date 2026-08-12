import { useEffect, useState } from 'react';

/**
 * Complemento EXACTO del `lg:` de Tailwind, que emite `(width >= 64rem)`.
 *
 * Va en **rem y no en px** por la regla #29: en una media query el `rem` se
 * resuelve contra el tamaño de fuente por defecto del NAVEGADOR, así que
 * `(min-width: 1024px)` y `lg:` discrepan en cuanto alguien agranda la fuente.
 * Si esta consulta y las clases `lg:` no coinciden, el panel se comporta como
 * hoja mientras el CSS lo dibuja como columna fija — el peor de los dos.
 */
export const CONSULTA_HOJA = 'not all and (min-width: 64rem)';

/**
 * Falla ABIERTO: sin `matchMedia` devuelve `false`, o sea el panel fijo de
 * escritorio, que es exactamente el layout que ya funcionaba antes de la
 * rebanada 3. El modo hoja aplica transformaciones y un arrastre; activarlo por
 * error dejaría el panel corrido en una pantalla que no lo espera, mientras que
 * NO activarlo sólo pierde el gesto.
 */
function leer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(CONSULTA_HOJA).matches;
}

export function useEsHoja(): boolean {
  const [esHoja, setEsHoja] = useState(leer);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(CONSULTA_HOJA);
    const alCambiar = (e: MediaQueryListEvent) => setEsHoja(e.matches);
    mql.addEventListener('change', alCambiar);
    // Volver a leer al montar: entre el `useState` inicial y este efecto puede
    // haber cambiado el ancho (rotar el teléfono durante la hidratación).
    setEsHoja(mql.matches);
    return () => mql.removeEventListener('change', alCambiar);
  }, []);

  return esHoja;
}
