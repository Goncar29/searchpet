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
- [x] T3 — Shared icon registry: move the path map to `shared/icons/` so web
  and a new mobile `Icon` (react-native-svg, already installed) read ONE
  source. When the owner connects the `icons0` MCP, only that file changes.
  Route: delegated writer. `85682099`, `c2033ecc`.
- [x] T4 — Mobile catalog: every rendered emoji, where it renders, keep vs
  replace, icon name. Route: delegated read-only mapper. Saved in engram
  `odd/emoji-to-icons/mobile-catalog`: ~95 UI glyphs to replace, 6 kept
  (WhatsApp template text).
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

- 2026-09-30: #304 (T1+T2) merged as `f4d634ea`; its native review escalated
  one finding (`R3-missing-icon-imports`, unknown causality) that was a false
  positive: all 50 files importing `<Icon` import it, and removing the import
  from VetPopup makes `tsc` fail with TS2304, so the green build rules it out.
- 2026-09-30: T3 done on `feat/shared-icon-registry`: `shared/icons/paths.ts`
  is the single registry (pure data, header documents the 24x24 single-path
  contract a new source must meet); web `Icon` imports it unchanged (no web
  test edited, 1089 green); mobile `components/Icon.tsx` (react-native-svg,
  decorative by default, labelled → role image). 19 new icons for mobile, all
  single-path. RED: mobile test failed on the missing module first. Parent
  re-ran mobile 337/337 and shared 413/413. The `icons0` MCP still fails to
  connect in this session (reconnect: connection closed).

## Next step

Merge the T3 PR. T5 (mobile screens + BADGE_META) waits for the icon source
decision: current Iconify registry, or icons from the `icons0` MCP once it
connects (it could keep dog/cat/bird distinct, which Material Symbols lacks).
