import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';

interface BaseProps<TItem> {
  /** Lo que se ve mientras la query trae datos por primera vez. */
  loading: ReactNode;
  /** Lo que se ve cuando la query respondió y no hay nada. */
  empty: ReactNode;
  /**
   * Query deshabilitada (`enabled: false`): nunca se la pidió, así que no
   * sabemos nada. Por default cae al slot `empty`, que es exactamente lo que
   * las pantallas mostraban antes de este cambio — el port no altera el
   * significado de ninguna pantalla.
   */
  idle?: ReactNode;
  children: (items: TItem[]) => ReactNode;
  /** Reescribe el título del cartel de error. No hay prop que lo saque. */
  errorTitle?: string;
  /** Reescribe el cuerpo del cartel de error. */
  errorBody?: string;
}

function QueryErrorCard({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    // `role="alert"` y no `status`: acá no quedó NADA en pantalla, así que
    // interrumpir es correcto. La franja de datos viejos hace lo contrario, por
    // el motivo opuesto.
    <div role="alert" className="text-center py-16">
      <Icon name="warning" className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
      <p className="text-gray-700 dark:text-gray-300 font-semibold mb-1">{title}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
      >
        {t('common:retry')}
      </button>
    </div>
  );
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
  const { query, loading, empty, idle, errorTitle, errorBody, children } = props;
  const { t } = useTranslation('common');
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
  // `isLoading` es `isPending && isFetching`, así que llegar acá con `isPending`
  // todavía en true significa una sola cosa: la query está deshabilitada. La
  // rama existe para NOMBRAR ese caso, no para que se caiga de rebote.
  if (query.isPending) return <>{idle ?? empty}</>;
  if (query.isError && items.length === 0) {
    return (
      <QueryErrorCard
        title={errorTitle ?? t('common:loadErrorTitle')}
        body={errorBody ?? t('common:loadErrorBody')}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (items.length === 0) return <>{empty}</>;
  return <>{children(items)}</>;
}
