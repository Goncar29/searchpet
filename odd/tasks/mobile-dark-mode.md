Mobile dark mode, chosen from the profile Settings row: System / Light / Dark.
Branch base: `origin/main` (`584bad55`). Delivery: chained PRs (forecast well over
400 lines). Runner: `pnpm test:run`, `pnpm exec tsc --noEmit`, `pnpm lint` in
`frontend/packages/mobile`.

## Specs

- S1 — The profile "Settings" row (`app/(tabs)/profile.tsx`, today an alert
  "coming soon") lets the user choose the theme. Owner decision (2026-10-05):
  "a" = three options, **System / Light / Dark, System by default**. The app
  follows the phone until the user picks Light or Dark, and can always go back
  to System.
- S2 — The choice persists across restarts in AsyncStorage under the key
  `searchpet-theme` (same key as the web). Assumption: values `system`,
  `light`, `dark`; anything else reads as `system`.
- S3 — Every screen, the header, the tab bar and the status bar follow the
  active theme. Dark palette = the web's dark tokens (`web/src/index.css`
  `.dark`): page `#111827`, raised surfaces `#1F2937`, border `#374151`, text
  `#F9FAFB`, muted text `#9CA3AF`, danger `#F87171`. Brand and status colors
  stay the same.
- S4 — No screen is left half-migrated: a guard test fails if a file builds a
  `StyleSheet` with theme colors at module level, or if a screen/component has
  a color literal outside the palette (with an explicit, reasoned allowlist).
- S5 — The three maps use a dark map style in dark mode (MapTiler main map,
  OpenFreeMap on the publish location step and the timeline map). Assumption:
  both providers publish a dark style; verify before using it.
- S6 — Light mode looks exactly as today (the light palette keeps today's
  values).

## Tasks

- [x] T1 — Foundation: palettes, theme store (`system|light|dark` +
  AsyncStorage `searchpet-theme` + `useColorScheme`), `useTheme()` and
  `useThemedStyles(makeStyles)`, both layouts (Stack/Tabs options, StatusBar),
  Settings row with the three options, global jest mocks. Links S1, S2, S3, S6.
  Route: inline. Done in #330 (`09b62cc8`): 524/524 mobile, 3 review rounds
  (cycle cut at round 3; its late-flip WARNING kept on purpose: a saved choice
  that loads after the 1s cap still applies).
- [ ] T2 — Migrate `app/(tabs)/*` and `app/pet/*`, `app/users/*`. Links S3.
  Route: delegated (parallel units, disjoint surfaces).
- [ ] T3 — Migrate the remaining `app/**` screens. Links S3. Route: delegated.
- [ ] T4 — Migrate `components/**`. Links S3. Route: delegated.
- [ ] T5 — Hardcoded color literals, `SHADOWS`/`REPORT_STATUSES`, and the
  guard test. Links S4. Route: inline.
- [ ] T6 — Dark map styles. Links S5. Route: inline.

## Log

- L1 (2026-10-05, owner): "Vamos por las dos sugerencias, después el dark mode y
  después vamos por el APK así después terminado verificamos todo de una sola
  vez"
- L2 (2026-10-05): map of mobile theming — one flat light `COLORS`
  (`constants/index.ts:14-53`), 51 files with module-level `StyleSheet.create`
  baking `COLORS`, ~74 color literals in 22 files, no `useColorScheme` anywhere,
  `app.json` already `userInterfaceStyle: automatic`, root layout hardcodes
  `StatusBar style="dark"`. `COLORS.white` means both "surface" and "literal
  white on brand buttons": every use is decided by hand.
- L3 (2026-10-05, owner): selector = "a" (System / Light / Dark, System default).
- L4 (2026-10-05, owner): delivery = "b", a feature branch `feat/mobile-dark-mode`
  that merges to `main` once at the end.
- L5 (2026-10-05): T2-T4 split by folder, ~389 / ~476 / ~293 `COLORS` uses; each
  unit also resolves the color literals inside its own files. Shared files
  (`constants`, `hooks`, `store`, `jest.setup.js`, locales) stay with the parent.
