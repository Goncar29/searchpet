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
 */
function fakeQuery<T>({
  data,
  isPending = false,
  isFetching = false,
  isError = false,
  refetch = vi.fn(),
}: {
  data?: T;
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  refetch?: () => void;
}): UseQueryResult<T> {
  return {
    data,
    isPending,
    isFetching,
    isLoading: isPending && isFetching,
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

  it('un refetch fallido CONSERVA la lista y avisa, no la borra', () => {
    render(
      <ListState
        query={fakeQuery<string[]>({ data: ['a', 'b'], isError: true })}
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
  });
});
