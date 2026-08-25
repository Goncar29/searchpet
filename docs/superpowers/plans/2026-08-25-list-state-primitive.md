# ListState Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `ListState` primitive that makes it structurally impossible for a failed list query to render as an empty list, then port the 12 web screens that currently conflate the two.

**Architecture:** One component owns the branching order (`loading → idle → error → empty → data`) and renders the error card itself; each screen keeps its own loading skeleton and empty state as slots. The component takes the whole `UseQueryResult` so `refetch` is wired for free, and a `select` prop (type-required only when the query's data is not already an array) replaces every `?? []`.

**Tech Stack:** React 18, TypeScript, `@tanstack/react-query` v5.51, Vitest + React Testing Library, react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-25-list-state-primitive-design.md`

---

## File Structure

| file | responsibility |
|---|---|
| `frontend/packages/shared/i18n/locales/{es,en,pt}.json` | four new `common` keys — this namespace is shared with mobile, it is NOT in the web locales |
| `frontend/packages/web/src/components/list/ListState.tsx` | the branching order, the error card, the stale banner |
| `frontend/packages/web/src/components/list/ListState.test.tsx` | one test per branch, each proven red first |
| the 12 screens in Tasks 9-19 | each drops its own branching and keeps its slots |

`ListState.tsx` holds the two small presentational pieces (`QueryErrorCard`, `StaleBanner`) rather than splitting them out: they have exactly one caller, they change when the branching changes, and separating them would make the invariant comments live away from the code they constrain.

## Commands you will need

```bash
# All web tests (Vitest). Run from the web package.
cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx

# One test by name
cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx -t "nombre del test"

# The shared-locale parity test (Task 1 needs this one)
cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts
```

**Verify with the exit code, never with a grep over the output** (rule #41):

```bash
pnpm vitest run src/components/list/ListState.test.tsx > /tmp/out.log 2>&1; echo "EXIT=$?"
```

`EXIT=0` is green. Anything else, read the log.

---

# PR 1 — the primitive

Branch: `feat/list-state-primitive`, cut from `origin/main` (rule #30).

```bash
git fetch origin && git checkout -b feat/list-state-primitive origin/main
```

### Task 1: The four shared i18n keys

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json` (the `common` object)
- Modify: `frontend/packages/shared/i18n/locales/en.json` (the `common` object)
- Modify: `frontend/packages/shared/i18n/locales/pt.json` (the `common` object)

These go in **shared**, not in `web/src/i18n/locales/`. `web/src/i18n/index.ts` builds `common` from `sharedEs.common` / `sharedEn.common` / `sharedPt.common`; a key added to the web locales would sit where nothing reads it and would render as the raw key on screen (rule #21).

- [ ] **Step 1: Add the keys to all three files at once**

`shared/i18n/locales/es.json`, inside `"common"`:

```json
    "loadErrorTitle": "No pudimos cargar esta lista",
    "loadErrorBody": "No es que no haya nada: no llegamos a leerla. Probá de nuevo.",
    "retry": "Reintentar",
    "staleTitle": "No pudimos actualizar. Estás viendo datos de hace un rato."
```

`shared/i18n/locales/en.json`, inside `"common"`:

```json
    "loadErrorTitle": "We couldn't load this list",
    "loadErrorBody": "It's not that there's nothing here — we couldn't read it. Try again.",
    "retry": "Try again",
    "staleTitle": "We couldn't refresh. You're seeing data from a moment ago."
```

`shared/i18n/locales/pt.json`, inside `"common"`:

```json
    "loadErrorTitle": "Não conseguimos carregar esta lista",
    "loadErrorBody": "Não é que não haja nada: não conseguimos ler. Tente de novo.",
    "retry": "Tentar de novo",
    "staleTitle": "Não conseguimos atualizar. Você está vendo dados de um tempo atrás."
```

`common:retry` is a **new** key, not a reuse of the existing `common:reload`. Both read "Reintentar", but `reload` belongs to `ErrorBoundary` and means *reload the page* after a render crash (its sibling `common:errorDescription` says "intentá recargar la página"). This button refetches one query and leaves the page alone.

- [ ] **Step 2: Run the shared locale parity test**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts`
Expected: PASS. `shared/i18n/locales.test.ts` asserts the three files carry the same keys — this
parity test was added by this change, because the design's original claim that it already existed
was checked and found false; the file previously only asserted the no-asterisk rule from PR #185.
This step now also fails if you added a key to only one language.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json
git commit -m "feat(i18n): claves comunes para el estado de error de una lista"
```

---

### Task 2: The test harness

**Files:**
- Create: `frontend/packages/web/src/components/list/ListState.test.tsx`

The harness is the part of this task that matters. It must model the **v5 relationship between the flags**, not expose them as three independent booleans — otherwise a test can express a state React Query never produces, and a green test would prove nothing about the real thing.

- [ ] **Step 1: Write the harness and one trivially passing test**

```tsx
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: FAIL — `Failed to resolve import "./ListState"`. The component does not exist yet.

---

### Task 3: The component skeleton — branches 1, 4 and 5

**Files:**
- Create: `frontend/packages/web/src/components/list/ListState.tsx`

- [ ] **Step 1: Write the minimal implementation**

```tsx
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/components/list/ListState.tsx frontend/packages/web/src/components/list/ListState.test.tsx
git commit -m "feat(web): ListState con las ramas de carga, vacio y datos"
```

---

### Task 4: The disabled-query branch

This is the branch that stops the primitive from introducing a **worse** bug than the one it fixes. In React Query v5 a query with `enabled: false` sits at `status: 'pending'` forever — it was never asked. More than 20 hooks in `shared/hooks/index.ts` pass `enabled` (`useMyPets(isAuthenticated)`, `useReportsByPetID` with `enabled: !!petID`, `useUserReviews` with `enabled: !!userId`), so this is wide, not a corner.

- [ ] **Step 1: Write the failing test**

Append to `ListState.test.tsx`, inside the `describe`:

```tsx
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
```

- [ ] **Step 2: Run to verify the second one fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: the `idle` test FAILS — `Unable to find an element with the text: entra para ver`. The first test already passes, because `isLoading` is derived and is already `false` here; that is the point, and it is what will go red if someone later swaps `isLoading` for `isPending`.

- [ ] **Step 3: Add the `idle` slot and the named branch**

In `ListState.tsx`, add `idle?: ReactNode;` to `BaseProps`:

```tsx
  /**
   * Query deshabilitada (`enabled: false`): nunca se la pidió, así que no
   * sabemos nada. Por default cae al slot `empty`, que es exactamente lo que
   * las pantallas mostraban antes de este cambio — el port no altera el
   * significado de ninguna pantalla.
   */
  idle?: ReactNode;
```

Destructure it and insert the branch right after the `isLoading` one:

```tsx
  const { query, loading, empty, idle, children } = props;
```

```tsx
  if (query.isLoading) return <>{loading}</>;
  // `isLoading` es `isPending && isFetching`, así que llegar acá con `isPending`
  // todavía en true significa una sola cosa: la query está deshabilitada. La
  // rama existe para NOMBRAR ese caso, no para que se caiga de rebote.
  if (query.isPending) return <>{idle ?? empty}</>;
  if (items.length === 0) return <>{empty}</>;
```

- [ ] **Step 4: Run to verify both pass**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Prove the first test can go red**

Temporarily change `if (query.isLoading)` to `if (query.isPending)` and re-run.
Expected: FAIL — `una query deshabilitada NO muestra el esqueleto para siempre` fails, because `cargando` is now on screen. **Revert the change** and re-run to confirm PASS again. A test never seen red proves nothing (rule #34).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/list/ListState.tsx frontend/packages/web/src/components/list/ListState.test.tsx
git commit -m "fix(web): ListState no cuelga en una query deshabilitada"
```

---

### Task 5: The error card

**Files:**
- Modify: `frontend/packages/web/src/components/list/ListState.tsx`
- Modify: `frontend/packages/web/src/components/list/ListState.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
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
```

Add the import at the top of the test file:

```tsx
import userEvent from '@testing-library/user-event';
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: the four new tests FAIL — `Unable to find an element with the text: common:loadErrorTitle`. Right now an errored query with no data falls through to the `empty` slot, which is precisely the defect.

- [ ] **Step 3: Implement the card**

In `ListState.tsx`, add the imports:

```tsx
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
```

Add the component above `ListState`:

```tsx
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
```

Add the two props to `BaseProps`:

```tsx
  /** Reescribe el título del cartel de error. No hay prop que lo saque. */
  errorTitle?: string;
  /** Reescribe el cuerpo del cartel de error. */
  errorBody?: string;
```

In `ListState`, destructure them, pull `t`, and add the branch **after** `isPending` and **before** the empty check:

```tsx
  const { query, loading, empty, idle, errorTitle, errorBody, children } = props;
  const { t } = useTranslation('common');
```

```tsx
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/components/list/ListState.tsx frontend/packages/web/src/components/list/ListState.test.tsx
git commit -m "feat(web): ListState distingue una lista caida de una vacia"
```

---

### Task 6: The stale banner

The branch that keeps a transient failure from erasing a drawn list. This is `LeaderboardPage`'s lesson, generalized: React Query **keeps cached data when a refetch fails**, and `isLoading` is `false` there. Guarding on `isError` alone would replace a working list with an error card every time Render cold-starts.

- [ ] **Step 1: Write the failing test**

```tsx
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx -t "refetch fallido"`
Expected: FAIL — `Unable to find an accessible element with the role "status"`. The list already survives (the `items.length === 0` guard is already in the error branch); what is missing is the banner.

- [ ] **Step 3: Implement the banner**

Add above `ListState`:

```tsx
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
```

Replace the final return of `ListState`:

```tsx
  return (
    <>
      {query.isError && <StaleBanner onRetry={() => query.refetch()} />}
      {children(items)}
    </>
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Prove the guard can go red**

Temporarily drop `&& items.length === 0` from the error branch and re-run.
Expected: FAIL — `un refetch fallido CONSERVA la lista y avisa, no la borra` fails, because `a,b` is gone and the error card took the screen. **Revert** and re-run to confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/list/ListState.tsx frontend/packages/web/src/components/list/ListState.test.tsx
git commit -m "feat(web): ListState avisa cuando muestra datos desactualizados"
```

---

### Task 7: The no-wrapper guarantee

- [ ] **Step 1: Write the failing test**

```tsx
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
```

- [ ] **Step 2: Run to verify it passes, then prove it can fail**

Run: `cd frontend/packages/web && pnpm vitest run src/components/list/ListState.test.tsx -t "no envuelve"`
Expected: PASS.

Now temporarily change the final return to `<div>{children(items)}</div>` and re-run.
Expected: FAIL — the parent is the injected `div`, not the container. **Revert** and re-run to confirm PASS.

- [ ] **Step 3: Run the whole web suite**

Run: `cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`.

- [ ] **Step 4: Commit and open the PR**

```bash
git add frontend/packages/web/src/components/list/ListState.test.tsx
git commit -m "test(web): ListState no agrega un wrapper alrededor de los slots"
git push -u origin feat/list-state-primitive
```

Open the PR following the `searchpet-pr` skill. Body in Spanish; if it closes an issue, the keyword must be **English** (`Closes #N`) or it closes nothing (rule #49).

---

# The porting recipe

Every screen in Tasks 8-19 follows the same five moves. Read this once.

1. **Find the conflating branch.** It is the ternary that goes `isLoading ? … : <empty-ish check> ? … : <list>`.
2. **Keep the loading JSX verbatim** — it becomes the `loading` slot. Do not redesign it.
3. **Keep the empty JSX verbatim** — it becomes the `empty` slot. But **re-read its copy**: if it asserts a fact the screen cannot know when the query failed ("you have no pets"), that copy is now correct, because it only renders in branch 4.
4. **Delete the `?? []` / `?.map` / `!x ||` guard.** Whatever it was doing moves into `select`.
5. **Add exactly one test**: with the query returning an error, the screen does **not** show the empty copy.

The per-screen test always looks like this — adapt the hook name, the mock path and the empty string:

```tsx
it('con la query caida NO dice que no hay nada', () => {
  vi.mocked(useMyPets).mockReturnValue(
    { data: undefined, isPending: false, isFetching: false, isLoading: false,
      isError: true, error: new Error('boom'), refetch: vi.fn() } as never,
  );

  renderPage();

  expect(screen.queryByText('pets:mine.empty')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});
```

---

# PR 2 — the two highest-traffic screens

Branch: `feat/list-state-my-pets-home`, cut from `origin/main` after PR 1 merges.

### Task 8: MyPetsPage

**Files:**
- Modify: `frontend/packages/web/src/pages/MyPetsPage.tsx:276-291` and `:356-386`
- Modify: `frontend/packages/web/src/pages/MyPetsPage.test.tsx`

This screen is **not** a two-query merge. It renders one query per **tab**: `useMyPets` for `owned` and `adoption`, `useReportedPets` for `reported`. `splitOwnedPets` derives the first two from the same response, which makes it a natural `select`.

- [ ] **Step 1: Write the failing test**

Append to `MyPetsPage.test.tsx`:

```tsx
  it('con useMyPets caido NO dice que no tenes mascotas', () => {
    vi.mocked(useMyPets).mockReturnValue(
      { data: undefined, isPending: false, isFetching: false, isLoading: false,
        isError: true, error: new Error('boom'), refetch: vi.fn() } as never,
    );

    renderMyPets();

    expect(screen.queryByText('pets:mine.empty')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
```

If `renderMyPets` does not already exist in that file, use whatever render helper the file already defines; do not add a second one.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/MyPetsPage.test.tsx -t "NO dice que no tenes mascotas"`
Expected: FAIL — `pets:mine.empty` **is** on screen. That is the defect, reproduced.

- [ ] **Step 3: Replace lines 276-291 with the per-tab query pick**

```tsx
  const ownedQuery = useMyPets();
  const reportedQuery = useReportedPets();
  const deletePet = useDeletePet();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Adoption listings are owned pets too, but they get their own tab so
  // they don't clutter "Mis mascotas" (which is for the owner's regular pets).
  //
  // El corte vive en `shared/utils/ownedPetBuckets` y no acá: lo consumen esta
  // pantalla y el perfil. Escrito a mano en los dos lados, agregar un estado
  // rompería uno solo, en silencio.
  //
  // Las pestañas `owned` y `adoption` salen de la MISMA query y se separan con
  // `select`; `reported` es otra query. Por eso acá se elige la query y su
  // `select` juntos: si se eligieran por separado, una pestaña podría terminar
  // leyendo el `select` de la otra.
  const query = tab === 'reported' ? reportedQuery : ownedQuery;
  const selectPets = (pets: Pet[]) =>
    tab === 'owned'
      ? splitOwnedPets(pets).owned
      : tab === 'adoption'
        ? splitOwnedPets(pets).adoption
        : pets;

  const emptyText =
    tab === 'owned'
      ? t('pets:mine.empty')
      : tab === 'reported'
        ? t('pets:reports.empty')
        : t('adoption:profile.empty');
```

Add `Pet` to the existing type import from `@shared/types` if it is not already there.

- [ ] **Step 4: Replace the render branch at lines 356-386**

```tsx
        <ListState
          query={query}
          select={selectPets}
          loading={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          }
          empty={
            <div className="text-center py-20">
              <p className="text-gray-500 dark:text-gray-400 mb-4">{emptyText}</p>
              {tab === 'owned' && (
                <Link
                  to="/pets/create"
                  className="inline-block bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-6 py-2 transition-colors"
                >
                  {t('pets:mine.emptyAction')}
                </Link>
              )}
            </div>
          }
        >
          {(pets) => (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pets.map((pet) => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  onDelete={handleDelete}
                  confirmingId={confirmingId}
                  onRequestConfirm={setConfirmingId}
                />
              ))}
            </div>
          )}
        </ListState>
```

Add the import: `import { ListState } from '../components/list/ListState';`

- [ ] **Step 5: Run the file's tests**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/MyPetsPage.test.tsx`
Expected: PASS, including the new test. If an older test asserted the empty copy while mocking a **failed** query, that test was encoding the bug — update it to mock a successful empty response instead.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/MyPetsPage.tsx frontend/packages/web/src/pages/MyPetsPage.test.tsx
git commit -m "fix(web): Mis mascotas ya no dice que no tenes ninguna cuando falla la carga"
```

---

### Task 9: HomePage (the feed)

**Files:**
- Modify: `frontend/packages/web/src/pages/HomePage.tsx:318` and `:799-860`
- Modify: `frontend/packages/web/src/pages/HomePage.test.tsx`

The feed sits in the `else` of the `imageResults` ternary. Only that half moves; the photo-search branch above it is unrelated and stays untouched.

- [ ] **Step 1: Write the failing test**

```tsx
  it('con la busqueda caida NO muestra el vacio del feed', () => {
    vi.mocked(useSearchPets).mockReturnValue(
      { data: undefined, isPending: false, isFetching: false, isLoading: false,
        isError: true, error: new Error('boom'), refetch: vi.fn() } as never,
    );

    renderHome();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/HomePage.test.tsx -t "NO muestra el vacio del feed"`
Expected: FAIL — no `alert` on screen; the feed silently shows its empty state.

- [ ] **Step 3: Change the query destructure at line 318**

```tsx
  const searchQuery = useSearchPets({ /* los mismos argumentos que ya tenía */ });
```

Keep the argument object exactly as it is today. Then delete the now-unused `searchResults` and `isLoading` bindings, and fix any other reference to them in the file — `isLoading` is used only by the branch you are about to replace.

- [ ] **Step 4: Replace the `isLoading ? … : …` half at lines 799-860**

```tsx
        ) : (
          <ListState
            query={searchQuery}
            select={(res) => res.data}
            loading={
              <div className="text-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500 dark:text-gray-400">{t('common:loading')}</p>
              </div>
            }
            empty={
              // Este vacío ya dice lo correcto: "no hay resultados" para los
              // filtros puestos, no "no hay mascotas". Es el cuarto estado que
              // el spec nombra —filtro sin coincidencias— y se queda tal cual.
              <div className="text-center py-12">
                <Icon name="search" className="mx-auto mb-4 text-5xl text-gray-300 dark:text-gray-600" />
                <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">{t('home:noResults.title')}</p>
                <p className="text-gray-500 dark:text-gray-400 mb-4">{t('home:noResults.hint')}</p>
                <button onClick={clearFilters} className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
                  {t('home:filters.clear')}
                </button>
              </div>
            }
          >
            {(pets) => (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {pets.map((pet: Pet) => (
                  /* el <Link> de la tarjeta, sin un solo cambio: líneas 809-860 de hoy */
                ))}
              </div>
            )}
          </ListState>
        )}
```

The card markup inside `.map` moves **verbatim**. Do not restyle it in this task — a port and a redesign in one commit make the review useless.

- [ ] **Step 5: Run the file's tests**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/HomePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the whole web suite and commit**

```bash
cd frontend/packages/web && pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"
git add frontend/packages/web/src/pages/HomePage.tsx frontend/packages/web/src/pages/HomePage.test.tsx
git commit -m "fix(web): el feed avisa cuando no pudo cargar en vez de decir que no hay nada"
git push -u origin feat/list-state-my-pets-home
```

Before merging, drive the browser with the `/verify` skill: block `GET /api/pets/search` and confirm the feed shows the card and not the empty state. The original defect was found by driving the browser, not by the suite.

---

# PRs 3-6 — the remaining ten screens

Each task below follows the porting recipe. They are ordered by PR.

## PR 3 — branch `feat/list-state-adopt-alerts-stories`

### Task 10: AdoptPage

**Files:** `frontend/packages/web/src/pages/AdoptPage.tsx:35-40` and `:115-160`; test `AdoptPage.test.tsx`

- [ ] **Step 1:** Write the failing test per the recipe. Hook: `useAdoptions`. The empty copy is the block rendered when `pets.length > 0` is false.
- [ ] **Step 2:** Run it. Expected FAIL — the empty copy is on screen.
- [ ] **Step 3:** Replace `const { data, isLoading } = useAdoptions({…})` with `const adoptionsQuery = useAdoptions({…})` and **delete line 40, `const pets = data?.data ?? [];`** — that `?? []` is the defect. Pass `select={(res) => res.data}`.
- [ ] **Step 4:** Wrap the branch at 115-160: the spinner block becomes `loading`, the `pets.length > 0` body becomes `children`, the final block becomes `empty`.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/AdoptPage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Commit: `fix(web): Adoptar distingue una carga fallida de no tener publicaciones`

### Task 11: AlertsPage

**Files:** `frontend/packages/web/src/pages/AlertsPage.tsx:24-29` and `:256-290`; test `AlertsPage.test.tsx`

Note this screen renders its states as three sibling blocks (`{isLoading && …}`, `{!isLoading && alerts.length === 0 && …}`, `{!isLoading && alerts.length > 0 && …}`), not as one ternary. All three collapse into one `ListState`.

- [ ] **Step 1:** Write the failing test per the recipe. Hook: `useAlerts`.
- [ ] **Step 2:** Run it. Expected FAIL.
- [ ] **Step 3:** Replace `const { data, isLoading } = useAlerts();` with `const alertsQuery = useAlerts();` and **delete `const alerts: LocationAlert[] = data ?? [];`**.
- [ ] **Step 4:** `line 120` reads `disabled={alerts.length >= MAX_ALERTS}` and sits **outside** the list branch. It needs a count that survives the port: derive it as `const alertCount = alertsQuery.data?.length ?? 0;` — this `?? 0` is fine, it feeds a disabled attribute and not a user-facing claim about emptiness.
- [ ] **Step 5:** Wrap the three sibling blocks in one `ListState`. `select` is not needed; `useAlerts` returns the array.
- [ ] **Step 6:** Run `pnpm vitest run src/pages/AlertsPage.test.tsx`. Expected PASS.
- [ ] **Step 7:** Commit: `fix(web): Alertas avisa cuando no pudo cargar la lista`

### Task 12: StoriesPage

**Files:** `frontend/packages/web/src/pages/StoriesPage.tsx:13` and `:42-70`; test `StoriesPage.test.tsx`

- [ ] **Step 1:** Write the failing test per the recipe. Hook: `useStories`.
- [ ] **Step 2:** Run it. Expected FAIL.
- [ ] **Step 3:** Replace `const { data: stories, isLoading } = useStories({ limit: 20 });` with `const storiesQuery = useStories({ limit: 20 });`. `useStories` returns `StoryListResponse`, so `select` is **required** by the type — pass `select={(res) => res.data}`. If the response field is named differently, read `StoryListResponse` in `shared/types` and use the real field; do not guess.
- [ ] **Step 4:** Wrap the ternary at 42-70.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/StoriesPage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Commit: `fix(web): Historias distingue una carga fallida de no haber historias`

## PR 4 — branch `feat/list-state-pet-detail-report-wizard`

### Task 13: PetDetailPage (the timeline)

**Files:** `frontend/packages/web/src/pages/PetDetailPage.tsx:28` and `:664-712`; test `PetDetailPage.test.tsx`

This one is different: when `reports` fails, the timeline section **disappears entirely** rather than showing an empty state. The user never learns there was a timeline.

- [ ] **Step 1:** Write the failing test. Mock `useReportsByPetID` as errored and assert `screen.getByRole('alert')` is present.
- [ ] **Step 2:** Run it. Expected FAIL — nothing renders where the timeline was.
- [ ] **Step 3:** Replace `const { data: reports } = useReportsByPetID(id || '');` with `const reportsQuery = useReportsByPetID(id || '');`.
- [ ] **Step 4:** Note line 485, `<PdfFlyerButton pet={pet} reports={reports ?? []} />`, sits outside the timeline branch. Keep it working with `reports={reportsQuery.data ?? []}` — the flyer degrades correctly with no reports and makes no claim to the user.
- [ ] **Step 5:** Wrap the `{reports && reports.length > 0 && (…)}` block at 664-712 in a `ListState` whose `empty` is the section header with no timeline (the current silent-nothing case, now explicit). `useReportsByPetID` is `enabled: !!petID`, so the `idle` default matters here — with no id, it falls to `empty`, which is today's behavior.
- [ ] **Step 6:** Run `pnpm vitest run src/pages/PetDetailPage.test.tsx`. Expected PASS.
- [ ] **Step 7:** Commit: `fix(web): el historial de la mascota avisa cuando no pudo cargar`

### Task 14: CreateReportPage (the original case)

**Files:** `frontend/packages/web/src/pages/CreateReportPage.tsx`; test `CreateReportPage.test.tsx`

The list here feeds a `<select>`, not a grid. The `empty`/`error` states render **next to** the control, not in place of it, because the rest of the form must stay usable.

- [ ] **Step 1:** Write the failing test: mock `useMyPets` as errored, assert the pet `<select>` is not silently left with only its placeholder — `screen.getByRole('alert')` is present.
- [ ] **Step 2:** Run it. Expected FAIL. This is the exact case measured on 2026-08-24.
- [ ] **Step 3:** Replace the `myPets?.map(...)` inside the `<select>` with a `ListState` wrapping **only the `<option>` list**, with `loading` = a disabled placeholder option and `empty` = the current placeholder-only state.
- [ ] **Step 4:** Because `FormField` owns the control's wiring, the error card must render **outside** the `<select>` and inside the field's block — an `<option>` cannot contain a `<div>`. Put the `ListState` around the field's body, not around the `<option>` elements, if step 3 turns out to nest invalid markup. Verify by reading the rendered HTML in the test.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/CreateReportPage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Commit: `fix(web): el selector de mascota avisa cuando no pudo leer la lista`

### Task 15: LostPetStep

**Files:** `frontend/packages/web/src/components/publish/LostPetStep.tsx:15-40`; test alongside `PublishWizardPage.test.tsx`

`useMyPets(isAuthenticated)` is the **disabled-query** case that Task 4 exists for. Confirm by hand that a signed-out user does not see a skeleton.

- [ ] **Step 1:** Write two failing tests: (a) errored query does not say "no tenés mascotas"; (b) signed-out (`isAuthenticated: false`) renders the `idle`/`empty` slot and **not** the loading slot.
- [ ] **Step 2:** Run them. Expected: (a) FAILS; (b) passes today and must keep passing — it is the regression guard for the port.
- [ ] **Step 3:** Replace `const { data: pets, isLoading } = useMyPets(isAuthenticated);` with `const petsQuery = useMyPets(isAuthenticated);` and **delete both `(pets ?? [])` expressions** at lines 19 and 26.
- [ ] **Step 4:** `eligiblePets` and `ownsAnyPet` both derive from the same array. Compute them inside `children`, not outside — outside they would need a `?? []` again.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/PublishWizardPage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Commit: `fix(web): el paso de mascota perdida avisa cuando no pudo leer tus mascotas`

## PR 5 — branch `feat/list-state-profiles`

### Task 16: ProfilePage

**Files:** `frontend/packages/web/src/pages/ProfilePage.tsx:309-310`, `:947`, `:1002`; test `ProfilePage.test.tsx`

The largest screen in the set. It reads `useMyPets` and `useReportedPets` and renders **two** sections from them, so it gets **two** `ListState` instances, not one.

- [ ] **Step 1:** Write the failing test per the recipe against the owned-pets section.
- [ ] **Step 2:** Run it. Expected FAIL.
- [ ] **Step 3:** Wrap the `ownedPets.length > 0` section at line 947 in a `ListState` over the `useMyPets` query with `select={(pets) => splitOwnedPets(pets).owned}`.
- [ ] **Step 4:** Wrap the `!petsLoading && adoptionPets.length > 0` section at line 1002 in a second `ListState` over the same query with `select={(pets) => splitOwnedPets(pets).adoption}`. Two instances over one query is correct and costs nothing — React Query dedupes by key.
- [ ] **Step 5:** Leave `(badges ?? [])` at lines 517 and 893 **alone**. Badges are decoration attached to a profile that already loaded; there is no "you have no badges" claim being made that could be a lie. Out of scope, and say so in the PR body.
- [ ] **Step 6:** Run `pnpm vitest run src/pages/ProfilePage.test.tsx`. Expected PASS.
- [ ] **Step 7:** Commit: `fix(web): el perfil avisa cuando no pudo cargar tus mascotas`

### Task 17: UserProfilePage (the reviews list only)

**Files:** `frontend/packages/web/src/pages/UserProfilePage.tsx:152`, `:460`; test `UserProfilePage.test.tsx`

The profile itself already handles failure at line 234 (`if (error || !profile)`). Only the reviews list conflates.

- [ ] **Step 1:** Write the failing test: mock `useUserReviews` as errored, assert `reviews.length === 0` copy is absent and an `alert` is present.
- [ ] **Step 2:** Run it. Expected FAIL.
- [ ] **Step 3:** Delete `const reviews = reviewsData?.reviews ?? [];` at line 152 and wrap the block at 460 in a `ListState` over the reviews query with `select={(res) => res.reviews}`.
- [ ] **Step 4:** `useUserReviews` is `enabled: !!userId`, so the `idle` branch applies. Default (falls to `empty`) is correct here.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/UserProfilePage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Commit: `fix(web): las resenas avisan cuando no pudieron cargar`

## PR 6 — branch `feat/list-state-admin`

### Task 18: admin/AbuseReportsPage

**Files:** `frontend/packages/web/src/pages/admin/AbuseReportsPage.tsx:32-42`, `:127-160`; test `AbuseReportsPage.test.tsx`

- [ ] **Step 1:** Write the failing test per the recipe. This screen uses a raw `useQuery`, not a shared hook — mock at the `apiClient.listAbuseReports` level or render with a `QueryClientProvider` whose query fails.
- [ ] **Step 2:** Run it. Expected FAIL.
- [ ] **Step 3:** Delete `const reports = result?.data ?? [];` at line 42 and pass `select={(res) => res.data}`.
- [ ] **Step 4:** Wrap the ternary at 127-160.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/admin/AbuseReportsPage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Commit: `fix(web): las denuncias avisan cuando no pudieron cargar`

### Task 19: admin/StoriesAdminPage

**Files:** `frontend/packages/web/src/pages/admin/StoriesAdminPage.tsx:21`, `:56-90`; test — this file has **no test file today**, create `StoriesAdminPage.test.tsx`

- [ ] **Step 1:** Create the test file with the recipe's single test. Model the render helper on `SheltersAdminPage.test.tsx`, which covers a sibling admin screen.
- [ ] **Step 2:** Run it. Expected FAIL.
- [ ] **Step 3:** Delete `const stories = result?.data ?? [];` at line 21 and pass `select={(res) => res.data}`.
- [ ] **Step 4:** Wrap the ternary at 56-90.
- [ ] **Step 5:** Run `pnpm vitest run src/pages/admin/StoriesAdminPage.test.tsx`. Expected PASS.
- [ ] **Step 6:** Run the whole web suite: `pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"`. Expected `EXIT=0`.
- [ ] **Step 7:** Commit: `fix(web): el admin de historias avisa cuando no pudo cargar`

---

## Task 20: Close the loop in the project docs

**Files:**
- Modify: `CLAUDE.md` (the "Gaps Conocidos" table and the rules list)

- [ ] **Step 1:** Add a row to the gaps table recording the class as closed for web, with the PR numbers and squash SHAs.
- [ ] **Step 2:** Add a rule describing the primitive, the branching order, and the two invariants that will otherwise be re-derived: `isLoading` and not `isPending`, and `error && items.length === 0` and not `error` alone.
- [ ] **Step 3:** State plainly in that rule that **mobile still has the class** and that nothing forces a new screen to use the primitive. Do not write that the class is closed for good.
- [ ] **Step 4:** Commit: `docs: la clase de la lista caida queda cerrada en web`

`CLAUDE.md` is gitignored by a standing decision (`.gitignore:191`) and stays that way — commit it only if `git check-ignore` says otherwise. Do not propose tracking it.

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: the API and state machine to Tasks 3-7, the stale banner to Task 6, the no-wrapper invariant to Task 7, the i18n keys to Task 1, the twelve screens to Tasks 8-19, the rollout table to the PR headings, and "what this does not solve" to Task 20 step 3.

**Deliberately not covered.** Mobile's 15 files — the spec puts them out of scope and unmeasured. `ProfilePage`'s `badges ?? []` — Task 16 step 5 says why.

**One thing the plan cannot promise.** Tasks 10-19 give exact files, exact lines and exact deletions, but they lean on the porting recipe for the wrapping itself rather than reprinting each screen's markup. That is a deliberate trade: reprinting ~60 lines of unchanged card JSX per screen would make the plan longer than the diff and would invite an implementer to retype markup that should move verbatim. Each of those tasks names the line range to move and says "verbatim". If an implementer finds a screen whose branch does not match the recipe's shape, that is a signal to stop and read, not to improvise.

Tasks 8 and 9 are the exception and are written out in full, because they are the pattern-setters: every later port is a repetition of those two shapes (a per-tab query pick, and a paginated envelope behind a `select`).

**Line numbers will drift.** They are taken from `origin/main` at `05bf99d`. Each task names the surrounding code as well, so a shifted range is recoverable — match on the code, not on the number.

**A note for whoever ports the remaining screens.** Rule #52 is the relevant scar: moving one piece of state without moving the rest created three defects in the wizard port, and the only HIGH among them came from a guard that was missing a precondition nobody thought of. The equivalent here is a screen that reads the same query **outside** the branch you are wrapping — `AlertsPage:120` and `PetDetailPage:485` are the two the plan already found. Before wrapping, grep the file for every other reference to the variable you are about to delete.
