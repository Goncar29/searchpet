# APK 1.0.7-rc1 findings

## Objective

Fix what the owner found testing APK 1.0.7-rc1 (run 36893054714, `bb140d87`)
on a real phone, then build another APK.

## Problem

- Own profile shows found=12 / reports=41 for an account with no real reports.
- Native Stack header shows raw route names (`foster-homes/index`) and several
  screens draw a second in-screen title with a back arrow.
- Adopt: duplicated title, filter chips overflow sideways.
- Map: controls float mid-screen; "Veterinarias" label reported untranslated.
- No dark mode in mobile; the profile "Settings" row is a placeholder.

## Findings (mapper, 2026-10-01)

- Stats are STORED counters in `user_points` (`total_reports`, `found_count`),
  incremented by `report.created` / `pet.found` handlers and never decremented
  or reconciled. `report.created` also fires when a lost pet is published and
  when a stray is created; `pet.found` fires on every transition into `found`
  and credits the pet OWNER. Testing against prod inflates them. Web shows the
  same numbers (same endpoint).
- Unregistered routes in `app/_layout.tsx`: `foster-homes/index`,
  `foster-homes/mine`, `foster-homes/register`, `foster-home/[id]`,
  `edit-profile`, `story/index`, `story/[id]`, `google-location`. Duplicate
  in-screen headers: `blocked-users`, `foster-homes/index`, `edit-profile`,
  `adopt` (title+subtitle).
- Map controls use absolute `bottom: 120..290` offsets; `vetsToggle` key exists
  in `map` ns — needs a real-i18n check on why the device shows it wrong.
- Dark mode: no theme infra at all; static `COLORS` in every StyleSheet. Size L.

## Tasks

- [x] T1 — Headers: register every route with an i18n title, remove duplicate
  in-screen headers/arrows (keep Adopt's subtitle). Route: delegated writer.
  Commit 7a9d9ff3.
- [x] T2 — Adopt: chips wrap instead of horizontal scroll. Route: same writer.
  Commit aabcf29a.
- [x] T3 — Map: controls in one bottom-anchored container; `map:vetsToggle`
  verified against the real i18n instance. Route: same writer (delegated).
  Commit e87609f7.
- [~] T4 — Profile stats from REAL ROWS (owner chose option b on 2026-10-01;
  option a, a one-off UPDATE in prod, was rejected because testing re-inflates
  the counters). Own PR #313 (backend). Route: delegated. Decisions:
  - `total_reports` = `CountByReporter`, closure reports excluded (unchanged).
  - `found_count` ("Encontradas"/"Reunidos") = PETS I HELPED FIND: distinct pets
    that are not mine (`owner_id` and `reporter_id` both `IS DISTINCT FROM` me;
    strays have NULL owner), currently `found`, with at least one report by me
    (`CountHelpedFound`, SQL EXISTS). Own pets and own strays never count.
    Informational: no points, no badges derive from it.
  - The owner marking their own pet found earns NOTHING: `onPetFound` and its
    `pet.found` subscription were removed from `gamification_service.go`
    (before: +100 points, `found_count`, `pet_rescuer`, `super_finder`).
    Deliberate behavior change; other `pet.found` listeners untouched.
- [ ] T5 — Dark mode in mobile via Settings. Separate feature (size L).
- [ ] T6 — New APK and owner re-check.
- [ ] T7 — Stack header titles are computed once with `i18next.t` in
  `app/_layout.tsx`, so they keep the old language after a runtime language
  change. Pre-existing for every title (native review of #311). Not started.
- [ ] T8 — Helper confirmation feature (step 2): when a pet goes found the
  owner must choose the helpers among the reporters of the current episode.
  Enforced in ONE backend function used by the three doors that fire
  `pet.found` (`UpdatePet` ~481, `MarkAsFound` ~658, `report_service` ~272); UI
  picker on every path in web and mobile. Open question: a non-owner found
  report (door 3). That feature is what will credit helpers (points/badges).

## Checks

Mobile `pnpm test:run`, `npx tsc --noEmit`, `pnpm lint`, all EXIT=0; RED first
where a test applies; on-device check in the next APK.

## Progress

- 2026-10-01: doc created after the mapper report.
- 2026-10-01: T1-T3 done by the delegated writer on `fix/mobile-apk-rc1-findings`.
  - T1 RED: `__tests__/stackHeaders.test.ts` failed 4 named tests (registers
    every Stack route, gives every route a title or hides the header, draws no
    second back arrow [blocked-users], plus the route list) before the fix; the
    8 routes are now registered (`fosterHomes:detail.title` added in es/en/pt;
    `google-location` uses `auth:location.title`). Titles resolve with the real
    i18n instance in es/en/pt; mutating a key to a missing one failed the three
    named "titles in <lng>" tests.
  - T2 RED: two named adopt tests failed (not inside a horizontal ScrollView;
    wrap in one container with every chip), green after `flexWrap: 'wrap'`.
  - T3 RED: five "MapScreen controls" tests failed; controls, banners and cards
    now live in `map-bottom-controls`. Vets label: the code and keys were right
    in all 3 languages; the only defect was the English copy ("Veterinaries",
    not English), now "Vets". `__tests__/map.i18n.test.ts` fails without it.
  - Checks (mobile): `pnpm test:run` EXIT=0 (63 suites, 438 tests), `npx tsc
    --noEmit` EXIT=0, `pnpm lint` EXIT=0.

- 2026-10-01: split into stacked PRs **#311** (`fix/mobile-stack-headers`: T1 +
  guard now also catches a back arrow drawn as `arrow-back`/`chevron-left`
  icon; 428/428 on its own) and **#312** (`fix/mobile-adopt-map`: T2 + T3 +
  this doc; 438/438), tree identical to the reviewed one. Native reviews
  `review-a752e47b6009f00e` (whole branch) and `review-0339e26369a1a69b`
  (#311) approved. Unused imports after the header removal: none
  (`tsc --noUnusedLocals` EXIT=0, proven by a planted import → TS6133).
- 2026-10-01: stats diagnosis. Prod `GET /api/users/<id>/profile` returns
  total_reports 41, found_count 12, total_points 1443, share_count 19 = what the
  APK shows. What the owner saw as "correct" on searchpet.vercel.app were the
  GLOBAL home stats (`/api/stats`, real rows: 0 pets), a different endpoint.
- 2026-10-01: T4 redefined by the owner (see T4). Backend: `CountFoundByUser`
  replaced by `CountHelpedFound`; gamification no longer listens to `pet.found`.
  Tests (real Postgres): `TestPetRepository_CountHelpedFound` (6 subtests),
  `TestGamificationService_OnPetFound_CreditsNobody` (replaces the old
  owner-credit test), profile service tests updated. Mutation proofs: dropping
  the `owner_id IS DISTINCT FROM` line failed `CountHelpedFound` (want 1 got 2);
  re-adding an owner +100 upsert failed `OnPetFound_CreditsNobody`.

## Next step

Merge #311 (without --delete-branch) → retarget #312 → merge. T4 design from
the mapper, then a delegated backend writer. Then T6 APK. T5 and T7 later.
