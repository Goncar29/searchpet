# Mobile bug sweep

## Objective

Find and fix the user-visible defects in the mobile app before building an APK
to verify everything together on a phone.

## Problem

The owner says mobile has many bugs nobody has seen. Unit tests mock almost
everything, so bugs hide in the seams (the maps never showed streets and no
test saw it). This sweep finds candidates with evidence first, then fixes the
ones the owner picks.

## Scope

`frontend/packages/mobile` (and `shared/` where a mobile bug lives there).
Backend changes only if a defect needs them, with the owner's OK.

## Tasks

- [x] T1 — The two leftovers from the #297 review: the `.eslintrc.js`
  comment ("every rule" → "every rule except the two classic ones"), and the
  router mock's calls cleared between tests. Route: inline (2 small files).
- [x] T2 — Read-only audit of the app: ranked findings with evidence.
  Route: delegated (4+ files).
- [x] T3 — Note in `jest.setup.js`: router mock implementations go in
  beforeEach or the test (review suggestion on `9046a262`). Route: inline.
- [ ] T4 — Batch 1: M1-M4 (failed list ≠ empty list in messages, chat,
  alerts, map counter), M5 (pet type via `pets:types.*` in PetCard, my-pets,
  home image results, alerts), M7 (`getErrorMessage` in story/create).
  Route: delegated writer (6+ non-trivial files).
- [ ] T5 — M6: public profile lists the person's published pets
  (`useUserPets`), separate PR.
- [ ] T6 — M8: StaleDataNotice on foster-homes and shelters.

## Checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test:run` exit 0 (mobile).
- Every fix: RED first where a runnable test fits.

## Progress

- 2026-09-29: branch `fix/mobile-sweep` from `6c0875a6`.
- 2026-09-29: T1 done. A global `clearMocks` was tried first and broke 8
  `onlineStatus` tests: that module subscribes to NetInfo AT IMPORT and its
  tests read that call later, so clearing before each test erases it. Scoped
  instead: `jest.setup.js` exposes `__hookRouter` and clears only its mocks in
  a `beforeEach`. Guard `__tests__/routerMockIsolation.test.ts` (RED seen
  removing the clear: Expected 0 / Received 1). 288 tests.
- 2026-09-29: native review of T1 approved; its 3 suggestions applied:
  mockReset instead of mockClear (implementations leaked too: RED seen,
  Received "leaked"), non-mock fields skipped, and the guard no longer
  depends on test order (second test passes alone with -t).
- 2026-09-29: T2 audit returned (full list in engram topic
  `odd/mobile-sweep/audit`). Parent verified against the code: M1-M4 have no
  isError/ListState at all (grep count 0 in messages, chat, alerts, map); map
  counter is `reports?.length || 0`; PetCard.tsx:132 renders `pet.type` raw;
  mobile users/[id].tsx never calls useUserPets (web does, line 196);
  story/create.tsx:111 shows `error.message` raw. All confirmed.

## Next step

Next session: batch 1 = M1-M4 (ListState on messages, chat, alerts, map),
M5 (pet type via `pets:types.*`) and M7 (`getErrorMessage` in story/create),
each with RED first. Then M6 (public profile pets, separate PR), M8. Also
pending from the review of `9046a262`: a note in `jest.setup.js` that router
mock implementations must be set in beforeEach or in the test.
