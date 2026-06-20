# Design — "Search this area" (pan-triggered re-search)

**Date:** 2026-06-20
**Status:** Approved (design)
**Branch:** `feat/search-this-area` (stacked on `feat/vets-frontend` → vets PR chain #23/#24/#25)

## Problem

Both maps (web Leaflet `MapPage.tsx`, mobile MapLibreGL `map.tsx`) search around the
**user's location** only. The nearby-reports and nearby-vets queries are centered on a
fixed `userLocation` derived from geolocation. When the user pans the map to a different
area, the search never follows — the markers and the radius circle stay anchored to the
user's original position. There is no way to explore reports or vets in another area.

## Goal

Decouple the **search center** from the **user location**. Offer a floating
"Search this area" button (Google Maps / Airbnb pattern) that appears once the user has
panned far enough from the current search center. Tapping it re-runs both layers (reports
and vets) centered on the current map viewport center.

## Approach

Approach A (chosen): per-map local state + one shared pure helper. The map event wiring is
inherently platform-specific (Leaflet `moveend` vs MapLibreGL `onRegionDidChange`), so only
the threshold decision is shared as a pure, testable function. The data hooks
(`useNearbyReports`, `useNearbyVets`) already accept `lat`/`lng`, so **no hook signatures
change**.

Rejected — a shared `useSearchArea` hook: the stateful logic is ~10 lines and the map events
cannot be shared, so the abstraction buys little (YAGNI).

## Units

### 1. `shared/utils/searchArea.ts` (+ `searchArea.test.ts`)

Pure helper, the only unit under strict TDD.

```ts
export const SEARCH_HERE_THRESHOLD_RATIO = 0.3;

// Returns true when the map center has moved far enough from the current
// search center to justify offering a re-search.
export function shouldShowSearchHere(
  mapCenter: { lat: number; lng: number },
  searchCenter: { lat: number; lng: number },
  radiusMeters: number,
): boolean;
```

- Computes the haversine distance between `mapCenter` and `searchCenter`.
- Returns `true` when `distance > SEARCH_HERE_THRESHOLD_RATIO * radiusMeters`.
- Guards against `radiusMeters <= 0` (returns `false` — no meaningful threshold).
- Self-contained haversine; no existing distance helper in `shared/`.

### 2. Web — `MapPage.tsx`

- New state: `searchCenter: [lat, lng]` (init from `userLocation`), `mapCenter: [lat, lng]`.
- A small child component inside `<MapContainer>` using react-leaflet `useMapEvents({ moveend })`
  updates `mapCenter` (event hooks must live inside the map container).
- `useNearbyReports` / `useNearbyVets` and the `<Circle>` switch from `userLocation` to
  **`searchCenter`**.
- A floating "Search this area" button overlays the map when
  `shouldShowSearchHere(mapCenter, searchCenter, radius * 1000)` is true. Click →
  `setSearchCenter(mapCenter)`; the button hides and React Query refetches automatically
  (query key changes).
- `searchCenter` initializes to `userLocation`; the geolocation effect still sets the initial
  center.

### 3. Mobile — `map.tsx`

- New state: `searchCenter` (init from `locationStore` `lat`/`lng`).
- Map viewport center tracked via MapLibreGL `onRegionDidChange`.
- `useNearbyReports` / `useNearbyVets` and `createCircleGeoJSON` use `searchCenter`.
- `UserLocation` dot stays at the real user location (does not move with the search center).
- Same floating "Search this area" button with the same condition.
- `centerOnUser` stays camera-only (does not reset the search center) — kept minimal.

### 4. i18n

New key `map:searchHere` in web and mobile locales (es/en/pt):
- es: "Buscar en esta zona"
- en: "Search this area"
- pt: "Buscar nesta área"

## Data Flow

1. Load → `searchCenter = userLocation` → reports + vets markers and radius circle render at
   `searchCenter`.
2. User pans → `mapCenter` updates on `moveend` / `onRegionDidChange` → if it moved beyond the
   threshold, the button appears.
3. User taps the button → `searchCenter = mapCenter` → React Query refetches both layers →
   markers and circle move to the new center → button hides.

## UX Decisions

- The button threshold is tied to the **reports radius** (the visible circle, selector
  1/3/5/10 km), not the vets fixed 5 km radius, because the circle is the user's visual
  reference for the search area.
- Explicit button only; no auto-search on pan.

## Error Handling

No new network paths — reuses the existing hooks and their error handling. The threshold helper
is pure and cannot fail.

## Testing

- **TDD** `searchArea.test.ts` (Vitest, run via `web` `vitest.shared.config.ts`):
  - center unchanged → `false`
  - pan within threshold → `false`
  - pan beyond threshold → `true`
  - `radiusMeters <= 0` → `false` (guard)
- **Web** `MapPage.test.tsx`: button hidden initially; appears after simulating a `moveend`
  beyond the threshold; clicking refetches with the new center.
- **Mobile** `map.test.tsx`: button appears after a region change beyond the threshold.

## Non-Goals

- No auto-search (explicit button only).
- No persistence of `searchCenter` across navigation.
- No backend changes and no changes to hook signatures.
- "Center on user" (mobile) does not reset the search center.

## Delivery / PR Sizing

- `searchArea.ts` + tests — small.
- Web integration — medium.
- Mobile integration — medium.

Likely 1–2 PRs. If the diff is well over ~400 lines of code, split web / mobile as separate
stacked PRs (per the project PR-size rule). This branch stacks on the vets chain
(`feat/vets-frontend`) because it modifies the same map files; it rebases onto main once the
vets chain merges.
