// Las ramas de `ListState` que ninguna pantalla ejercita hoy.
//
// El feed sólo la usa con una query que carga, falla o trae datos. Las otras
// tres —cargando, deshabilitada, y una `select` que devuelve `null`— viven en el
// componente sin un consumidor que las toque, y una rama sin test no es
// protección: es una afirmación. Acá se le arma el estado a mano, que es lo
// único que las alcanza.
//
// `t()` devuelve la clave porque el arnés no inicializa i18next. La copy de
// verdad se afirma en `onlineStatus.test.tsx`, contra los locales reales.
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import type { UseQueryResult } from '@tanstack/react-query';

import { ListState } from '../components/list/ListState';

// El retorno se anota `UseQueryResult<unknown[]>` y no `any`, y eso lo impuso el
// tipo condicional de `select`: con `any` la inferencia daba `TData = unknown`,
// que NO extiende `unknown[]`, así que `select` pasaba a ser obligatoria y las
// seis llamadas de este archivo no compilaban. Fue el primer consumidor real
// que ejercitó ese invariante — el call site del feed pasa `any` y por eso no
// lo tocaba.
function estadoDeQuery(over: Record<string, unknown> = {}): UseQueryResult<unknown[]> {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isPaused: false,
    isError: false,
    refetch: jest.fn(),
    ...over,
  } as unknown as UseQueryResult<unknown[]>;
}

const cargando = <Text>[esqueleto]</Text>;
const lista = (items: unknown[]) => <Text>{`[lista: ${items.length}]`}</Text>;

describe('ListState — las ramas sin consumidor', () => {
  it('mientras carga muestra el slot de carga y nada más', () => {
    const { queryByText } = render(
      <ListState query={estadoDeQuery({ isLoading: true, isPending: true })} loading={cargando}>
        {lista}
      </ListState>,
    );

    expect(queryByText('[esqueleto]')).toBeTruthy();
    expect(queryByText(/\[lista:/)).toBeNull();
    expect(queryByText(/common:loadErrorTitle/)).toBeNull();
  });

  // Una query deshabilitada (`enabled: false`) queda en `pending` PARA SIEMPRE:
  // nunca carga y nunca falla. Si cayera en el cartel de error, la pantalla
  // diría "no pudimos leer" sobre algo que jamás se pidió. Se cae a la lista
  // vacía, que es exactamente lo que mostraba antes del porte.
  it('una query deshabilitada dibuja la lista vacía, no un error', () => {
    const { queryByText } = render(
      <ListState query={estadoDeQuery({ isPending: true })} loading={cargando}>
        {lista}
      </ListState>,
    );

    expect(queryByText('[lista: 0]')).toBeTruthy();
    expect(queryByText('[esqueleto]')).toBeNull();
    expect(queryByText(/common:loadErrorTitle/)).toBeNull();
  });

  // EL ORDEN DE LAS RAMAS, que es lo que el componente afirma en un comentario
  // y hasta ahora no verificaba nadie. Sin red, React Query pausa la query: ahí
  // `isFetching` es false, así que `isLoading` también, y la query sigue
  // `pending`. Si `isPending` se evaluara primero, una primera carga sin
  // conexión caería en la lista vacía y la pantalla diría "no hay nada cerca" —
  // la mentira exacta que esta primitiva existe para matar, y justo cuando el
  // usuario está en la calle y menos puede saber que es mentira.
  it('sin red y pendiente a la vez gana el cartel de sin conexión', () => {
    const { queryByText } = render(
      <ListState
        query={estadoDeQuery({ isPending: true, isPaused: true })}
        loading={cargando}
      >
        {lista}
      </ListState>,
    );

    expect(queryByText(/common:offlineTitle/)).toBeTruthy();
    expect(queryByText('[lista: 0]')).toBeNull();
  });

  // El `?? []` de abajo. `query.data == null` protege la ENTRADA de `select`,
  // pero su RETORNO también puede ser null sobre datos que sí llegaron, y eso
  // caía un piso más abajo en `items.length`: pantalla en blanco, justo el
  // componente que existe para que no haya pantallas en blanco.
  it('una select que devuelve null sobre datos reales no rompe nada', () => {
    const { queryByText } = render(
      <ListState
        query={estadoDeQuery({ data: { data: null } })}
        loading={cargando}
        select={(d: any) => d.data}
      >
        {lista}
      </ListState>,
    );

    expect(queryByText('[lista: 0]')).toBeTruthy();
  });

  it('select no se llama cuando no hay datos', () => {
    const select = jest.fn();

    render(
      <ListState query={estadoDeQuery({ isError: true })} loading={cargando} select={select}>
        {lista}
      </ListState>,
    );

    expect(select).not.toHaveBeenCalled();
  });
});

// ── Accesibilidad ────────────────────────────────────────────────────────
//
// La web distingue `role="alert"` (no quedó nada en pantalla) de `role="status"`
// (los datos siguen ahí). React Native NO tiene `status`, así que la distinción
// viaja en la urgencia del live region: `assertive` contra `polite`.
describe('ListState — lo que anuncia un lector de pantalla', () => {
  // Se lee del árbol renderizado y no con `getByRole`, porque el rol NO es el
  // mecanismo acá: en React Native un View sin `accessible` no es elemento de
  // accesibilidad, así que `accessibilityRole="alert"` suelto no lo lee nadie y
  // un test que lo afirmara pasaría contra una versión que no anuncia nada.
  function liveRegions(json: any, out: (string | undefined)[] = []): (string | undefined)[] {
    if (!json || typeof json === 'string') return out;
    if (Array.isArray(json)) {
      json.forEach((n) => liveRegions(n, out));
      return out;
    }
    if (json.props?.accessibilityLiveRegion) out.push(json.props.accessibilityLiveRegion);
    liveRegions(json.children, out);
    return out;
  }

  // `flex: 1` NO alcanza para que el cartel se vea. Dentro de un `ScrollView`
  // sin `contentContainerStyle` con `flexGrow`, un hijo con `flex: 1` resuelve a
  // `flexBasis: 0` sin espacio libre donde crecer: queda en ALTURA CERO. Es el
  // caso del detalle de mascota, donde el cartel del historial aterriza dentro
  // de un ScrollView cuyo contenedor sólo tiene padding.
  //
  // Ningún otro test lo puede ver: todos afirman texto presente en el árbol, y
  // un componente de alto cero SIGUE estando en el árbol. O sea que la suite
  // entera daría verde con el cartel invisible en el device — un verde que no
  // mide lo que uno cree.
  //
  // El `minHeight` es monótono: donde ya hay lugar (el feed, Adoptar, Mis
  // mascotas, que ocupan la pantalla) `flex: 1` da más y esto no cambia nada.
  it('el cartel no puede colapsar a altura cero dentro de un ScrollView', () => {
    function estiloDelCartel(json: any): any {
      if (!json || typeof json === 'string') return null;
      if (Array.isArray(json)) {
        for (const n of json) {
          const hit = estiloDelCartel(n);
          if (hit) return hit;
        }
        return null;
      }
      if (json.props?.accessibilityLiveRegion === 'assertive') return json.props.style;
      return estiloDelCartel(json.children);
    }

    const { toJSON } = render(
      <ListState query={estadoDeQuery({ isError: true })} loading={cargando}>
        {lista}
      </ListState>,
    );

    const estilo = estiloDelCartel(toJSON());
    expect(estilo).toBeTruthy();
    const aplanado = Array.isArray(estilo) ? Object.assign({}, ...estilo) : estilo;
    expect(aplanado.minHeight).toBeGreaterThan(0);
  });

  it('el cartel interrumpe: se anuncia assertive', () => {
    const { toJSON } = render(
      <ListState query={estadoDeQuery({ isError: true })} loading={cargando}>
        {lista}
      </ListState>,
    );

    expect(liveRegions(toJSON())).toEqual(['assertive']);
  });

  // La otra mitad, y sin ella la de arriba se satisface poniendo `assertive` en
  // todos lados: la franja NO interrumpe, porque la lista sigue en pantalla y
  // se puede usar. Cortar a alguien a mitad de una lista que funciona es peor
  // que esperar al próximo hueco.
  it('la franja no interrumpe: se anuncia polite', () => {
    const { toJSON, getByText } = render(
      <ListState query={estadoDeQuery({ isError: true, data: ['x'] })} loading={cargando}>
        {lista}
      </ListState>,
    );

    expect(liveRegions(toJSON())).toEqual(['polite']);
    expect(getByText('[lista: 1]')).toBeTruthy();
  });

  // Se afirma el EFECTO y no la prop: por default RNTL excluye de sus queries
  // lo que está oculto al árbol de accesibilidad, así que no encontrar el emoji
  // ES la prueba de que un lector tampoco lo encuentra. Afirmar
  // `props.importantForAccessibility === 'no'` pasaría igual si esa prop no
  // llegara nunca al componente nativo.
  it('el ⚠️ no se lee: es decoración delante de la frase que importa', () => {
    const { queryByText, getByText } = render(
      <ListState query={estadoDeQuery({ isError: true })} loading={cargando}>
        {lista}
      </ListState>,
    );

    expect(queryByText('⚠️')).toBeNull();
    // Y sigue dibujado en pantalla: esconderlo del lector no es borrarlo.
    expect(getByText('⚠️', { includeHiddenElements: true })).toBeTruthy();
  });
});
