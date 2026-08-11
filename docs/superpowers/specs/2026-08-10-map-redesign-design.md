# Map page: Stitch layout, server-side filters and brand markers — design

**Date:** 2026-08-10
**Status:** designed
**Branches:** three chained — slice 1 off `main`; slice 2 off slice 1; slice 3 off slice 2.
Chained PRs are merged base-first and **without `--delete-branch`**, retargeting each child to
`main` before deleting anything (rule #49).
**Design source:** Stitch project `16519613178896842350`, screen "Mapa - PawFinder (Redesign)"
(`1c355b1364f048c098e8cf8036085a9e`)

## Problem

`MapPage.tsx` predates the Stitch design language. It renders the map as a card inside the
standard `max-w-7xl` container, with the radius selector, the vets toggle and the colour legend
crowded into a header row above it. Three pages already carry the new language (home #128, pet
detail #130, public landing #143), so the map is now a visible seam.

Two functional gaps sit underneath the cosmetic one:

- **No filtering.** `GET /api/reports/nearby` takes `lat`, `lng` and `radius` and nothing else.
  A user looking for a cat sees every dog report in the radius, with no way to narrow by species,
  by report kind, or by date.
- **Markers carry no identity.** Every pin is one of four flat PNGs, so the map answers "something
  happened here" but never "which pet". Recognising a specific animal requires opening popups one
  by one.

The marker PNGs are also fetched from `raw.githubusercontent.com` at runtime — a third-party origin
on the critical path of the app's most-used screen, held open in the CSP for nothing but four
coloured pins.

## Decisions

| Decision | Rationale |
|---|---|
| Full scope: layout **and** the new filters, backend included | The design's filter panel is its structural centre; porting the layout without it would leave an empty shell. |
| Text location **navigates**, it does not filter | The map already answers "where" with centre + radius. A second source of truth for the same question produces results that match neither control on screen. Geocoding recentres the map; the search still runs on centre + radius. |
| Explicit "Apply filters" button; no filtering while typing | Matches the design, and matches the draft/applied pattern already adopted in web and mobile after filters were found firing a request per keystroke. |
| Date range travels as **RFC3339 instants resolved by the client** | The server must not guess the user's timezone. What a user means by "a day" is resolved where the user is. |
| Unknown `type`/`status` values return **400** | A filter silently dropped lies to the user about what they are looking at. |
| Bottom sheet on mobile, hand-rolled | The map is used one-handed in the street; the sheet is the only option that keeps map and results visible at once. Hand-rolled because a sheet library for a single screen is disproportionate under this project's supply-chain rules. |
| The panel collapses on desktop too, from the side | The full-bleed exception to rule #50 says the map's pixels matter; a panel that cannot move contradicts it. Direction differs per breakpoint because the scarce dimension differs — see slice 3. |
| Markers become the Rastro logo with the pet's photo | Brand consistency plus a real usability gain — the map becomes readable at a glance. Also removes the `raw.githubusercontent.com` dependency. |

## Out of scope

- **The "new sighting" toast** from the design. Real-time alerting is a separate feature and one
  already exists (`location_alerts` + FCM push). Building a second notification path beside the
  working one is not a map concern.
- **Neighbourhood polygons.** Searching by administrative area instead of by circle would replace
  the search model entirely. That is its own project.
- **The mobile app's map.** The Stitch design is web. The React Native screen uses MapLibre and has
  its own layout; it is untouched here.

## Slice 1 — backend filters (deployable alone)

`GET /api/reports/nearby` gains four **optional** parameters. Absent means unfiltered, so the
endpoint behaves exactly as it does today and this slice ships before any UI consumes it.

| Param | Shape | Notes |
|---|---|---|
| `type` | `perro` \| `gato` \| `pajaro` \| `otro` | Matches `pets.type` through the existing join. Values are Spanish and there are **four** — the canonical union is `PetType` in `shared/types/index.ts`, mirrored by `PET_TYPES`. Do not invent an English set. |
| `status` | comma-separated: `lost,found,sighting` | Matches `reports.status`. Multi-value: the design's chips are multi-select. |
| `from` | RFC3339 instant | Lower bound on `reports.occurred_at`, inclusive. |
| `to` | RFC3339 instant | Upper bound, inclusive. |

Validation mirrors the radius parameter's existing style: unparseable values are `400`
(`ErrInvalidInput`); `from` later than `to` is `400`. The radius precedence chain — explicit
parameter, then the authenticated user's `search_radius_meters`, then the 5000 m default — is
untouched.

### The invariant that must not move

`FindNearby` already filters by **`pets.status IN MapVisibleStatuses`** (lost, stray, found) and by
`reports.episode_id = pets.current_episode_id`. That is what keeps closed cases and other people's
now-private pets off the map.

The new `status` filter is a different column — `reports.status` — and it operates **inside** that
allowlist. The allowlist and the episode scope stay unconditional, outside the criteria struct;
no query-string value can reach a report the allowlist already excluded. This is rule #13 applied
here: visibility comes from the allowlist, never from a parameter.

### Shape

`FindNearby(lat, lng, radius)` would grow to seven positional parameters. It takes a
`NearbyReportCriteria` struct instead, following the `PetSearchCriteria` precedent already in the
repository layer. The struct carries only the user-supplied filters; the allowlist is applied by
the repository regardless of its contents.

## Slice 2 — web desktop

### Component split

`MapPage.tsx` is 297 lines today and would pass 600. It splits into:

| File | Responsibility |
|---|---|
| `MapPage.tsx` | Orchestration: map centre, applied filters, data fetching, layout. |
| `MapFilterPanel.tsx` | Type select, status chips, location search, date range, radius, vets toggle, Apply. |
| — | **Not everything in the panel goes through Apply.** Type, status and dates are draft state and need Apply. The **radius** keeps its current immediate behaviour (it redraws the circle on screen, so deferring it would show a circle that does not match the results). The **vets toggle** is also immediate: it switches a map layer, it does not filter reports. |
| `NearbyReportList.tsx` | The "reports in this area" list, driven by the same response as the markers. |
| `ReportPopup.tsx` / `VetPopup.tsx` | Extracted from the current inline JSX. |
| `useMapFilters.ts` | Draft/applied state. Reused unchanged by slice 3. |

### Layout

Full-bleed map with the filter panel fixed to its left, per the design.

**This page deliberately breaks the `max-w-7xl` convention (rule #50).** That rule caps *content*
pages to the navbar's width. The map is a canvas, not content: capping it would waste the viewport
on the one screen whose whole value is how much ground it shows. The exception is recorded here so
it is not "fixed" later by someone applying the rule mechanically.

### Geocoding

Nominatim (`https://nominatim.openstreetmap.org/search`), consistent with the project's existing
OpenStreetMap usage and its $0/month constraint. Requirements:

- Debounced, submitted on Enter — not per keystroke. Nominatim's usage policy caps at 1 req/s.
- **Identification comes from the `Referer` the browser sends automatically — NOT from a
  `User-Agent` header.** An earlier version of this spec asked for `User-Agent`, which is
  impossible: the Fetch standard lists it as a forbidden header name, so the browser ignores any
  attempt to set it. Writing that code would look like policy compliance and do nothing — the same
  family as a check that reports success without running. From a browser app the automatic
  `Referer` is what identifies the caller, and it is what Nominatim's policy expects for this case.
- No result and network failure are distinct states in the UI. A silent no-op reads as a broken app.
- **`connect-src` in `vercel.json` must list the Nominatim origin.** Without it the search works in
  local dev and fails only in production, without breaking the build (rule #23). Slice 2 is not
  done until this is verified on a Vercel preview.

## Slice 3 — responsive

Two changes, one per breakpoint. They share a premise: the panel should **overlay** the map and be
dismissible, never be pushed out of the way. What differs is the direction, and the direction is
decided by which dimension is scarce at each size.

### Mobile — bottom sheet

Bottom sheet with three snap points: peek (filter summary and result count), half (list visible),
full (filters open). Built with pointer events and CSS transforms; no new dependency.

The one hard part is gesture arbitration: a drag starting on the sheet handle must move the sheet,
and a drag starting on the map must pan the map. Leaflet's own handlers must be suppressed inside
the sheet's bounds.

**A side drawer was considered and rejected here.** Recorded because it is the obvious alternative
and will be proposed again:

- **The geometry does not fit.** The panel needs ~300px. On a 390px-wide phone that is 77% of the
  width — opening it *is* covering the map. A sheet at 40% height spends 338px of 844 and leaves
  ~500px of map at full width. On a phone the width is the scarce dimension and the height the
  abundant one; a side drawer spends the scarce one.
- **It breaks the feedback loop.** What makes the sheet work is that you filter and watch the pins
  change in the same gesture. A binary drawer turns that into apply → close → look.
- Minor but real: a thumb reaches the bottom edge one-handed. It does not reach the top corner of a
  tall phone.

### Desktop — collapsible panel

A toggle that slides the `aside` out of the way and gives its ~320px back to the map.

This closes a contradiction the current layout carries: slice 2 deliberately breaks `max-w-7xl`
(rule #50) on the grounds that *"the map is a canvas and capping it would waste the viewport on the
one screen whose whole value is how much ground it shows"* — and then pins a panel to it that
cannot be moved. Either those pixels matter or they do not.

Here the side **is** the right direction: at desktop width the horizontal room is abundant, and the
panel is already anchored there. Cheap to build — the `aside` is an isolated component and
`useMapFilters` already owns the state, so collapsing it unmounts nothing and loses no draft.

The collapsed state is view-only: it must not clear filters, and it must not be confused with
"no filters applied". Whatever summary the peek state shows on mobile is the same information the
collapsed rail should surface on desktop, so a user cannot lose track of an active filter by
closing the panel.

## The marker

The Rastro logo is a trail of three growing circles leading into a paw:

```
circle (10, 82) r=4        the small left dot
circle (28, 72) r=5.5
circle (47, 61) r=7
  ellipse (51, 64) rx=23 ry=19    the pad — largest element
  + four toe circles
```

The marker reuses this construction with **marker-tuned proportions**: the trail shrinks and the paw
grows, so the pad becomes a ~30px circle holding the pet's photo, crowned by the four toes. At the
logo's native proportions the pad is 30% of the width, which at a 40px marker leaves a ~12px oval —
too small to tell a cat from a dog, which defeats the purpose.

- **Anchor:** the small left dot. The trail becomes the pin's tip and touches the real coordinate.
- **Status moves to the ring.** Today the status is encoded in the marker's colour. With the photo
  in the centre, the coloured ring around it carries that meaning, using the existing
  `--color-lost` / `--color-found` / `--color-sighting` tokens. The legend keeps matching because it
  reads from the same tokens.
- **No photo:** the paw renders solid in the status colour — today's marker, essentially.
- **Implementation:** `L.divIcon` with inline SVG plus an `<img>`, replacing the four `L.Icon` PNGs
  and the `raw.githubusercontent.com` origin with them.
- **Bandwidth:** photos are requested through Cloudinary transformations at marker size
  (`w_64,h_64,c_fill,g_auto`), never full-size. Cloudinary's free tier is bound by bandwidth, not
  storage, and this screen can render dozens of markers at once.

## Design tokens

No new colours or fonts. The page consumes what PR #126 established in `src/index.css`: primary
`#C24E1A`, the three status colours above, Inter for body, Fredoka for brand, Plus Jakarta Sans for
display headings, and the existing radius and shadow scales.

## Testing

**Backend, against real Postgres** (`tests/`, not mocks). This is a query: mocks have no columns, no
joins and no allowlist, so they cannot fail the way the database fails (rule #34). Cases:

- Each filter alone, and combined.
- Absent filters return exactly today's result set — the backward-compatibility guarantee that lets
  slice 1 ship alone.
- **The widening test:** a report whose pet is `archived`, requested with a `status` that matches
  the report, returns nothing. This one is written against the bug — the guard is removed, the test
  is confirmed red, and only then trusted green.
- `from` > `to` returns 400.

**Web:** Vitest over `useMapFilters` (draft state does not fetch; Apply does), `NearbyReportList`,
and the marker's status→ring mapping including the no-photo fallback.

## Method

**SDD: not used.** The ambiguity SDD exists to reduce was resolved during brainstorming and is
captured here. A parallel `openspec/` artifact set would restate this document. Size and risk never
select SDD on their own — only an explicit request does.

**TDD: yes, for logic; no, for layout.** A failing test written before moving a panel to the left
proves nothing. Applied strictly to:

- the widening test (remove the allowlist guard, confirm red, then trust green);
- the backward-compatibility test that lets slice 1 ship alone;
- the date bounds and `from > to` rejection;
- `useMapFilters` draft-vs-applied behaviour;
- the marker's status→ring mapping and its no-photo fallback.

Layout and gesture work is verified by looking at it and by the existing smoke tests.

**RDD: yes, one cycle per slice.** Entry is always
`gentle-ai review status --contract gentle-ai.review-integration/v2 --agent claude-code
--next-transition`, routing only from the returned `next_transition`.

Two consequences that shape the work rather than merely follow it:

- The candidate **freezes** at review start and admits **one** bounded correction. The habit of
  review → push fixes → review again (PR #138 took three rounds) becomes three separate reviews of
  three candidates. Arrive whole.
- Every source-mutating step — formatters, linters, generated files — runs **before** review start.
  After that point any changed byte invalidates the receipt.

Slice 1 touches a visibility invariant, so it may be classified high risk and draw the canonical
four-lens review. If so, the cost forecast is given before the first lens runs, and any consent
envelope is relayed in full for the user to answer.

## Open risks

- **Nominatim rate limits are shared per origin.** A burst from several users could see throttling.
  Accepted: the search is submit-triggered, not incremental, so real usage stays far below the cap.
- **Marker density.** Dozens of image markers cost more than dozens of PNG pins. Mitigated by
  thumbnail transformations; clustering is deliberately not in scope and can be added later if the
  numbers demand it.
