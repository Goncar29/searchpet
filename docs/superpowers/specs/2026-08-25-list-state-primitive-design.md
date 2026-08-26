# `ListState`: a primitive that stops a failed query from looking like an empty list — design

**Date:** 2026-08-25
**Status:** designed
**Branch:** `feat/list-state-primitive`, off `origin/main` at `05bf99d`

## Problem

A list query that **fails** renders identically to a list that is genuinely **empty**, and the
second one is a lie the user has no way to detect.

The shape is `const { data } = useX()` followed by `data?.map(...)` or `data ?? []`. When a query
fails, React Query returns `data: undefined`, and that `?? []` turns *"we could not load this"*
into *"you have nothing"*. Both states paint the same pixels.

The case was measured on 2026-08-24 while verifying PR #186: with `useMyPets` returning **500**,
the pet `<select>` in `CreateReportPage` shows only its placeholder and the screen says nothing.
The user concludes they own no pets. It was confirmed pre-existing — that PR did not introduce it.

### Census (measured 2026-08-25)

**Twelve web screens conflate error with empty:**

| screen | how it lies |
|---|---|
| `HomePage` | **two lists.** The FEED — `searchResults?.data && length > 0`, otherwise the empty state. Also the "Historias de éxito" strip — `featuredStories && featuredStories.length > 0`, which hides the whole section (no error, no explanation) when `useStories` fails |
| `MyPetsPage` | `!pets \|\| pets.length === 0` |
| `ProfilePage` | `ownedPets.length > 0` and `adoptionPets.length > 0` |
| `AdoptPage` | `data?.data ?? []` |
| `AlertsPage` | `data ?? []` |
| `StoriesPage` | `stories && stories.length > 0` |
| `PetDetailPage` | `reports && reports.length > 0` — the timeline vanishes silently |
| `CreateReportPage` | the pet `<select>` (the original case) |
| `components/publish/LostPetStep` | `(pets ?? [])` → "you have no pets" |
| `UserProfilePage` | the reviews list only; the profile itself does handle `error` |
| `admin/AbuseReportsPage` | `result?.data ?? []` |
| `admin/StoriesAdminPage` | `result?.data ?? []` |

**Fifteen already handle it correctly and are out of scope:** `LeaderboardPage`, `MapPage`,
`GroupsPage`, `SheltersPage`, `FosterHomesPage`, `MyShelterPage`, `MyFosterHomePage`,
`MessagesPage` (via `components/chat/MessagesShell`), `CreateStoryPage`, `BlockedUsersPage`,
`StoryDetailPage`, `FosterHomeDetailPage`, `admin/VetsAdminPage`, `admin/AdminsPage`,
`admin/SheltersAdminPage`.

Mobile has 15 files carrying the same shape. **Not measured. Out of scope for this change.**

### Two proxies that did not work, and why

Recording these so nobody repeats the census the slow way:

1. **Grepping `?? []`** returns 38 hits across 25 files, but it includes utils and tests, and it
   misses the screens that write `!pets || pets.length === 0` without `??` at all.
2. **Counting `isError` per file** does not work either, because the occurrences may be covering a
   **mutation** rather than the list.

The only thing that decides is reading how the render branches: the `isLoading → error → empty →
data` chain.

## The precedent this generalizes

`LeaderboardPage` (lines 421-450) already solved this, and its guard carries knowledge that is not
obvious:

```tsx
{city && error && !entries?.length && ( ...error card... )}
```

The guard is **`error && !entries?.length`, not `error` alone**. React Query **keeps cached data
when a refetch fails**, and `isLoading` is `false` in that state. With a bare `error`, a transient
failure — a Render cold start after the service sleeps, a 502 — **replaces an already-drawn
ranking with an error card**. Showing stale data beats blanking data that is already on screen.

`CreateStoryPage` contributes the copy, already translated into es/en/pt:

> **`stories:create.loadErrorTitle`** — "No pudimos cargar tus mascotas"
> **`stories:create.loadErrorBody`** — "No es que no tengas ninguna: no llegamos a leer la lista. Probá de nuevo."

That body is the whole point of this change stated in one sentence. The primitive generalizes that
voice rather than inventing a new one.

## Non-goals

- **Migrating the 15 correct screens.** They work. Touching them risks regressing hand-measured
  layouts (Leaderboard's skeleton mirrors the podium; a 272px horizontal jump was measured when it
  moved columns) for zero user-visible gain.
- **Mobile.** Same class, unmeasured, separate change.
- **A shared loading skeleton or a shared empty state.** Those are per-screen by design; see below.
- **Preventing a future screen from skipping the primitive.** See "What this does not solve".

## Design

### API

```tsx
<ListState
  query={adoptions}                // the whole UseQueryResult
  select={(d) => d.data}           // required by the type only when data is not already an array
  loading={<AdoptionsSkeleton />}  // the screen's own slot
  empty={<NoAdoptions />}          // the screen's own slot
  idle={<SignInPrompt />}          // optional; defaults to the `empty` slot
  errorTitle={t('adoption:loadErrorTitle')}  // optional; defaults to common:loadErrorTitle
  errorBody={t('adoption:loadErrorBody')}    // optional; defaults to common:loadErrorBody
>
  {(pets) => pets.map((p) => <PetCardWeb key={p.id} pet={p} />)}
</ListState>
```

Four decisions inside that signature:

- **It takes `query`, not `data`.** The primitive then owns `refetch`, so the retry button costs no
  prop and cannot be wired wrong.
- **`select` is required by the type only when it is needed** —
  `TData extends TItem[] ? { select?: ... } : { select: ... }`. The hooks genuinely disagree on
  shape: `useMyPets` returns the bare array, `useStories` returns `StoryListResponse`,
  `useUserReviews` returns `{ reviews }`, `useAdoptions` returns a paginated envelope. Passing
  `items={q.data?.data ?? []}` instead would reintroduce the exact smell this change removes.
- **`loading` and `empty` are required slots.** The primitive owns the **branching**, not the
  content. Leaderboard keeps its measured skeleton; Messages keeps its title + subtitle empty state.
- **The error is not a slot.** It is the branch that kept getting forgotten, so the primitive renders
  it. `errorTitle` and `errorBody` only re-word the card; there is no prop that removes it, and no
  way to reach branch 5 without branch 3 having been considered. You cannot omit what you never pass.

### State machine

| # | condition | renders |
|---|---|---|
| 1 | `isLoading` (`isPending && isFetching`) | the `loading` slot |
| 2 | `isPaused` **and** `items.length === 0` → **offline** | the offline card + retry |
| 3 | `isPending` → **disabled query** | the optional `idle` slot; defaults to the `empty` slot |
| 4 | `isError` **and** `items.length === 0` | the primitive's error card + retry |
| 5 | `items.length === 0` | the `empty` slot |
| 6 | `items.length > 0` | offline banner if `isPaused`, else stale banner if `isError`, then `children(items)` |

`items` is computed as `query.data == null ? [] : select(query.data)`, and the **selected value is
guarded too** (`raw ?? []`). Guarding only the input to `select` left the same blank screen one
level down, for any envelope hook whose selected field came back null.

Five invariants that must be stated in code comments, because each one is a trap already paid for:

- **`isLoading`, never `isPending`, for row 1.** In React Query v5 a **disabled** query sits at
  `status: 'pending'` forever — it was never asked. Branching on `isPending` would give
  `LostPetStep` an **infinite skeleton** for a signed-out user, which is a worse bug than the one
  being fixed. `isLoading = isPending && isFetching`, so it is `false` while disabled.
  More than 20 hooks pass `enabled` (`useMyPets(isAuthenticated)`, `useReportsByPetID` with
  `enabled: !!petID`, `useUserReviews` with `enabled: !!userId`), so this is wide, not a corner.
- **Row 2 must come BEFORE row 3, and this design originally got it wrong.** The first version of
  this spec claimed that reaching row 3 with `isPending` still true "means one thing only: the query
  is disabled". **That claim is false**, and it survived three reviews before `/code-review` caught
  it. Verified against the installed `@tanstack/query-core@5.100.14`: `retryer.js:11` defines
  `canFetch` as `(networkMode ?? 'online') === 'online' ? onlineManager.isOnline() : true`;
  `query.js:415` sets `fetchStatus: canFetch(...) ? 'fetching' : 'paused'`;
  `queryObserver.js:307,310,332` derive `isFetching = fetchStatus === 'fetching'`,
  `isLoading = isPending && isFetching`, and `isPaused = fetchStatus === 'paused'`. The project sets
  no `networkMode`, so the default applies. Therefore an **offline first load** gives
  `isPending: true, isFetching: false, isLoading: false` — it falls past row 1 into the disabled
  branch and renders the `empty` slot, i.e. *"you have nothing"*. That is the exact lie this
  component exists to kill, and it is reachable in production: SearchPet is a PWA whose service
  worker serves the shell offline (rule #28). Row 2 is what makes row 3's claim true.
- **Row 4 requires `items.length === 0`.** This is the Leaderboard lesson above. Without it, a cold
  start erases a drawn list.
- **The primitive wraps no slot in a `<div>`.** Leaderboard's skeleton lives inside a `grid` and its
  column placement was measured. A wrapper element would break it. The banner is the one element the
  primitive owns, and it carries `col-span-full w-full` for the same reason: it is a sibling of
  `children(items)` inside the consumer's container, so in a `grid` it would otherwise become the
  first grid cell and shift every card by one position. `col-span-full` is correct in a grid and
  inert in flex and block.
- **`role="alert"` on the error and offline cards, `role="status"` on the banner.** The first
  interrupts, because there is nothing on screen to look at. The second must not, because the data
  is right there.

### Stale data

When a refetch fails but cached data is on screen, the list stays and a discreet banner appears
above it: *"No pudimos actualizar"* plus a retry. The user never loses what they were looking at,
and never believes stale data is fresh. This is a deliberate step beyond Leaderboard, which today
keeps the stale data **silently**.

Offline with cached data gets its own message — *"Sin conexión. Estás viendo datos guardados."* —
rather than reusing the failed-refetch one. They are different facts, and the offline one tells the
user something they can act on.

### Screens that merge two queries

**One query per `ListState`.** `MyPetsPage`, `ProfilePage`, `HomePage` and `CreateStoryPage` each
read from two or more. Those screens keep their own composition and their own partial-failure
message; the precedent already exists and is already translated:

> **`stories:create.partialListWarning`** — "No pudimos leer una de tus listas, así que puede faltar alguna mascota acá."

`MyPetsPage` is not actually a merge: it renders one query per **tab**, so each tab gets its own
`ListState`.

### New i18n keys

**They go in `frontend/packages/shared/i18n/locales/{es,en,pt}.json`, not in the web locales.**
`common` is the one namespace the web does not own: `web/src/i18n/index.ts` pulls it from
`sharedEs.common` / `sharedEn.common` / `sharedPt.common`. Adding the keys to
`web/src/i18n/locales/es.json` would put them somewhere nothing reads.

Seven keys under `common`, following the `CreateStoryPage` voice:

- `common:loadErrorTitle` — the default error card heading
- `common:loadErrorBody` — must carry the "it is not that you have none" distinction
- `common:retry` — the retry button
- `common:staleTitle` — the banner text after a failed refetch
- `common:offlineTitle` / `common:offlineBody` — the offline card (row 2)
- `common:offlineStale` — the banner when offline with cached data

**`common:retry` is a new key and not a reuse of the existing `common:reload`.** That one reads
"Reintentar" too, but it belongs to `ErrorBoundary`, where it means *reload the page* after a render
crash — its sibling `common:errorDescription` says "intentá recargar la página". Here the button
refetches one query and leaves the page alone. Two different actions that happen to share a Spanish
word should not share a key, or the day one of them needs different wording both move together.

Because `common` is shared, **mobile inherits these keys**, which is deliberate: the mobile port of
this class is a later change and will not have to re-translate anything.

`shared/i18n/locales.test.ts` **did not** assert key parity across the three files before this
change — it was checked, and it only asserted the no-asterisk rule from PR #185 (see the file's own
comment header). A key added to only one language would have rendered as the raw key on screen for
the other two, with nothing failing (project rule #21). This change adds that parity test, comparing
`en` and `pt` against `es` in both directions (missing keys and orphaned keys). Screens with
better-fitting existing copy pass `errorTitle` / `errorBody` instead — `CreateStoryPage` keeps its
own.

Per rule #21, `common` is already registered in `web/src/i18n/index.ts`; no registration change is
needed.

## Testing

Per rules #34 and #41, every test below is written by **restoring the defect first and watching it
go red**. A green test that was never seen red proves nothing.

**Primitive tests** (Vitest + RTL, alongside the component):

| test | proven red by |
|---|---|
| a disabled query does **not** render the skeleton | swapping `isLoading` for `isPending` → infinite skeleton |
| error **with** cached data renders the list + banner, not the error card | dropping `&& items.length === 0` → the list disappears |
| error with no data renders the card, and retry calls `refetch` | — |
| a genuine empty renders the `empty` slot | — |
| slots render with **no wrapper element** | adding a `<div>` → Leaderboard's grid breaks |

**Per-screen test**, one per ported screen and always the same assertion: **with the query returning
500, the screen does not say "you have nothing"**. This is the assertion that defines the change.
Without it, each port is a promise rather than a fix.

Before merging, `/verify` in the browser — the original defect was found by driving the browser, not
by the suite.

## Rollout

Chained PRs, ~400 lines each, per the `searchpet-pr` convention. Note rule #44: CI now runs on every
PR regardless of base branch, so a stacked PR does execute its jobs.

| PR | contents |
|---|---|
| 1 | the primitive + tests + i18n keys |
| 2 | `HomePage`, `MyPetsPage` — highest traffic |
| 3 | `AdoptPage`, `AlertsPage`, `StoriesPage` |
| 4 | `PetDetailPage`, `CreateReportPage`, `LostPetStep` |
| 5 | `ProfilePage`, `UserProfilePage` |
| 6 | `admin/AbuseReportsPage`, `admin/StoriesAdminPage` |
| 7 | `HomePage`'s "Historias de éxito" strip. Deliberately **not** part of PR 2: porting it there would have been scope creep on the feed port. Its `empty` slot must be `<></>` — this section is meant to disappear when genuinely empty (no stories yet is not a fact worth a card), unlike the feed, whose `empty` states this doc's fix asserts must render. |

Per rule #30, every branch is cut from `origin/main`, and per rule #49 the base of a stack is merged
**without** `--delete-branch`.

## What this does not solve

**Nothing forces screen number 13 to use the primitive.** `FormField` becomes inevitable inside a
form that already adopted it; `ListState` has no equivalent leverage — a new screen can always write
`data ?? []` and nothing will fail. The mitigation is that the primitive exists, is the obvious path,
and is written down here and in the project memory.

Claiming this class is closed for good would be false, and this document will not claim it.

## Three things to look for while porting

Carried over from the form-primitive port, where all three appeared unrequested:

1. **Hardcoded conditions inside the JSX** that duplicate what the primitive now decides.
2. **Empty-state copy that asserts a fact** ("you have no pets") where the screen cannot actually
   know it. That copy has to survive only in branch 4.
3. **Screens whose `empty` slot is doing double duty** as both "nothing yet" and "filter matched
   nothing". Those are different states; `MessagesShell` renders the second one **above** the list
   rather than in place of it, which is the pattern to copy.
