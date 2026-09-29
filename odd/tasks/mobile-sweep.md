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
- [ ] T2 — Read-only audit of the app: ranked findings with evidence.
  Route: delegated (4+ files).
- [ ] T3+ — Fixes, one task per finding or group the owner picks.

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
