import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { ListState } from './ListState';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

/**
 * Un `UseQueryResult` falso.
 *
 * `isLoading` NO es un parámetro: se DERIVA con la fórmula de React Query v5
 * (`isPending && isFetching`). Si fuera un booleano suelto, un test podría
 * pedir `isPending: true, isLoading: true, isFetching: false` — un estado que
 * la librería no produce nunca — y el verde no diría nada sobre el mundo real.
 * En particular, es lo que hace que el caso de la query DESHABILITADA
 * (`isPending && !isFetching`) sea representable acá tal como ocurre en prod.
 *
 * `fetchStatus` es la MISMA idea un nivel más abajo, y por el mismo motivo:
 * `isFetching`/`isLoading`/`isPaused` se derivan de él tal como hace
 * `queryObserver.js` (`isFetching = fetchStatus === 'fetching'`,
 * `isPaused = fetchStatus === 'paused'`). Sin esto un test podría pedir
 * `isPaused: true, isFetching: true` — otro estado que React Query nunca
 * produce — y ocultar el bug exacto que motivó esta extensión: offline
 * (`fetchStatus: 'paused'`) da `isFetching: false`, así que `isLoading`
 * también es `false` y una carga inicial sin conexión NO cae en la rama
 * `isLoading`. `isFetching` como booleano suelto sigue aceptándose para no
 * romper los call sites viejos: mapea a `fetchStatus: 'fetching' | 'idle'`.
 */
function fakeQuery<T>({
  data,
  isPending = false,
  isFetching,
  fetchStatus,
  isError = false,
  refetch = vi.fn(),
}: {
  data?: T;
  isPending?: boolean;
  isFetching?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  isError?: boolean;
  refetch?: () => void;
}): UseQueryResult<T> {
  const resolvedFetchStatus = fetchStatus ?? (isFetching ? 'fetching' : 'idle');
  const resolvedIsFetching = resolvedFetchStatus === 'fetching';
  const isPaused = resolvedFetchStatus === 'paused';
  return {
    data,
    isPending,
    fetchStatus: resolvedFetchStatus,
    isFetching: resolvedIsFetching,
    isLoading: isPending && resolvedIsFetching,
    isPaused,
    isError,
    error: isError ? new Error('boom') : null,
    refetch,
  } as unknown as UseQueryResult<T>;
}

describe('ListState', () => {
  it('renderiza los datos cuando la query trae items', () => {
    render(
      <ListState
        query={fakeQuery<string[]>({ data: ['a', 'b'] })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('a,b')).toBeInTheDocument();
  });

  it('exige `select` cuando la data no es un array', () => {
    // El tipo es lo único que impide que una pantalla con sobre paginado
    // caiga de nuevo en `?? []`. Si `select` dejara de ser obligatorio acá,
    // el `@ts-expect-error` quedaría sin usar y `tsc` se pondría en rojo.
    // En runtime los tipos ya están borrados: si igual compilara sin `select`,
    // `items` sería el sobre entero (`{ data: [...] }`) y `.join` no existe en
    // un objeto — por eso se espera el throw, no un render limpio. La prueba
    // que importa de verdad es la de tipos (ver el `tsc` en el reporte).
    expect(() =>
      render(
        // @ts-expect-error falta `select`: `{ data: string[] }` no es `string[]`
        <ListState
          query={fakeQuery<{ data: string[] }>({ data: { data: ['a'] } })}
          loading={<p>cargando</p>}
          empty={<p>vacio</p>}
        >
          {(items) => <p>{items.join(',')}</p>}
        </ListState>,
      ),
    ).toThrow();
  });

  it('usa `select` para desenvolver un sobre paginado', () => {
    render(
      <ListState
        query={fakeQuery<{ data: string[] }>({ data: { data: ['a'] } })}
        select={(d) => d.data}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('una query deshabilitada NO muestra el esqueleto para siempre', () => {
    // `enabled: false` en v5 = pending eterno, fetching false. Ramar con
    // `isPending` le daría a LostPetStep un esqueleto infinito al usuario sin
    // sesión.
    render(
      <ListState
        query={fakeQuery<string[]>({ isPending: true, isFetching: false })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.queryByText('cargando')).not.toBeInTheDocument();
    expect(screen.getByText('vacio')).toBeInTheDocument();
  });

  it('usa el slot idle cuando la pantalla ofrece uno', () => {
    render(
      <ListState
        query={fakeQuery<string[]>({ isPending: true, isFetching: false })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
        idle={<p>entra para ver</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('entra para ver')).toBeInTheDocument();
    expect(screen.queryByText('vacio')).not.toBeInTheDocument();
  });

  it('sin datos y con error muestra el cartel, no el vacio', () => {
    render(
      <ListState
        query={fakeQuery<string[]>({ isError: true })}
        loading={<p>cargando</p>}
        empty={<p>no tenes nada</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('common:loadErrorTitle')).toBeInTheDocument();
    expect(screen.getByText('common:loadErrorBody')).toBeInTheDocument();
    // Lo que define todo este trabajo: la pantalla NO afirma que no hay nada.
    expect(screen.queryByText('no tenes nada')).not.toBeInTheDocument();
  });

  it('el cartel de error es un role=alert', () => {
    render(
      <ListState
        query={fakeQuery<string[]>({ isError: true })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('common:loadErrorTitle');
  });

  it('reintentar llama a refetch', async () => {
    const refetch = vi.fn();
    const user = userEvent.setup();
    render(
      <ListState
        query={fakeQuery<string[]>({ isError: true, refetch })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    await user.click(screen.getByRole('button', { name: 'common:retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('una lista realmente vacia muestra el slot empty', () => {
    // Rama 4: la query respondió bien y no hay nada. Es el ÚNICO camino que
    // llega acá — los otros tests que ven `empty` entran por el default de
    // `idle` (rama 2), así que sin este test la rama 4 se puede borrar entera
    // y la suite sigue verde. Medido.
    render(
      <ListState
        query={fakeQuery<string[]>({ data: [] })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('vacio')).toBeInTheDocument();
    expect(screen.queryByText('cargando')).not.toBeInTheDocument();
  });

  it('un refetch fallido CONSERVA la lista y avisa, no la borra', async () => {
    const refetch = vi.fn();
    const user = userEvent.setup();
    render(
      <ListState
        query={fakeQuery<string[]>({ data: ['a', 'b'], isError: true, refetch })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    // Los datos viejos siguen ahí...
    expect(screen.getByText('a,b')).toBeInTheDocument();
    // ...el cartel que los reemplazaría NO está...
    expect(screen.queryByText('common:loadErrorTitle')).not.toBeInTheDocument();
    // ...y el usuario se entera de que son viejos.
    expect(screen.getByRole('status')).toHaveTextContent('common:staleTitle');
    // ...y el botón de la franja es su ÚNICA forma de refrescar: tiene que
    // llamar a refetch de verdad, no ser un botón decorativo.
    await user.click(screen.getByRole('button', { name: 'common:retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('no envuelve los slots en ningun elemento', () => {
    // `LeaderboardPage` pone su esqueleto dentro de un `grid` y su posición está
    // medida: un wrapper lo saca de la columna que le toca. El salto es
    // invisible en una captura, así que esta aserción es la única defensa.
    const { container } = render(
      <ListState
        query={fakeQuery<string[]>({ data: ['a'] })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {() => <p data-testid="fila">fila</p>}
      </ListState>,
    );

    expect(screen.getByTestId('fila').parentElement).toBe(container);
  });

  it('no envuelve el slot loading en ningun elemento', () => {
    // El caso que la regla realmente protege es el esqueleto de
    // `LeaderboardPage`, o sea el slot `loading` — el test anterior sólo
    // cubre `children`, y envolver `loading` en un `<div>` lo dejaría pasar.
    const { container } = render(
      <ListState
        query={fakeQuery<string[]>({ isPending: true, isFetching: true })}
        loading={<p data-testid="esqueleto">cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByTestId('esqueleto').parentElement).toBe(container);
  });

  it('carga inicial offline muestra el cartel de sin conexion, no el vacio', () => {
    // `fetchStatus: 'paused'` es como React Query representa un fetch que no
    // pudo ni arrancar por falta de red (`networkMode: 'online'`, el default
    // del proyecto). Ahí `isFetching` es false, así que `isLoading` también —
    // sin una rama propia esto caía en la de `isPending` y mentía "no tenés
    // nada" en la primera carga sin conexión.
    render(
      <ListState
        query={fakeQuery<string[]>({ isPending: true, fetchStatus: 'paused' })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('common:offlineTitle')).toBeInTheDocument();
    expect(screen.queryByText('vacio')).not.toBeInTheDocument();
  });

  it('offline con datos en cache conserva la lista y avisa que esta offline', () => {
    // Distinto del refetch fallido: acá no hubo error, la conexión simplemente
    // no está. El cartel tiene que decir "estás viendo datos guardados", no
    // "no pudimos actualizar" — lo segundo sugeriría un fallo del servidor que
    // nunca ocurrió.
    render(
      <ListState
        query={fakeQuery<string[]>({ data: ['a', 'b'], fetchStatus: 'paused' })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('a,b')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('common:offlineStale');
    expect(screen.queryByText('common:staleTitle')).not.toBeInTheDocument();
  });

  it('una query deshabilitada de verdad (fetchStatus idle) sigue usando idle ?? empty', () => {
    // Guarda de no-regresión: separar la rama offline de la de `isPending` no
    // puede tocar el caso real de `enabled: false`, que sigue siendo
    // `fetchStatus: 'idle'` (nunca 'paused', porque nunca se intentó nada).
    render(
      <ListState
        query={fakeQuery<string[]>({ isPending: true, fetchStatus: 'idle' })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('vacio')).toBeInTheDocument();
  });

  it('la franja de datos viejos ocupa todo el ancho, no una sola celda del grid', () => {
    // La primitiva no sabe si su padre es un grid, un flex o un block.
    // `LeaderboardPage` envuelve `ListState` en un `grid`: sin `col-span-full`
    // la franja se convierte en la PRIMER CELDA de esa grilla, empujando cada
    // card una posición — un salto invisible en una captura.
    render(
      <ListState
        query={fakeQuery<string[]>({ data: ['a', 'b'], isError: true })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    const banner = screen.getByRole('status');
    expect(banner.className).toMatch(/\bcol-span-full\b/);
    expect(banner.className).toMatch(/\bw-full\b/);
  });

  it('un select que devuelve null no rompe el render, cae a lista vacia', () => {
    // El guard de `query.data == null` sólo cubría el nivel de arriba. Un
    // `select` cuyo RETORNO es null/undefined —sobre datos que sí llegaron—
    // llegaba sin blindar a `items.length` y tiraba, la misma pantalla en
    // blanco un nivel más abajo.
    render(
      <ListState
        query={fakeQuery<{ data: string[] | null }>({ data: { data: null } })}
        select={(d) => d.data as unknown as string[]}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('vacio')).toBeInTheDocument();
  });

  it('la pantalla puede reescribir el texto del cartel', () => {
    render(
      <ListState
        query={fakeQuery<string[]>({ isError: true })}
        loading={<p>cargando</p>}
        empty={<p>vacio</p>}
        errorTitle="No pudimos cargar tus mascotas"
        errorBody="Probá de nuevo."
      >
        {(items) => <p>{items.join(',')}</p>}
      </ListState>,
    );

    expect(screen.getByText('No pudimos cargar tus mascotas')).toBeInTheDocument();
    expect(screen.getByText('Probá de nuevo.')).toBeInTheDocument();
  });
});
