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
   *
   * El fallback es `idle ?? empty`: un `idle={null}` (o `undefined`) NO
   * significa "no mostrar nada" — sigue cayendo a `empty`. Para renderizar
   * nada de verdad en este estado hay que pasar `idle={<></>}`.
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
      {/* `common:retry`, no `common:reload`: ese key es de `ErrorBoundary` y
          significa "recargá la página" tras un crash de render — en inglés
          y portugués dice literalmente "Reload"/"Recarregar". Acá no hay
          crash, sólo se vuelve a pedir la query, y en español las dos claves
          coinciden ("Reintentar"), lo que esconde el error en ese idioma. */}
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

function StaleBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('common');

  return (
    // `role="status"` y no `alert`: los datos están en pantalla, así que esto
    // informa, no interrumpe. Un `alert` acá le robaría el foco al lector de
    // pantalla por algo que el usuario puede seguir ignorando.
    <div
      role="status"
      className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950"
    >
      <p className="text-sm text-amber-900 dark:text-amber-200">{t('common:staleTitle')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 text-sm font-semibold text-amber-900 underline dark:text-amber-200"
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

export function ListState<TData, TItem = TData extends (infer U)[] ? U : never>(
  props: ListStateProps<TData, TItem>,
) {
  const { query, loading, empty, idle, errorTitle, errorBody, children } = props;
  const { t } = useTranslation('common');
  const select = (props as { select?: (data: TData) => TItem[] }).select;

  // `select` nunca se llama con `undefined`/`null`. `== null` y no
  // `=== undefined`: el backend arma sus slices con `make([]T, ...)` así que
  // en la práctica Go siempre emite `[]`, nunca `null` — pero este es el ÚNICO
  // choke point que ve a las 12 pantallas portadas, así que blindarlo acá
  // cierra la clase entera de una vez. Sin esto, un `data: null` legítimo
  // (JSON válido) llegaría a `items.length` y tiraría, poniendo en blanco
  // exactamente la pantalla que este componente existe para proteger.
  const items: TItem[] =
    query.data == null
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
  // El `items.length === 0` NO es redundante: React Query CONSERVA los datos
  // cacheados cuando falla un refetch, y ahí `isLoading` es false. Con `isError`
  // a secas, un fallo pasajero —el cold start de Render tras dormirse, un 502—
  // REEMPLAZA una lista ya dibujada por este cartel. Mostrar datos viejos es
  // mejor que borrar los que están; de eso se ocupa la rama de abajo.
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
  return (
    <>
      {query.isError && <StaleBanner onRetry={() => query.refetch()} />}
      {children(items)}
    </>
  );
}
