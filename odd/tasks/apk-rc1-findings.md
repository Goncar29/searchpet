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
- [ ] T4 — Profile stats: decision pending with the owner.
- [ ] T5 — Dark mode in mobile via Settings. Separate feature (size L).
- [ ] T6 — New APK and owner re-check.

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

## Next step

T1-T3 writer; T4 decision.
