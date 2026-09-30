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
- [x] T4 — Batch 1: M1-M4 (failed list ≠ empty list in messages, chat,
  alerts, map counter), M5 (pet type via `pets:types.*` in PetCard, my-pets,
  home image results, alerts), M7 (`getErrorMessage` in story/create).
  Route: delegated writer (6+ non-trivial files).
- [x] T4b — Review suggestions of batch 1 and the owner's chat rule: a
  message sent while the thread failed to load must end up in the real
  chronological order once it loads. Route: delegated writer.
- [x] T5 — M6: public profile lists the person's published pets
  (`useUserPets`), separate PR. Route: delegated writer (screen + tests +
  3 locales).
- [x] T6 — M8: StaleDataNotice on foster-homes and shelters. Route: inline
  (2 screens, same mechanical change, already understood).

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

- 2026-09-30: T3 done (`24f23f47`). T4 done by a delegated writer:
  `258e2249` (M1-M4), `a5ce0563` (M5, plus a 5th raw type site in the home
  classify chip), `7be58209` (M7). RED seen per finding. Map: the map stays
  visible; the counter shows the error/offline card when there is no data and
  a StaleDataNotice with cached data. Chat: composer stays enabled on a load
  error (writer's call, flagged to the owner). Writer: lint/typecheck/test
  EXIT=0; parent re-ran `pnpm test:run`: EXIT=0, 306/306.

- 2026-09-30: native review of batch 1 approved (lineage
  review-3c63cdc88a1e1e57), 3 suggestions applied: `a32edf39`/`9cbdfc05`
  (unmapped pet type falls back to the raw value), `ff0bf53a` (map offline
  stale banner test), `309d29bc` (`getErrorMessage` gains an optional
  fallback key; story/create falls back to `story:submitError` again).
  Second review approved (review-0438037c9e31cfe7) with 1 latent warning and
  2 suggestions, applied in `e6247f4f`.
- 2026-09-30: owner's chat rule. The backend orders the thread ASC and the
  send invalidates it, so a successful reload already restores real order;
  now proven by a shared test. Bug found and fixed in `26269261`: a failed
  send with NO cached thread left the optimistic message on screen as sent;
  it now resets the query (back to loading, then thread or error card),
  never `[]`. Parent re-ran shared vitest: EXIT=0, 337/337.

- 2026-09-30: third review approved (review-4b0ced29919b816f) with 2
  suggestions; owner chose "apply and cut" (no further review of this
  slice). `d9af96ed`: map counter shows `common:loading`, never "0", while
  there is no data yet. `72f49670`: a failed send with no cache refetched the
  thread twice (the `['messages']` prefix invalidation also matched it).
  Parent fixed that fix: the mark was a `useRef` shared by every send of the
  hook, so two sends in flight could clobber it; moved to the mutation
  context. Mutation check: dropping the mark turns
  `...exactly one getConversation call` red (called 2 times). Parent ran
  shared 338/338, web build+lint, mobile typecheck and 313/313: all EXIT=0.

- 2026-09-30: PR #299 opened. A fourth review (review-803b02820e0d7456,
  approved) found a real, pre-existing chat bug: the rollback restored a
  whole-thread snapshot, so with two overlapping failed sends a never-sent
  message came back as sent (and a sibling's pending one could vanish).
  `4701ccf3` rolls back by optimistic id (ids now unique per send); three
  overlapping-send tests seen red first. `465363cb` removes a 50 ms wait and
  a substring match from two tests. Parent re-ran shared: EXIT=0, 341/341.

- 2026-09-30: PR #300 (undici floor 7.29.1 + grpc-js ignore with reason)
  unblocked `pnpm audit`; #299 rebased (same 23 commits, tree diff = only the
  #300 files), fifth native review approved with no findings, merged as
  `6992f7b8`.
- 2026-09-30: T5 done on `fix/mobile-public-profile-pets` (`533d19e1`).
  `app/users/[id].tsx` calls `useUserPets`: "Publicaciones" in `ListState`
  (split with shared `splitOwnedPets`, same as web), "En adopción" without
  its own `ListState` (one failure, one card), capped notice below both with
  `total > shown`. Keys in mobile `users` ns (es/en/pt): `profile:public.*`
  exists only in web locales. RED: 5 named tests failed before the
  implementation; mutating `>` to `!==` turned "no avisa recorte con total =
  0 y lista NO vacía" red. Writer: lint/typecheck/test EXIT=0; parent re-ran
  `pnpm test:run`: EXIT=0, 321/321. Known, inherited from web: a person with
  only adoption pets sees "No tiene publicaciones activas" above the
  adoption section.

- 2026-09-30: T5 native reviews approved (review-7128c4d5cc7343b9,
  review-190a1db5f8023865). Applied: `183dffbd` tests loading and
  failed-refetch-with-cache. Owner decision: keep the adoption-only copy as
  in web (verified on web with a temporary test: `postsEmpty` does render in
  `/users/:id` for an adoption-only person; the owner's own `/profile` is a
  different page without that copy). Pinned as deliberate, plus capped notice
  on a failed refetch; each new test seen red under its own mutation. Parent:
  lint/typecheck/test EXIT=0, 325/325. Review cycle cut here.

- 2026-09-30: #301 merged (`0d5e47a6`). T6 on `fix/mobile-stale-notice-lists`:
  both directories render `StaleDataNotice` in the list header, and the
  error card only shows with no data (a cached empty list is an answer: empty
  text plus the notice). RED: the 4 notice/empty cases failed (after fixing two
  harness mistakes of mine: two `jest.mock` factories on the same module, and
  shelters' bare `t` keys). Each piece reverted alone turns its own tests red.
  Parent: lint/typecheck/test EXIT=0, 333/333.

## Next step

Merge the T6 PR. The sweep's audited findings are done; next the owner asked
for G4b, S16, then replacing emoji with icons in mobile (and the web navbar
dark-mode toggle) before the APK.
