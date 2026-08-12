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
 * Sin `matchMedia` devuelve `false`.
 *
 * **Ojo con lo que eso significa, porque este comentario decía otra cosa.**
 * Afirmaba que el fallback deja "el panel fijo de escritorio, exactamente el
 * layout que ya funcionaba", y eso vale SÓLO de `lg` para arriba, donde la
 * columna la producen las clases `lg:static lg:h-auto lg:translate-y-0`. Abajo
 * de 1024px, con `esHoja` en false, el `aside` conserva su base
 * `absolute inset-x-0 bottom-0 h-[80%]` y no recibe transformación: queda
 * abierto del todo tapando el 80% del mapa, sin poder arrastrarlo (el arrastre
 * está detrás de `activo`) y con el click del asa cambiando `snap` sin efecto
 * visible. Peor que el layout anterior, no igual.
 *
 * Ese escenario **no es alcanzable hoy**: sin `matchMedia` la app no llega ni a
 * renderizar, porque `ThemeContext.tsx:15` y `InstallPWA.tsx:15` la llaman sin
 * guarda. Comprobado — quitándola, el `aside` nunca aparece. Así que el riesgo
 * real es nulo y el `false` sigue siendo la respuesta correcta: es la única que
 * no rompe escritorio, que es donde la falla sí sería visible.
 *
 * Queda anotado porque la guarda promete una robustez que no tiene. Si algún
 * día se quiere de verdad, el camino es sacarle a JavaScript la decisión:
 * mover el desplazamiento a una custom property que `lg:translate-y-0` pueda
 * pisar, y con eso este hook deja de hacer falta.
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
