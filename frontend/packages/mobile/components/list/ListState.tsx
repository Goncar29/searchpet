import type { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { COLORS, SPACING, FONTS } from '../../constants';

/**
 * Decides what a list screen shows: loading, offline, load error, or the data.
 *
 * It exists because `query.data ?? []` turns "we could not read this" into
 * "there is nothing here". The two look identical on screen and only one of
 * them is true. On the feed the empty copy even says *"no lost pets in your
 * area. That's good!"* — so a failed request made the app congratulate the user
 * while the server was down, on the home tab of an app for finding lost pets.
 *
 * Mirrors `web/src/components/list/ListState.tsx` — same branch order, same
 * `common:*` keys (they live in `shared/i18n`, so mobile gets them for free).
 * Two deliberate divergences, both because React Native has `FlatList` and the
 * web does not:
 *
 * 1. **There is no `empty` slot.** The list's own `ListEmptyComponent` already
 *    owns "we asked and there is nothing", and moving that out of the list
 *    would take pull-to-refresh with it — on a phone that is the gesture people
 *    actually reach for. So this component never replaces an empty list, it
 *    only replaces a list we could not fill.
 * 2. **No `dibujaAlgo` check.** That guard exists on web for sections that hide
 *    themselves when empty, so the stale banner would not float over nothing.
 *    No mobile screen does that yet. Adding the guard now would be a branch no
 *    consumer exercises, and an untested branch is not protection — it is a
 *    claim. When a screen needs it, it can port the web version.
 */

interface BaseProps<TItem> {
  /** What shows while the query loads for the first time. */
  loading: ReactNode;
  /**
   * Receives the items. Render your `FlatList` here and let its
   * `ListEmptyComponent` handle the genuinely-empty case.
   */
  children: (items: TItem[]) => ReactNode;
  /**
   * Rewrites the title of **both** cards: load error and offline.
   *
   * That it covers both is deliberate — a section without its own heading has
   * to name itself the same way in either branch — but it has a consequence for
   * whoever passes it: a title specific to a server failure ("The server did
   * not answer") will ALSO show up offline, where it is false. Write a title
   * that names the SECTION, not the cause.
   */
  errorTitle?: string;
  /**
   * Rewrites the body of the load-error card. Does **not** touch the offline
   * one: the title says WHAT failed and the body says WHY, and the why really
   * is different in each branch.
   */
  errorBody?: string;
}

/**
 * `select` lo exige el tipo SOLO cuando hace falta.
 *
 * Los hooks del repo no coinciden en forma: `useNearbyReports` devuelve el array
 * pelado y `useSearchPets` un sobre `{ data, total }`. Con `select?:` a secas, la
 * próxima pantalla que envuelva un hook con sobre y se olvide de pasarla le
 * termina dando el OBJETO a `<FlatList data={...}>`: la lista sale vacía, sin
 * excepción y sin error de compilación — o sea idéntica a "no hay nada", que es
 * exactamente la mentira que esta primitiva existe para matar, entrando por la
 * puerta de atrás. La alternativa —que la pantalla pase `q.data?.data ?? []`—
 * reintroduce el mismo `?? []` que se vino a borrar.
 *
 * Mismo tipo que `web/src/components/list/ListState.tsx`.
 */
type SelectProp<TData, TItem> = TData extends TItem[]
  ? { select?: (data: TData) => TItem[] }
  : { select: (data: TData) => TItem[] };

export type ListStateProps<TData, TItem> = BaseProps<TItem> & {
  query: UseQueryResult<TData>;
} & SelectProp<TData, TItem>;

function StateCard({
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
    <View style={styles.card}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <TouchableOpacity style={styles.retry} onPress={onRetry}>
        {/* `common:retry` y no `common:reload`: esa clave es del ErrorBoundary y
            significa "recargá la app" tras un crash de render — en inglés y
            portugués dice literalmente "Reload"/"Recarregar". Acá no hubo
            ningún crash, sólo se vuelve a pedir la query. En español las dos
            coinciden ("Reintentar"), y eso esconde el error justo en el idioma
            en el que más se prueba. */}
        <Text style={styles.retryText}>{t('common:retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function StaleBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('common');

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      <TouchableOpacity onPress={onRetry} hitSlop={8}>
        <Text style={styles.bannerRetry}>{t('common:retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function ListState<TData, TItem = TData extends (infer U)[] ? U : never>(
  props: ListStateProps<TData, TItem>,
) {
  const { query, loading, children, errorTitle, errorBody } = props;
  const { t } = useTranslation('common');
  // El cast es el precio del tipo condicional: `select` existe en las dos ramas
  // de `SelectProp`, pero TS no lo puede estrechar sin saber cuál es `TData`.
  const select = (props as { select?: (data: TData) => TItem[] }).select;

  // `select` nunca se llama con `undefined`/`null`, y el `?? []` de afuera cubre
  // el otro piso: una `select` que devuelve `null` sobre datos que SÍ llegaron
  // caería igual en `items.length`. Es el único punto por el que pasan todas las
  // pantallas que adopten esto, así que blindar los dos niveles acá cierra la
  // clase entera en vez de dejarla en cada call site.
  const raw =
    query.data == null ? [] : select ? select(query.data) : (query.data as unknown as TItem[]);
  const items: TItem[] = raw ?? [];

  // `query.data == null` y NO `items.length === 0`. `items` sale DESPUÉS de
  // `select`, así que una tajada vacía sobre datos que sí tenemos es una
  // RESPUESTA, no ignorancia. Decir "no pudimos leer" ahí sería el espejo exacto
  // del bug que esta primitiva viene a matar.
  const sinDatos = query.data == null;

  if (query.isLoading) return <>{loading}</>;

  // `isPaused` ANTES que `isPending`, y no al revés: React Query pausa la query
  // cuando el dispositivo está sin red (`fetchStatus: 'paused'`), y ahí
  // `isFetching` es false, así que `isLoading` también. Sin esta rama una
  // primera carga sin conexión cae abajo y la pantalla dice "no hay nada cerca"
  // — la mentira exacta que esto existe para matar, y justo cuando el usuario
  // está en la calle y menos puede saber que es mentira.
  if (query.isPaused && sinDatos) {
    return (
      <StateCard
        title={errorTitle ?? t('common:offlineTitle')}
        // El cuerpo NO se pisa con `errorBody`, y la asimetría es el diseño:
        // pisarlo con la explicación de un error de servidor borra la única
        // parte accionable —"cuando vuelva la conexión, probá de nuevo"—
        // justamente mientras el usuario no tiene conexión.
        body={t('common:offlineBody')}
        onRetry={() => query.refetch()}
      />
    );
  }

  // Acá `isPending` ya significa una sola cosa: la query está DESHABILITADA
  // (`enabled: false`), porque el caso sin red se fue en la rama de arriba. Se
  // cae a `children([])`, o sea la lista con su `ListEmptyComponent` — que es
  // exactamente lo que la pantalla mostraba antes de este cambio. El porte no
  // altera el significado de ninguna pantalla.
  if (query.isPending) return <>{children([])}</>;

  // `sinDatos` y NO `isError` a secas: React Query CONSERVA lo cacheado cuando
  // falla un refetch. Con `isError` pelado, un cold start de Render o un 502
  // pasajero REEMPLAZA una lista ya dibujada por este cartel. Mostrar datos
  // viejos avisando es mejor que borrar los que están; de eso se ocupa la franja.
  if (query.isError && sinDatos) {
    return (
      <StateCard
        title={errorTitle ?? t('common:loadErrorTitle')}
        body={errorBody ?? t('common:loadErrorBody')}
        onRetry={() => query.refetch()}
      />
    );
  }

  // La franja va ARRIBA de la lista incluso cuando la lista está vacía: un `[]`
  // real y un `[]` que no pudimos refrescar se ven idénticos, y en los dos el
  // usuario tiene derecho a saber que lo que ve puede no ser lo último.
  const banner = query.isPaused ? (
    <StaleBanner message={t('common:offlineStale')} onRetry={() => query.refetch()} />
  ) : query.isError ? (
    <StaleBanner message={t('common:staleTitle')} onRetry={() => query.refetch()} />
  ) : null;

  return (
    <>
      {banner}
      {children(items)}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  icon: {
    fontSize: 44,
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  body: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  retry: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
  },
  retryText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: FONTS.sizes.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  bannerText: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: '#78350F',
  },
  bannerRetry: {
    fontSize: FONTS.sizes.sm,
    fontWeight: '700',
    color: '#78350F',
    textDecorationLine: 'underline',
  },
});
