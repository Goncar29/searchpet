# Impact Dashboard — Monthly Detail Drill-Down

**Date:** 2026-07-21
**Status:** Approved (design)
**Depends on:** the admin impact dashboard (branch `feat/public-impact-dashboard`, PR #104)

## Context

The admin-only impact dashboard (`/admin/impact`) currently shows lifetime
totals, trailing-12-month trend charts (reunions, new users, reports), a
pets-by-type breakdown, and per-queue moderation counters. It answers "how are
we doing overall" but not "what happened in a specific month, and which records
were involved". This change adds a monthly drill-down: pick a month, see that
month's activity numbers, and browse the actual records behind them.

## Goals

- Let an admin select a month and see that month's **activity numbers**:
  reunions, new users, reports.
- Let the admin **browse the records** behind two of those numbers: the pets
  reunited that month and the reports created that month, each linking to detail
  where applicable.
- Reuse the existing dashboard components and hand-rolled styling; add zero new
  UI dependencies.

## Non-Goals

- No historical view of **snapshot** metrics (total users, active searches now,
  reunion rate, moderation queues). These reflect current DB state and were
  never snapshotted per month, so they cannot be reconstructed for past months.
  The monthly section is explicitly labelled "activity of the month" and shows
  only event-sourced numbers. The global "now" section above is unchanged.
- No "new users" or "newly published pets" record lists (kept as numbers only;
  can be added later if wanted).
- No component library (shadcn) and no `@tanstack/react-table`. Monthly record
  counts are small; capped lists with a client-side "show more" suffice.
  Revisit only if a month's lists grow large enough to need server pagination.

## Key Constraint: event-sourced vs snapshot metrics

Two kinds of metric power the dashboard:

- **Event-sourced** (reconstructable for any past month): reunions
  (`platform_events` `pet_found`), new users (`users.created_at`), reports
  (`reports.created_at`). The monthly drill-down operates on these.
- **Snapshot / live** (only "now"): total users/pets, active searches, reunion
  rate, pets-by-type, moderation. Out of scope for the monthly view.

## Scope Decisions (resolved)

1. Record lists: **reunited pets + reports created** (users/published deferred).
2. Placement: a **section on the existing `/admin/impact` page** (no new route).
3. Endpoint contract: as specified below.

## Backend

One new admin-gated endpoint, mounted in the admin group alongside
`GET /api/stats/impact`:

```
GET /api/stats/impact/monthly?month=YYYY-MM
```

**Response:**

```json
{
  "month": "2026-06",
  "totals": { "reunions": 14, "new_users": 3, "reports": 20 },
  "reunited_pets": [
    { "id": "uuid", "name": "Firulais", "type": "perro", "reunited_at": "2026-06-12T00:00:00Z" }
  ],
  "reports": [
    { "id": "uuid", "pet_name": "Michi", "status": "sighting", "created_at": "2026-06-03T00:00:00Z" }
  ],
  "truncated": false
}
```

**Behaviour:**

- `month` validated against `YYYY-MM`; invalid → `{code,message}` 400 via
  `writeError`. Missing/empty → default to the current calendar month.
- `totals.reunions` = count of `platform_events` `pet_found` with
  `date_trunc('month', created_at) = month`.
- `totals.new_users` = `users` with `created_at` in the month.
- `totals.reports` = `reports` with `created_at` in the month.
- `reunited_pets` = `platform_events` (`pet_found`) joined to `pets`, filtered by
  the event month, ordered by event time desc, capped at `MONTHLY_RECORD_CAP`
  (~50). `reunited_at` is the event's `created_at`.
- `reports` = `reports` in the month joined to `pets` for `pet_name`, ordered by
  `created_at` desc, capped at the same cap.
- `truncated` = true if either list hit the cap (signals the UI to show a "more
  in this month" hint).
- Caching: follow the existing `ImpactHandler` pattern, keyed by month. A
  `map[string]monthlyCacheEntry` (each entry = payload + `computedAt`) guarded by
  the handler's existing mutex; TTL reuses `impactCacheTTL`. Since `month` is
  validated to `YYYY-MM`, an unbounded set of keys is possible in principle, so
  the map is cleared when it exceeds a small cap (e.g. 24 entries) before
  inserting. Months other than the current one are effectively immutable, so
  serving them from cache is safe.

Reuses the existing handler's DB and error conventions; no new domain models.

## Shared (frontend/packages/shared)

- `MonthlyImpact` type (mirrors the response) + `MonthlyImpactReunion` /
  `MonthlyImpactReport` item types, in `types/index.ts`.
- `getMonthlyImpact(month: string): Promise<MonthlyImpact>` in `api/client.ts`
  (auth token auto-attached, same as `getImpactStats`).
- `useMonthlyImpact(month: string)` hook in `hooks/index.ts`, `queryKey:
  ['impact-monthly', month]`, enabled when `month` is set.

## Web (frontend/packages/web)

New section on `ImpactPage`, below the trend charts:

- A native `<select>` of months, populated from the already-fetched
  `reunions_by_month` series (the 12 trailing months come free). Default = the
  latest month. Selecting a month drives `useMonthlyImpact`.
- On data: three `StatTile`s (reunions / new users / reports for the month), then
  two hand-rolled Tailwind tables:
  - **Reunited pets:** name, type, date — row links to `/pets/:id`.
  - **Reports:** pet name, status, date.
- Lists render up to the returned cap; if `truncated`, show a small note. A
  client-side "show more" reveals rows beyond an initial slice (e.g. 10) without
  another request.
- Loading / error states mirror the existing page (`getErrorMessage`).
- i18n keys added to the `impact` namespace for es/en/pt (section title,
  "activity of the month", column headers, empty/loading/truncated strings).
  Namespace already registered in `web/src/i18n/index.ts`.

## Data Flow

1. `ImpactPage` renders the trend section (existing) and derives the month list
   from `reunions_by_month`.
2. User picks a month → `useMonthlyImpact(month)` fetches
   `/api/stats/impact/monthly?month=…`.
3. Backend computes the month's event-sourced totals + capped record lists,
   serves from the per-month cache when warm.
4. The section renders tiles + the two tables.

## Error Handling

- Invalid `month` → 400 `{code,message}`; the UI shows the translated error and
  keeps the previous selection usable.
- DB failure → 503 `ErrInternal`, same as the main endpoint.
- Empty month (no records) → 200 with zero totals and empty lists; the tables
  render an empty-state row.

## Testing

- **Backend** (`tests/impact_handler_test.go` or a sibling): seed `pet_found`
  events, reports, and users across at least two distinct months; assert the
  monthly endpoint returns the correct per-month totals, the right reunited-pets
  and reports rows for the selected month, and that other months are excluded.
  Cover invalid-month (400) and empty-month (200, zero) cases.
- **Web** (`ImpactPage` test): mock `useMonthlyImpact`; assert the selector
  renders, choosing a month shows the tiles and both tables, and rows link
  correctly. Keep the existing tests green.

## Library Decision

Hand-rolled throughout: native `<select>`, `StatTile` reuse, Tailwind tables.
No shadcn (would introduce a parallel design system for one view) and no
`@tanstack/react-table` (record volumes are small). This is revisited only if a
month's record lists grow enough to need column sorting or server pagination.
