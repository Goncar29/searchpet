import { render, screen } from '@testing-library/react';
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
});
