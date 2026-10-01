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
- [x] T5a — Mobile base: registry `dog`/`cat`/`bird` (icons0 `mdi:*`), tab
  bar, PET_TYPES consumers, BADGE_META on web + mobile (7 sites), leaderboard
  medals, common components. Route: delegated writer. `63a53e93`, `d66c688b`,
  `ebf23fc3`.
- [x] T5b — Remaining mobile screens (profile menu, home, pet detail, alerts,
  badges, leaderboard, users/[id], pets/register, my-pets, map, messages,
  chat, foster homes, groups, stories, post, shelters, blocked users).
  Route: delegated writer. `1e9ed255`, `1b6da346`.

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

- 2026-09-30: #305 (T3) merged as `56676a87`. The `icons0` MCP connected;
  it supplied `mdi:dog/cat/bird` (Material Symbols has none). Owner accepted
  the whole proposed set from a specimen page (engram
  `odd/emoji-to-icons/decisions`).
- 2026-09-30: T5a done by a delegated writer (3 commits). RED seen in every
  new suite (tabs 8/8, badges+medals 11/11, common components 13/14, chips);
  web badge tests written alongside and proven by mutation. Mutations each
  failed a named test (badge icon, inactive tab tint, silver medal, cat→dog).
  New `components/IconLabel.tsx` for icon+text rows. Parent verified the three
  MDI paths byte-equal to the MCP output and re-ran mobile 381/381.

- 2026-10-01: T5b done by a delegated writer on `feat/mobile-icons-screens`
  (2 commits). RED seen: group 1 tests 15 failed on the old screens, group 2
  30 failed (alerts, badges, blocked users, chat, messages, foster homes,
  groups, leaderboard, my pets, register, shelters, stories, post back arrow,
  plus the guard). Mutations each failed a named test: always-filled heart
  (liked=false test), emoji re-added in shelters (guard names
  `app/shelters/index.tsx:56`). New `noEmojiInScreens.test.ts` parses every
  screen and component with the TS compiler, so no emoji or UI glyph can return
  as rendered text. Glyphs that lived INSIDE i18n copy (users section titles,
  clear filters, view details, adopted title, Alert buttons and photo-failure
  text) were removed from es/en/pt and drawn as icon rows; native Alerts are
  text-only. New keys: `users:starCount_*` (rating row label) and
  `map:centerOnMe`. No registry change. Results: mobile 418/418, `tsc` 0,
  lint 0. Kept: only comments contain glyphs.

- 2026-10-01: T6 (locale copy) done by a delegated writer on
  `fix/web-locale-emoji`. The sweeps scanned source, never the JSON locales:
  8 keys (x3 languages, 24 strings) still carried glyphs. Glyphs stripped from the
  copy and drawn with registry icons (no icon added): favorite-filled
  (footer heart via `<Trans>`, reunited tile), arrow-forward (exploreApp,
  seeRanking), check (copied), celebration (found nudge; adoptedTitle already
  had one above it). `pets:share.storyDownloaded` 📲 dropped, no icon (inline
  hint text). KEPT by owner decision: `impact.shareText` (leaves the app via
  share) and `download.sideload.step1` (menu-path instruction). Mobile renders
  none of the shared keys. Guard `web/src/i18n/noEmojiInLocales.test.ts`: RED
  first (24 offenders named file:key), mutations each fail a named test
  (re-added emoji, FE0F, KEPT entry removed, KEPT entry stale).
  web 1099 + shared 416, build and lint exit 0.

## Next step

Open the T5b PR, then build the APK and check the icons on a device.
