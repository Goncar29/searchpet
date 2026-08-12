import { describe, it, expect } from 'vitest';
import {
  PEEK_VISIBLE_PX,
  offsetsParaAltura,
  snapMasCercano,
  limitarOffset,
} from './bottomSheetSnap';

describe('offsetsParaAltura', () => {
  it('full no se desplaza, half deja la lista a la vista y peek deja sólo la barra', () => {
    const o = offsetsParaAltura(600);
    expect(o.full).toBe(0);
    expect(o.half).toBe(270); // 45% de 600
    expect(o.peek).toBe(600 - PEEK_VISIBLE_PX);
  });

  // Con la hoja más baja que la barra de peek, `alto - PEEK_VISIBLE_PX` es
  // NEGATIVO: la hoja se desplazaría hacia ARRIBA y taparía el mapa entero,
  // que es lo contrario de lo que peek significa. Pasa de verdad en pantallas
  // muy bajas y con el teclado virtual abierto.
  it('nunca devuelve un desplazamiento negativo', () => {
    const o = offsetsParaAltura(40);
    expect(o.peek).toBe(0);
    expect(o.half).toBeGreaterThanOrEqual(0);
  });
});

describe('snapMasCercano', () => {
  const alto = 600;

  it('elige el punto cuyo desplazamiento está más cerca', () => {
    expect(snapMasCercano(0, alto)).toBe('full');
    expect(snapMasCercano(20, alto)).toBe('full');
    expect(snapMasCercano(260, alto)).toBe('half');
    expect(snapMasCercano(300, alto)).toBe('half');
    expect(snapMasCercano(500, alto)).toBe('peek');
  });

  // Sin un criterio explícito el empate depende del orden de iteración, o sea
  // de un detalle de implementación. Se fija: gana el más ABIERTO, porque
  // soltar a mitad de camino leyendo "quiero ver más" es la lectura correcta
  // de un gesto que quedó indeciso.
  it('ante un empate gana el punto más abierto', () => {
    const { half, peek } = offsetsParaAltura(alto);
    expect(snapMasCercano((half + peek) / 2, alto)).toBe('half');
    expect(snapMasCercano(half / 2, alto)).toBe('full');
  });

  it('un desplazamiento fuera de rango cae al extremo que le corresponde', () => {
    expect(snapMasCercano(-999, alto)).toBe('full');
    expect(snapMasCercano(9999, alto)).toBe('peek');
  });
});

describe('limitarOffset', () => {
  it('acota entre full y peek', () => {
    expect(limitarOffset(-50, 600)).toBe(0);
    expect(limitarOffset(9999, 600)).toBe(600 - PEEK_VISIBLE_PX);
    expect(limitarOffset(123, 600)).toBe(123);
  });
});
