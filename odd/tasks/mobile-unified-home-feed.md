# Mobile home feed unified with web

## Objective

The mobile home shows the same feed as the web home: the global
`/pets/search` feed (lost + stray, newest first), with the radius as an
optional distance filter on top.

## Problem

Today the mobile home has two modes (`app/(tabs)/index.tsx`): by default it
lists `GET /api/reports/nearby` (GPS + radius), and only switches to
`useSearchPets` when a type/color/image filter is applied. The web home
(`web/src/pages/HomePage.tsx`) always uses `useSearchPets`. Same product, two
different lists.

## Why redo instead of rebasing PR #74

`feat/mobile-home-unified-feed` (PR #74, closed) did this on 2026-07-09. Measured
on 2026-09-29 against `main` `3fd1bb2a`: 371 commits behind, all 7 files
conflict (20 hunks). Its second commit (PetCard badges via i18n) is already in
`main`. Since July, `main` changed ~220 lines of the home: failed-vs-empty list
handling (#203, `ListState`), thumbnails (#170), lint (#297). A 20-hunk manual
resolution is how one of those gets lost silently. #74 is the SPEC (commit
`2156155e`: message + tests), the web home is the MODEL.

## Scope

- `app/(tabs)/index.tsx`, its tests, the `home` i18n keys (es/en/pt).
- The map tab keeps `useNearbyReports` (the dedicated near-me view).
- Not in scope: PetCard (done in `main`), backend.

## Constraints

- Keep everything `main` added: `ListState` failed/empty/stale handling,
  thumbnails, zero lint warnings, typecheck.
- Radius chips: optional filter, center = user GPS with Montevideo fallback,
  tapping the active chip deselects it. Resolve the location BEFORE applying
  the radius (web learned this: the query must fire once, not twice).
- No orphan i18n keys (the `usedKeysExist` guard); keys removed from all 3
  locales.

## Tasks

- [x] T1 — Feed always `useSearchPets`; radius as optional filter; count from
  the search total; pull-to-refresh refetches the search; cards always the pet
  variant; i18n keys. Route: delegated (preparation + 2+ files).

## Acceptance

- With no filter, the home lists the search feed, not nearby reports.
- Picking a radius adds lat/lng/radius to the search; tapping it again removes it.
- A failed feed still shows the failure, never "nothing here".

## Checks

- RED first: an index test that expects `useSearchPets` with no filters fails
  on current `main`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:run` exit 0 (mobile).

## Progress

- 2026-09-29: measured #74, branch `feat/mobile-unified-home-feed` from
  `3fd1bb2a` (main CI green, run 36608580167).
- 2026-09-29: T1 implemented on top of current `main` (not a rebase of #74).
  `app/(tabs)/index.tsx` now calls `useSearchPets` unconditionally; `radius`
  is `5|10|25|50|undefined`, feeds `lat`/`lng`/`radiusMeters` only when set,
  tapping the active chip deselects it, `clearFilters` also resets it.
  `hasActiveFilters` replaces `isSearchMode` and includes `!!radius`.
  Cards always render the `pet` variant (no more `report` variant on this
  screen); `useNearbyReports` import removed from this file, `useNearbyReports`
  itself untouched (still used by `app/(tabs)/map.tsx`). Kept from `main`:
  `ListState` failed/empty/stale handling (#203) — the header's known-vs-null
  count logic now reads `searchQuery.data` only, reusing `home:resultsUnknown`
  for the no-filter feed's unknown-count case (no new key invented). Kept
  thumbnails (#170) and the inlined location effect (#297) untouched.
  i18n `home` namespace (es/en/pt): removed `radius`, `nearbyTitle`,
  `lostTitle`, `activeReports_one/_other`, `radiusOnly`, `noNearbyTitle`,
  `noNearbyText` (all orphaned — confirmed via grep, only referenced from this
  screen, its tests, and `i18n.plurals.test.ts`); added `distanceLabel`,
  `feedTitle`, `feedCount_one/_other`, `emptyFeedTitle`, `emptyFeedText`.
  `i18n.plurals.test.ts` updated to test `feedCount` instead of
  `activeReports`/`radiusOnly`. Pre-implementation checks: (1) after this
  change `useNearbyReports` is used only by `map.tsx` (plus its own hook
  definition/test) — confirmed via grep, no orphan hook. (2) Web resolves
  location-denied by falling back to Montevideo (`DEFAULT_LAT`/`DEFAULT_LNG`)
  at search time; mobile already resolves GPS-or-Montevideo-fallback once on
  mount (existing `useEffect` + `MAP_DEFAULTS`), so no new geolocation-timing
  logic was needed to mirror web's "resolve once, fire once" — mobile's
  existing architecture (eager permission request at mount, not per-search)
  covers the common case. CORRECTED by the parent: it does NOT fully avoid the
  double fetch. If the user picks a radius before the GPS answers, the query
  fires centered on Montevideo and again on the real location. Accepted: one
  extra request in a narrow window, and the second one is correct.
  RED: the writer's first RED was a crash (`useNearbyReports is not a
  function`, the new mock lacked the hook), which proves nothing. Re-run by
  the parent with the old `index.tsx` and `useNearbyReports` added to the
  mock: 9/11 fail on assertions (`Expected: 5000 / Received: undefined`,
  pets not found, failure states missing). The 2 that pass on the old code:
  the smoke render, and "no filters → no radius params" (the old code also
  called useSearchPets without a radius; that test is the negative half of
  the radius test, not proof the feed comes from search — "con datos, se ven
  las mascotas" is).
  GREEN: `pnpm lint` EXIT=0, `pnpm typecheck` EXIT=0, `pnpm test:run` EXIT=0,
  283 tests (baseline 279 + 4 net new). Not committed — left in the working
  tree per the task's instructions.
- 2026-09-29: commit `a232de75`, native review (reliability lens) APPROVED
  and acknowledged. Suggestions applied: `mockPetCardRender` cleared in
  beforeEach (the pet-variant test passed on a previous test's calls);
  pull-to-refresh test (the retry test only covers ListState's button:
  mutating `handleRefetch` left all green, the new test catches it);
  `total` falls back to the visible list length again, with a test (RED
  seen removing the fallback). 286 tests.
