# Map web structure and filters (slice 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `MapPage.tsx` into focused components, move the map to a full-bleed layout with a left filter panel and a "reports in this area" list, and wire the four backend filters merged in PR #146 end to end.

**Architecture:** `useNearbyReports` gains an optional `filters` argument that flows into both the query key and the request. `MapPage` keeps orchestration only; the panel, the list and the two popups become their own files, and a `useMapFilters` hook owns the draft/applied split that slice 3 reuses unchanged.

**Tech Stack:** React 19, Vite, Tailwind v4, react-leaflet, React Query v5, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-10-map-redesign-design.md`

**Out of scope, each its own PR:** the Rastro marker with the pet photo (2b), geocoding + CSP (2c), the mobile bottom sheet (slice 3).

**Deliberate deviation from the plan format.** Tasks 4 and 5 pin the *behaviour* with full test code and specify the component's contract, but do not dictate its JSX line by line. That is on purpose: those two are visual components whose spacing, ordering and empty states are better settled against the running app than transcribed here, and the tests already fix everything that can silently break. Every other task carries complete code.

---

## Context an engineer needs before starting

Run the web suite from `frontend/packages/web`:

```bash
pnpm test:run > /tmp/web.log 2>&1; echo "EXIT=$?"
```

`test:run` chains the web tests **and** the shared ones through `vitest.shared.config.ts` (rule #14). Read the exit code, never grep the output.

**The trap this slice exists around.** `useNearbyReports` currently builds its key as:

```ts
queryKey: ['reports', 'nearby', lat, lng, radius]
```

If the filters are added to the request but **not** to the key, React Query serves the cached unfiltered response: the user applies "cats only" and keeps seeing dogs, with no error and no request in the network tab. The request is fine — it never fires. Task 1 exists to make that impossible and to prove it with a test that fails without the key change.

**Backend contract (already in `main`, PR #146):** `GET /api/reports/nearby` accepts `type` (`perro|gato|pajaro|otro`), `status` (comma-separated `lost,found,sighting`), `from` and `to` (RFC3339 instants). Unknown values return **400**. Absent means unfiltered.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/types/index.ts` | `NearbyReportFilters` added to `NearbySearchParams`. |
| `shared/api/client.ts` | Serialises the four params. |
| `shared/hooks/index.ts` | `useNearbyReports` takes filters; they enter the query key. |
| `web/src/hooks/useMapFilters.ts` | Draft/applied state. New. |
| `web/src/components/map/MapFilterPanel.tsx` | Type, status chips, dates, radius, vets toggle, Apply. New. |
| `web/src/components/map/NearbyReportList.tsx` | "Reports in this area". New. |
| `web/src/components/map/ReportPopup.tsx` | Extracted from `MapPage`. New. |
| `web/src/components/map/VetPopup.tsx` | Extracted from `MapPage`. New. |
| `web/src/pages/MapPage.tsx` | Orchestration and layout only. |

---

## Task 1: Filters reach the request AND the query key

**Files:**
- Modify: `frontend/packages/shared/types/index.ts:534`
- Modify: `frontend/packages/shared/api/client.ts:594`
- Modify: `frontend/packages/shared/hooks/index.ts:340`
- Test: `frontend/packages/shared/hooks/index.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/packages/shared/hooks/index.test.ts`, following the existing `renderHook` + `QueryClientProvider` wrapper in that file:

```ts
// El queryKey TIENE que llevar los filtros. Sin esto React Query sirve la
// respuesta cacheada sin filtrar: el usuario aplica "sólo gatos" y sigue viendo
// perros, sin error y sin request — porque la query ni se dispara.
it('useNearbyReports mete los filtros en el queryKey', async () => {
  const spy = vi.spyOn(apiClient, 'getNearbyReports').mockResolvedValue({
    data: [], radius_used: 5000,
  } as never);

  const { rerender } = renderHook(
    ({ filtros }) => useNearbyReports(-34.9, -56.1, 5, true, filtros),
    { wrapper, initialProps: { filtros: { type: 'perro' } } },
  );
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

  rerender({ filtros: { type: 'gato' } });
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

  expect(spy.mock.calls[1][0]).toMatchObject({ type: 'gato' });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web
pnpm vitest run --config vitest.shared.config.ts ../shared/hooks/index.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero. The hook does not accept a fifth argument yet, so the second render reuses the first key and `getNearbyReports` is called once.

- [ ] **Step 3: Add the type**

In `shared/types/index.ts`, replace the `NearbySearchParams` interface:

```ts
/** Filtros opcionales de /api/reports/nearby. Ausentes = sin filtrar. */
export interface NearbyReportFilters {
  /** pets.type — perro | gato | pajaro | otro. */
  type?: PetType;
  /** reports.status — lost | found | sighting. Varios valores permitidos. */
  status?: ReportStatus[];
  /** Instante RFC3339. Lo resuelve el CLIENTE desde los días de calendario. */
  from?: string;
  to?: string;
}

export interface NearbySearchParams extends NearbyReportFilters {
  lat: number;
  lng: number;
  radius?: number;
  limit?: number;
}
```

- [ ] **Step 4: Serialise in the client**

In `shared/api/client.ts`, inside `getNearbyReports`, before the `return`:

```ts
    if (params.type) {
      queryParams['type'] = params.type;
    }
    if (params.status && params.status.length > 0) {
      // El backend espera una lista separada por comas y deduplica del otro
      // lado, pero mandar duplicados es ruido innecesario en la URL.
      queryParams['status'] = Array.from(new Set(params.status)).join(',');
    }
    if (params.from) {
      queryParams['from'] = params.from;
    }
    if (params.to) {
      queryParams['to'] = params.to;
    }
```

- [ ] **Step 5: Thread through the hook**

In `shared/hooks/index.ts`, replace `useNearbyReports`:

```ts
export const useNearbyReports = (
  lat: number,
  lng: number,
  radius = 5,
  enabled = true,
  filters: NearbyReportFilters = {},
) => {
  // Los filtros van EN LA CLAVE, no sólo en el request. Con la clave vieja,
  // cambiar un filtro devuelve la respuesta cacheada anterior sin disparar
  // nada: la pantalla miente y no hay error en ningún lado.
  const query = useQuery<NearbyReportsResponse>({
    queryKey: ['reports', 'nearby', lat, lng, radius, filters],
    queryFn: () => apiClient.getNearbyReports({ lat, lng, radius: radius * 1000, ...filters }),
    enabled: enabled && !!lat && !!lng,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
  return {
    ...query,
    data: query.data?.data,
    radiusUsed: query.data?.radius_used,
  };
};
```

Add `NearbyReportFilters` to the type import at the top of the file.

- [ ] **Step 6: Run it and watch it pass**

Same command as Step 2. Expected: `EXIT=0`.

- [ ] **Step 7: Prove the key change is what makes it pass**

Temporarily revert the `queryKey` line to `['reports', 'nearby', lat, lng, radius]` and re-run.

Expected: FAILS with the spy called once instead of twice. Restore the line and confirm green again. **Do not skip this** — without it the test passes for the wrong reason and the cache bug walks back in unnoticed.

- [ ] **Step 8: Confirm the existing callers still compile**

```bash
cd frontend/packages/web && npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "EXIT=$?"
```

The fifth argument is optional, so `mobile/app/(tabs)/map.tsx`, `mobile/app/(tabs)/index.tsx` and `web/src/pages/MapPage.tsx` are untouched. Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/packages/shared
git commit -m "feat(shared): useNearbyReports acepta filtros y los mete en el queryKey"
```

---

## Task 2: `useMapFilters` — draft vs applied

**Files:**
- Create: `frontend/packages/web/src/hooks/useMapFilters.ts`
- Test: `frontend/packages/web/src/hooks/useMapFilters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useMapFilters } from './useMapFilters';

describe('useMapFilters', () => {
  it('el borrador NO cambia lo aplicado hasta Aplicar', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.setDraft({ type: 'gato' }));
    expect(result.current.draft.type).toBe('gato');
    expect(result.current.applied.type).toBeUndefined();

    act(() => result.current.apply());
    expect(result.current.applied.type).toBe('gato');
  });

  it('los días de calendario se convierten a instantes, con el día de "hasta" ENTERO', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.setDraft({ fromDay: '2026-08-01', toDay: '2026-08-10' }));
    act(() => result.current.apply());

    // El usuario que elige "hasta el 10" espera que el 10 entre completo. Con
    // medianoche, todo lo reportado ese día queda afuera y el filtro parece roto.
    expect(result.current.applied.from).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).toISOString());
    expect(result.current.applied.to).toBe(new Date(2026, 7, 10, 23, 59, 59, 999).toISOString());
  });

  it('un estado se agrega y se saca del conjunto', () => {
    const { result } = renderHook(() => useMapFilters());

    act(() => result.current.toggleStatus('lost'));
    act(() => result.current.toggleStatus('sighting'));
    expect(result.current.draft.status).toEqual(['lost', 'sighting']);

    act(() => result.current.toggleStatus('lost'));
    expect(result.current.draft.status).toEqual(['sighting']);
  });

  it('reset vacía las dos mitades', () => {
    const { result } = renderHook(() => useMapFilters());
    act(() => result.current.setDraft({ type: 'perro' }));
    act(() => result.current.apply());
    act(() => result.current.reset());
    expect(result.current.draft).toEqual({});
    expect(result.current.applied).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web
pnpm vitest run src/hooks/useMapFilters.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero, module not found.

- [ ] **Step 3: Write the hook**

```ts
import { useState, useCallback } from 'react';
import type { NearbyReportFilters, PetType, ReportStatus } from '@shared/types';

/** Lo que el usuario está editando: días de calendario, no instantes. */
export interface MapFilterDraft {
  type?: PetType;
  status?: ReportStatus[];
  /** YYYY-MM-DD tal como lo devuelve <input type="date">. */
  fromDay?: string;
  toDay?: string;
}

/**
 * Separa lo que el usuario EDITA de lo que la búsqueda USA.
 *
 * Existe por el patrón borrador/aplicado que este repo ya adoptó después de
 * encontrar filtros que disparaban un request por tecla. El botón "Aplicar" del
 * diseño es la misma decisión.
 *
 * La conversión de día a instante vive acá y no en el servidor: el servidor no
 * puede saber en qué zona horaria está el usuario, y "un día" es exactamente lo
 * que el usuario quiso decir donde el usuario está.
 */
export function useMapFilters() {
  const [draft, setDraftState] = useState<MapFilterDraft>({});
  const [applied, setApplied] = useState<NearbyReportFilters>({});

  const setDraft = useCallback((patch: Partial<MapFilterDraft>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleStatus = useCallback((s: ReportStatus) => {
    setDraftState((prev) => {
      const actual = prev.status ?? [];
      const siguiente = actual.includes(s)
        ? actual.filter((x) => x !== s)
        : [...actual, s];
      return { ...prev, status: siguiente.length > 0 ? siguiente : undefined };
    });
  }, []);

  // Lee `draft` del closure y NO desde dentro de un updater de estado. Meter
  // setApplied adentro de setDraftState pondría un efecto dentro de una función
  // que React puede invocar dos veces en StrictMode — y en desarrollo StrictMode
  // está activo, así que sería un bug que sólo aparece a veces.
  const apply = useCallback(() => {
    const next: NearbyReportFilters = {};
    if (draft.type) next.type = draft.type;
    if (draft.status && draft.status.length > 0) next.status = draft.status;

    if (draft.fromDay) {
      const [y, m, d] = draft.fromDay.split('-').map(Number);
      next.from = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
    }
    if (draft.toDay) {
      const [y, m, d] = draft.toDay.split('-').map(Number);
      // Fin del día, no medianoche: quien elige "hasta el 10" espera que el
      // 10 entre entero. Con las 00:00 se pierde el día completo.
      next.to = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
    }

    setApplied(next);
  }, [draft]);

  const reset = useCallback(() => {
    setDraftState({});
    setApplied({});
  }, []);

  return { draft, applied, setDraft, toggleStatus, apply, reset };
}
```

- [ ] **Step 4: Run it and watch it pass**

Same command as Step 2. Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/hooks
git commit -m "feat(web): hook de filtros del mapa con patron borrador/aplicado"
```

---

## Task 3: Extract the two popups

**Files:**
- Create: `frontend/packages/web/src/components/map/ReportPopup.tsx`
- Create: `frontend/packages/web/src/components/map/VetPopup.tsx`
- Modify: `frontend/packages/web/src/pages/MapPage.tsx`

- [ ] **Step 1: Move the JSX verbatim**

Create `ReportPopup.tsx` with the exact JSX currently inside `<Popup>` for reports in `MapPage.tsx` (the `<div className="w-52">` block), taking `report` as its only prop and keeping every class name and every `t()` call byte-identical. Move the `primaryPhotoUrl`, `petSubtitle`, `getStatusLabel` helpers with it — they have no other caller.

Do the same for `VetPopup.tsx` with the vet `<Popup>` block and the `directionsUrl` helper.

This step changes **no behaviour**. If a class name or a key changes here, the layout task later will look like it caused it.

- [ ] **Step 2: Wire them into MapPage**

Replace both inline blocks with `<ReportPopup report={report} />` and `<VetPopup vet={vet} />`, and delete the now-unused helpers from `MapPage`.

- [ ] **Step 3: Run the existing MapPage tests**

```bash
cd frontend/packages/web
pnpm vitest run src/pages/MapPage.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0` with no test changes. The existing suite is the safety net for a pure move — if it needs edits, the move was not pure.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/web/src
git commit -m "refactor(web): extraer los popups del mapa a sus propios componentes"
```

---

## Task 4: The filter panel

**Files:**
- Create: `frontend/packages/web/src/components/map/MapFilterPanel.tsx`
- Test: `frontend/packages/web/src/components/map/MapFilterPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MapFilterPanel } from './MapFilterPanel';

const base = {
  draft: {},
  onDraftChange: vi.fn(),
  onToggleStatus: vi.fn(),
  onApply: vi.fn(),
  onReset: vi.fn(),
  radius: 3,
  onRadiusChange: vi.fn(),
  showVets: false,
  onToggleVets: vi.fn(),
  resultCount: 0,
};

describe('MapFilterPanel', () => {
  it('el radio NO pasa por Aplicar: avisa al toque', () => {
    const onRadiusChange = vi.fn();
    render(<MapFilterPanel {...base} onRadiusChange={onRadiusChange} />);

    fireEvent.change(screen.getByLabelText(/radio/i), { target: { value: '10' } });

    // El radio dibuja el círculo en pantalla. Diferirlo mostraría un círculo
    // que no coincide con los resultados.
    expect(onRadiusChange).toHaveBeenCalledWith(10);
  });

  it('el toggle de veterinarias tampoco pasa por Aplicar', () => {
    const onToggleVets = vi.fn();
    render(<MapFilterPanel {...base} onToggleVets={onToggleVets} />);

    fireEvent.click(screen.getByRole('button', { name: /veterinaria/i }));

    // Prende una CAPA del mapa, no filtra reportes.
    expect(onToggleVets).toHaveBeenCalled();
  });

  it('el tipo sí espera a Aplicar', () => {
    const onDraftChange = vi.fn();
    const onApply = vi.fn();
    render(<MapFilterPanel {...base} onDraftChange={onDraftChange} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText(/tipo/i), { target: { value: 'gato' } });
    expect(onDraftChange).toHaveBeenCalledWith({ type: 'gato' });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web
pnpm vitest run src/components/map/MapFilterPanel.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero, module not found.

- [ ] **Step 3: Write the panel**

Build it as a presentational component — it holds no state, it receives `draft` and calls back. Requirements the tests above pin down, plus:

- Type: a `<select>` with the four `PetType` values, labelled from `t('pets:types.<type>')`, plus an empty "todos" option.
- Status: three chips reading their colour from `--color-lost` / `--color-found` / `--color-sighting`, labelled `t('pets:card.<status>')`, `aria-pressed` reflecting selection.
- Dates: two `<input type="date">` bound to `fromDay` / `toDay`.
- Radius: the existing `<select>` with 1/3/5/10 km, moved here unchanged.
- Vets: the existing toggle button, moved here unchanged.
- Apply and a "limpiar" button wired to `onReset`.
- The result count from `resultCount`.

Every user-facing string goes through `t()`; new keys go in the web-only `map` namespace, which is already registered in `web/src/i18n/index.ts` (rule #21). Add them to es, en and pt.

- [ ] **Step 4: Run it and watch it pass**

Same command as Step 2. Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src
git commit -m "feat(web): panel de filtros del mapa"
```

---

## Task 5: The report list

**Files:**
- Create: `frontend/packages/web/src/components/map/NearbyReportList.tsx`
- Test: `frontend/packages/web/src/components/map/NearbyReportList.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import { NearbyReportList } from './NearbyReportList';
import type { Report } from '@shared/types';

const report = {
  id: 'r1',
  pet_id: 'p1',
  status: 'lost',
  latitude: -34.9,
  longitude: -56.1,
  created_at: new Date().toISOString(),
  pet: { id: 'p1', name: 'Firulais', type: 'perro', status: 'lost', photos: [] },
} as unknown as Report;

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('NearbyReportList', () => {
  it('lista los reportes con su nombre y link al detalle', () => {
    wrap(<NearbyReportList reports={[report]} isLoading={false} />);
    expect(screen.getByText('Firulais')).toBeTruthy();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pets/p1');
  });

  it('el vacío se distingue de la carga', () => {
    const { rerender } = wrap(<NearbyReportList reports={[]} isLoading />);
    expect(screen.queryByText(/no hay reportes/i)).toBeNull();

    rerender(<MemoryRouter><NearbyReportList reports={[]} isLoading={false} /></MemoryRouter>);
    expect(screen.getByText(/no hay reportes/i)).toBeTruthy();
  });
});
```

The second test matters: showing "no results" while the request is still in flight tells the user their filter found nothing when it has not been answered yet.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd frontend/packages/web
pnpm vitest run src/components/map/NearbyReportList.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero, module not found.

- [ ] **Step 3: Write the list**

A card per report: photo thumbnail (or the paw placeholder), pet name, the `petSubtitle` line, the status badge reading the same tokens as the chips, the relative time via `formatTimeAgo` from `@shared/utils/mapFormat`, and a `<Link to={/pets/${report.pet?.id ?? report.pet_id}}>`. Loading renders skeletons, not the empty message.

- [ ] **Step 4: Run it and watch it pass**

Same command as Step 2. Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src
git commit -m "feat(web): lista de reportes de la zona"
```

---

## Task 6: Full-bleed layout and wiring

**Files:**
- Modify: `frontend/packages/web/src/pages/MapPage.tsx`
- Modify: `frontend/packages/web/src/pages/MapPage.test.tsx`

- [ ] **Step 1: Rewrite the page shell**

Replace the `max-w-7xl mx-auto px-4 …` wrapper with a full-bleed two-column shell:

```tsx
    <div className="flex h-[calc(100vh-4rem)] w-full">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700">
        <MapFilterPanel … />
        <NearbyReportList reports={reports} isLoading={isLoading} />
      </aside>
      <div className="relative flex-1">
        <MapContainer …>…</MapContainer>
      </div>
    </div>
```

**Leave this comment above the shell** — without it, the next person applying rule #50 will "fix" it back:

```tsx
    {/* Esta página rompe max-w-7xl A PROPÓSITO (regla #50). Esa regla capea
        páginas de CONTENIDO al ancho del navbar. El mapa es un LIENZO: capearlo
        desperdicia viewport en la única pantalla cuyo valor es cuánto terreno
        muestra. Ver el spec del rediseño. */}
```

`h-[calc(100vh-4rem)]` assumes the navbar is 4rem — read the real height from `MainLayout.tsx` and use that value.

- [ ] **Step 2: Wire the filters**

```tsx
  const { draft, applied, setDraft, toggleStatus, apply, reset } = useMapFilters();
  const { data: reports, isLoading } = useNearbyReports(
    searchCenter[0], searchCenter[1], radius, true, applied,
  );
```

`applied` — never `draft`. Passing `draft` would fire a request per keystroke, which is the defect the pattern exists to prevent.

- [ ] **Step 3: Run the suite**

```bash
cd frontend/packages/web
pnpm test:run > /tmp/t6.log 2>&1; echo "EXIT=$?"
```

The existing `MapPage.test.tsx` will need updating for the new structure — that is expected here and only here. Keep every existing assertion that still describes real behaviour; do not delete a test because it broke.

- [ ] **Step 4: Add the wiring test**

In `MapPage.test.tsx`:

```tsx
it('aplicar un filtro dispara una búsqueda nueva', async () => {
  // El mock de useNearbyReports captura el 5º argumento.
  render(<MapPage />, { wrapper });

  fireEvent.change(screen.getByLabelText(/tipo/i), { target: { value: 'gato' } });
  expect(useNearbyReportsMock).not.toHaveBeenLastCalledWith(
    expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    expect.objectContaining({ type: 'gato' }),
  );

  fireEvent.click(screen.getByRole('button', { name: /aplicar/i }));
  await waitFor(() => expect(useNearbyReportsMock).toHaveBeenLastCalledWith(
    expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    expect.objectContaining({ type: 'gato' }),
  ));
});
```

- [ ] **Step 5: Verify everything**

```bash
cd frontend/packages/web
pnpm test:run > /tmp/final.log 2>&1; echo "WEB_EXIT=$?"
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC_EXIT=$?"
cd ../mobile && pnpm test:run > /tmp/mob.log 2>&1; echo "MOBILE_EXIT=$?"
```

Mobile is included because Task 1 touched `shared/`. All three must be `EXIT=0`.

- [ ] **Step 6: Commit and open the PR**

```bash
git add frontend/packages/web
git commit -m "feat(web): mapa a sangre con panel de filtros y lista de la zona"
```

Then follow the `searchpet-pr` skill. Flag in the PR body that this is 2a of three and that the marker and geocoding follow.
