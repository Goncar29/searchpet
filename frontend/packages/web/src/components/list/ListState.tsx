import { Fragment, isValidElement, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';

/**
 * ¿Este slot dibuja algo?
 *
 * Existe por las secciones que se ESCONDEN cuando no hay nada —el historial de
 * la mascota (`PetDetailPage`) y los reportes del perfil (`ProfilePage`), que
 * pasan `empty={<></>}`, más `AlertsPage`, cuyo ternario da `null` mientras el
 * formulario está abierto. Sin esta pregunta, la franja de "datos viejos" se
 * dibujaba igual: sola, entre dos secciones y sin nada a lo que referirse.
 *
 * Se pregunta acá y NO con una prop (`hiddenWhenEmpty` o similar) a propósito:
 * una prop hay que acordarse de pasarla en cada porte, y olvidarse **no da
 * error, simplemente reaparece la franja huérfana**. Es el modo de falla de la
 * regla #40 — un valor configurable puede ser peor que ninguno cuando lo que se
 * configura es una invariante.
 *
 * **Es recursiva, y esa es la parte que casi sale mal.** La primera versión
 * miraba sólo `children != null`, así que las tres formas que un `empty` toma
 * de verdad cuando no dibuja nada —`<>{cond && <X/>}</>` con la condición en
 * false, `<>{lista.map(...)}</>` con la lista vacía, y un array pelado— volvían
 * `true` y reponían la franja huérfana **en silencio**, que es exactamente el
 * modo de falla que el párrafo de arriba dice evitar. Peor: `false` sí estaba
 * contemplado en el nivel de arriba y no un piso más abajo, o sea que la
 * función era inconsistente consigo misma.
 *
 * Lo que NO detecta, y está bien que no: un `<div/>` vacío o un componente que
 * decide no dibujar nada. Ahí React sí crea un nodo, así que la franja tiene a
 * qué agarrarse; y adivinar lo que devuelve un componente sin renderizarlo no
 * se puede.
 */
function dibujaAlgo(slot: ReactNode): boolean {
  // `typeof === 'boolean'` y no `=== false`: React tampoco dibuja `true`.
  // El `0` queda afuera a propósito — React SÍ lo dibuja, como el texto "0".
  if (slot === null || slot === undefined || typeof slot === 'boolean' || slot === '') return false;
  // Un array dibuja algo si alguno de sus hijos lo hace. Cubre el `.map()` sobre
  // una lista vacía, que es la forma más común de las tres.
  if (Array.isArray(slot)) return slot.some(dibujaAlgo);
  // Un Fragment vale lo que valgan sus hijos, y por eso se pregunta de nuevo:
  // `<><>{null}</></>` no dibuja nada y un chequeo de un solo nivel no lo ve.
  if (isValidElement(slot) && slot.type === Fragment) {
    return dibujaAlgo((slot.props as { children?: ReactNode }).children);
  }
  return true;
}

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
  /**
   * Reescribe el título de **los dos** carteles: el de error y el de sin
   * conexión. No hay prop que los saque.
   *
   * Que valga para los dos es deliberado —una sección sin encabezado propio
   * necesita nombrarse igual en las dos ramas—, pero tiene una consecuencia
   * para quien lo pasa: **un título específico de un fallo de servidor** (algo
   * como "El servidor no respondió") **también va a aparecer estando offline**,
   * donde es falso. Escribí un título que nombre la SECCIÓN, no la causa.
   */
  errorTitle?: string;
  /**
   * Reescribe el cuerpo del cartel de error. **No** toca el de sin conexión: el
   * título dice QUÉ falló y el cuerpo POR QUÉ, y la causa sí es distinta en
   * cada rama.
   */
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

function StaleBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('common');

  return (
    // `role="status"` y no `alert`: los datos están en pantalla, así que esto
    // informa, no interrumpe. Un `alert` acá le robaría el foco al lector de
    // pantalla por algo que el usuario puede seguir ignorando.
    //
    // `col-span-full w-full`: la primitiva no sabe si su padre es un grid, un
    // flex o un block — `LeaderboardPage` la envuelve en un `grid`, y sin esto
    // la franja se convierte en la PRIMER CELDA de esa grilla en vez de ocupar
    // toda la fila, empujando cada card una posición (272px medidos). En
    // flex/block, `col-span-full` no hace nada: es la única declaración
    // correcta en los dos mundos.
    <div
      role="status"
      className="col-span-full w-full mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950"
    >
      <p className="text-sm text-amber-900 dark:text-amber-200">{message}</p>
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
  //
  // Este guard cubre el nivel de arriba (`query.data`), pero NO el de abajo:
  // el RETORNO de `select` estaba sin blindar, y una `select` que devuelve
  // `null`/`undefined` sobre datos que sí llegaron caía igual en
  // `items.length` un piso más abajo — la misma pantalla en blanco. Por eso
  // el `?? []` final envuelve el resultado de `select`, no sólo su entrada.
  const raw =
    query.data == null ? [] : select ? select(query.data) : (query.data as unknown as TItem[]);
  const items: TItem[] = raw ?? [];

  // `query.data == null` y NO `items.length === 0`: `items` sale DESPUÉS de
  // `select`, así que una tajada vacía de datos que SÍ tenemos —el usuario
  // tiene mascotas pero ninguna en adopción— no es ignorancia, es una
  // respuesta. Decir "no pudimos leer" ahí es el ESPEJO exacto del bug que
  // esta primitiva existe para matar: afirmar ignorancia donde hay un hecho
  // cacheado, en vez de afirmar un hecho donde hay ignorancia.
  const sinDatos = query.data == null;

  // Fragmentos y no `<div>`: la primitiva NO envuelve ningún slot. El esqueleto
  // de `LeaderboardPage` vive dentro de un `grid` y su posición está medida —
  // se midió un salto horizontal de 272px cuando cambió de columna. Un wrapper
  // lo rompería, y el salto es invisible en una captura y en cualquier test.
  if (query.isLoading) return <>{loading}</>;
  // `isPaused` ANTES que `isPending`, y no al revés: React Query pausa una query
  // cuando el navegador está offline (`fetchStatus: 'paused'`), y en ese estado
  // `isFetching` es false, así que `isLoading` también. Sin esta rama, una
  // primera carga sin conexión cae en la de abajo y dice "no tenés nada" — la
  // mentira exacta que este componente existe para matar, y justo cuando el
  // usuario menos puede saber que es mentira.
  if (query.isPaused && sinDatos) {
    return (
      <QueryErrorCard
        // `errorTitle` también acá. La rama de error lo usaba y ésta no, así
        // que una pantalla con DOS secciones sin encabezado propio —el perfil,
        // con `useMyPets` y `useReportedPets`— dibujaba offline dos carteles
        // idénticos y sin nada que los distinga: el nombre de la sección
        // faltaba justo en el estado donde más falta hace.
        title={errorTitle ?? t('common:offlineTitle')}
        // El cuerpo NO se sobreescribe con `errorBody`, y la asimetría es el
        // diseño: el título dice QUÉ falló (la sección, que es la misma en las
        // dos ramas) y el cuerpo dice POR QUÉ (offline contra fallo del
        // servidor). Pisarlo con la explicación de un error de servidor borra
        // la única parte accionable — "cuando vuelva la conexión, probá de
        // nuevo" — mientras el usuario está sin red.
        body={t('common:offlineBody')}
        onRetry={() => query.refetch()}
      />
    );
  }
  // Acá `isPending` sí significa una sola cosa: la query está DESHABILITADA
  // (`enabled: false`), porque el caso offline se fue en la rama de arriba.
  if (query.isPending) return <>{idle ?? empty}</>;
  // `sinDatos` (`query.data == null`) y NO `items.length === 0`: React Query
  // CONSERVA los datos cacheados cuando falla un refetch, y ahí `isLoading` es
  // false. Con `isError` a secas, un fallo pasajero —el cold start de Render
  // tras dormirse, un 502— REEMPLAZA una lista ya dibujada por este cartel.
  // Mostrar datos viejos es mejor que borrar los que están; de eso se ocupa la
  // rama de abajo, que ahora también cubre el caso de una tajada vacía sobre
  // datos reales.
  if (query.isError && sinDatos) {
    return (
      <QueryErrorCard
        title={errorTitle ?? t('common:loadErrorTitle')}
        body={errorBody ?? t('common:loadErrorBody')}
        onRetry={() => query.refetch()}
      />
    );
  }
  // La franja va ARRIBA de lo que sea que se muestre —el slot `empty` incluido—
  // porque en los dos casos hay un dato cacheado que puede estar vencido: un
  // `[]` real (no hay nada en adopción) y un `[]` post-`select` sobre datos
  // reales que no pudimos refrescar se ven idénticos en `items`, y en los dos
  // el usuario tiene derecho a saber que lo que ve puede no ser lo último.
  const banner = query.isPaused ? (
    <StaleBanner message={t('common:offlineStale')} onRetry={() => query.refetch()} />
  ) : query.isError ? (
    <StaleBanner message={t('common:staleTitle')} onRetry={() => query.refetch()} />
  ) : null;

  // La franja acompaña a algo que está en pantalla. Si el slot `empty` no
  // dibuja nada —la sección se esconde cuando está vacía— quedaría flotando
  // sola, entre dos secciones, diciendo "estás viendo datos de hace un rato"
  // sobre el vacío. Ahí el silencio es lo correcto: no se afirma nada, así que
  // tampoco hay nada que calificar.
  //
  // Ojo con la mitad de al lado, que NO cambia: con un `empty` VISIBLE la
  // franja SÍ va, y es el caso más valioso de los dos — "no tenés alertas" es
  // una afirmación, y una afirmación vencida es exactamente la mentira que esta
  // primitiva existe para matar.
  if (items.length === 0) return <>{dibujaAlgo(empty) ? banner : null}{empty}</>;
  return <>{banner}{children(items)}</>;
}
