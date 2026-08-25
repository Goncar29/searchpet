import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

interface BaseProps<TItem> {
  /** Lo que se ve mientras la query trae datos por primera vez. */
  loading: ReactNode;
  /** Lo que se ve cuando la query respondió y no hay nada. */
  empty: ReactNode;
  children: (items: TItem[]) => ReactNode;
}

/**
 * `select` lo exige el tipo SOLO cuando hace falta.
 *
 * Los hooks del repo no coinciden en forma: `useMyPets` devuelve el array
 * pelado, `useStories` un `StoryListResponse`, `useUserReviews` un
 * `{ reviews }` y `useAdoptions` un sobre paginado. La alternativa —que la
 * pantalla pase `items={q.data?.data ?? []}`— reintroduce exactamente el `?? []`
 * que esta primitiva viene a borrar.
 */
type SelectProp<TData, TItem> = TData extends TItem[]
  ? { select?: (data: TData) => TItem[] }
  : { select: (data: TData) => TItem[] };

export type ListStateProps<TData, TItem> = BaseProps<TItem> & {
  query: UseQueryResult<TData>;
} & SelectProp<TData, TItem>;

export function ListState<TData, TItem>(props: ListStateProps<TData, TItem>) {
  const { query, loading, empty, children } = props;
  const select = (props as { select?: (data: TData) => TItem[] }).select;

  // `select` nunca se llama con `undefined`.
  const items: TItem[] =
    query.data === undefined
      ? []
      : select
        ? select(query.data)
        : (query.data as unknown as TItem[]);

  // Fragmentos y no `<div>`: la primitiva NO envuelve ningún slot. El esqueleto
  // de `LeaderboardPage` vive dentro de un `grid` y su posición está medida —
  // se midió un salto horizontal de 272px cuando cambió de columna. Un wrapper
  // lo rompería, y el salto es invisible en una captura y en cualquier test.
  if (query.isLoading) return <>{loading}</>;
  if (items.length === 0) return <>{empty}</>;
  return <>{children(items)}</>;
}
