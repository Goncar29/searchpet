/**
 * Aritmética de la hoja inferior del mapa. Sin DOM y sin React a propósito: es
 * la única parte del gesto que se puede probar sin un navegador de verdad.
 *
 * El "offset" es cuánto está desplazada la hoja hacia ABAJO desde su posición
 * abierta, en píxeles. Cero es la hoja entera a la vista.
 */
export type SnapPoint = 'peek' | 'half' | 'full';

/** Cuánto de la hoja queda visible en `peek`: el asa más la barra de resumen. */
export const PEEK_VISIBLE_PX = 96;

/**
 * `half` es una FRACCIÓN de la altura de la hoja y no una medida en vh, para
 * que estas cuentas y las clases de Tailwind (`translate-y-[45%]`, que también
 * es porcentaje de la propia altura) describan exactamente lo mismo. Con dos
 * unidades distintas, arrastrar y soltar movería la hoja un poco respecto de
 * donde el CSS la deja.
 */
export const SNAP_HALF_FRACTION = 0.45;

export function offsetsParaAltura(alto: number): Record<SnapPoint, number> {
  return {
    full: 0,
    half: Math.max(0, alto * SNAP_HALF_FRACTION),
    // Nunca negativo: con una hoja más baja que la barra, `alto - 96` daría un
    // desplazamiento hacia arriba y `peek` taparía el mapa entero.
    peek: Math.max(0, alto - PEEK_VISIBLE_PX),
  };
}

export function limitarOffset(offset: number, alto: number): number {
  const { peek } = offsetsParaAltura(alto);
  return Math.min(Math.max(offset, 0), peek);
}

/**
 * El punto de anclaje más cercano al desplazamiento donde el usuario soltó.
 *
 * El orden de iteración NO es incidental: define el desempate. Se recorre de
 * más abierto a más cerrado con comparación estricta, así que a mitad de camino
 * exacto gana el más abierto.
 */
export function snapMasCercano(offset: number, alto: number): SnapPoint {
  const offsets = offsetsParaAltura(alto);
  const orden: SnapPoint[] = ['full', 'half', 'peek'];
  let elegido: SnapPoint = 'full';
  let mejor = Infinity;
  for (const punto of orden) {
    const distancia = Math.abs(offset - offsets[punto]);
    if (distancia < mejor) {
      mejor = distancia;
      elegido = punto;
    }
  }
  return elegido;
}
