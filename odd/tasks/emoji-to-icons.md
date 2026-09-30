# Emoji to icons (web, then mobile)

## Objective

Replace the emoji still rendered in the UI with professional icons, as the
Stitch redesigns already did for most of the web, before building the APK.

## Problem

Emoji render with each OS's color font, ignore `currentColor` and dark mode,
and look inconsistent next to the Material Symbols icons the web already uses
(`web/src/components/Icon.tsx`, inline SVG paths from Iconify
`material-symbols`, outline variants stored without the `-outline` suffix).

## Scope

Web (owner-approved plan, 2026-09-30):
- A: screens without a Stitch design — FosterHomeDetailPage, FosterHomesPage,
  FosterHomeCard, BlockedUsersPage, StoryDetailPage (like button),
  SharedPetPage.
- B: leftovers in redesigned screens — MapFilterPanel (vets toggle),
  ReportPopup, VetPopup, AlertsPage empty state, MyPetsPage photo count,
  CreatePetPage `✓`, UserProfilePage `★` rating.
- C (partial): emoji inside native `<option>` in HomePage and AdoptPage are
  removed (an SVG cannot go inside `<option>`).
- Out: GroupsPage / GroupDetailPage (no entry point, owner decision
  2026-09-17); ImpactPage (admin chart, not in the approved plan); badge emoji
  from shared `BADGE_META` (shared with mobile, handled in the mobile pass).

Mobile: next task, after the web PR.

## Tasks

- [x] T1 — Navbar theme toggle: sun/moon emoji → `light-mode`/`dark-mode`
  icons (`22b65640`), review suggestion applied (`a4a9fadb`: theme mock reset in
  afterEach, icons differ). Route: inline (1 component + 1 test).
- [x] T2 — Web A + B + `<option>` emoji, plus a click test proving the toggle
  still calls `toggleTheme` (review suggestion). Route: delegated writer
  (15+ files). `6c8dbb49`.
- [ ] T3 — Shared icon registry: move the path map to `shared/icons/` so web
  and a new mobile `Icon` (react-native-svg, already installed) read ONE
  source. When the owner connects the `icons0` MCP, only that file changes.
  Route: delegated writer.
- [ ] T4 — Mobile catalog: every rendered emoji, where it renders, keep vs
  replace, icon name. Route: delegated read-only mapper (running).
- [ ] T5 — Mobile screens + shared `BADGE_META` → icons. Waits for the owner
  to confirm the icon source (icons0 MCP vs current Iconify Material
  Symbols).

## Checks

- Web: `pnpm test:run` (web + shared), `pnpm run build`, `pnpm lint`, all
  EXIT=0.
- No emoji rendered in the scoped web files (scan with the same regex used to
  find them, comments and tests excluded).

## Progress

- 2026-09-30: branch `fix/web-icons` from `0d5e47a6`. T1 done, two native
  reviews approved (review-1344ce96891d29b5, review-72849f1a3ed2dd58).
  Inventory verified line by line: ~48 emoji in 19 web files.

- 2026-09-30: T2 done by a delegated writer (`6c8dbb49`, 36 files). New
  icons: wifi-off, flag, star, star-filled, schedule, local-hospital,
  notifications. RED seen on every "no emoji" assertion and both halves of
  each distinction (liked/not, error/empty, loadError/notFound, vets on/off,
  stars lit). Toggle click test proven by mutating onClick (named test red).
  Extra a11y: rating stars get `role="img"` + `profile:public.starCount_*`
  label, star selector buttons get aria-labels. No test: CreatePetPage `✓`
  (only after a failed photo upload); covered by scan/build/lint. Parent
  re-ran web 1089/1089 + shared 341/341. Owner: the `icons0` MCP is down
  (401); prepare everything so its icons can be plugged in later.

## Next step

Open the web PR (T1+T2). Then T3 (shared registry + mobile Icon) once the
T4 catalog lands.
