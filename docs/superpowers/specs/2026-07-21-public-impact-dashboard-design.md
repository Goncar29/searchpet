# Public Impact Dashboard — Design Spec

- **Date:** 2026-07-21
- **Status:** Approved (design)
- **Roadmap item:** V2.1 — "Analytics dashboard público"
- **Scope note:** This is the **public** dashboard only. The admin/operational analytics
  panel is a **separate project** (own spec → plan → implementation cycle) to keep the
  public aggregate endpoint isolated from any sensitive admin data. Do NOT build the admin
  side here.

## Goal

A public transparency page (`/impacto`) that shows SearchPet's social impact using
aggregate data only. Aligns with the mission: a free, no-monetization cause with nothing
hidden. Everything on the page is intentionally public — zero sensitive data, low
exposure risk.

## Non-goals

- No admin/operational metrics (separate project).
- No per-city breakdown (the `platform_events` ledger has no city dimension; adding it is
  an ingestion change, out of scope for v1).
- No mobile screen in v1 (web-only — a shareable public URL is the natural surface).

## Metrics (v1)

Six metrics, all derivable from data that already exists (no new event instrumentation):

1. **Mascotas reunidas** — total (`platform_events` count of `pet_found`).
2. **Búsquedas iniciadas** — total (`platform_events` count of `search_started`).
3. **Comunidad** — total users + total registered pets (snapshot counts).
4. **Reuniones por mes** — monthly line chart from `platform_events.created_at`.
   **The centerpiece.**
5. **Tasa de reunión (%)** — derived ratio `pets_reunited / searches_started`.
6. **Búsquedas activas ahora** — snapshot count of pets with status `lost` or `stray`.

Time granularity: **monthly** (clean impact trend, low noise).

**Time window:** the `totals` block is **all-time / lifetime** (the ledger never decreases).
The `reunions_by_month` chart is the **trailing 12 months** (gap-filled). These are
independent: a total counts every event ever; the chart shows the recent trend.

## Backend

### Endpoint

```
GET /api/stats/impact        (public, no auth)
```

New dedicated endpoint. The existing `GET /api/stats` is **left untouched** (HomePage
consumes it; coupling them is avoided on purpose).

### Response shape

```json
{
  "totals": {
    "pets_reunited":     1247,
    "searches_started":  3891,
    "total_users":       5402,
    "total_pets":        6130,
    "active_searches":   214,
    "reunion_rate":      0.32
  },
  "reunions_by_month": [
    { "month": "2026-01", "count": 45 },
    { "month": "2026-02", "count": 62 }
  ]
}
```

### Data sources (ledger immutability respected)

| Field | Source | Query |
|---|---|---|
| `pets_reunited`, `searches_started` | `platform_events` (append-only ledger) | `COUNT` by `event_type` |
| `reunions_by_month` | `platform_events` | `COUNT ... GROUP BY date_trunc('month', created_at)` over `pet_found` |
| `total_users`, `total_pets` | snapshot | `COUNT` |
| `active_searches` | snapshot | `COUNT pets WHERE status IN ('lost','stray')` |
| `reunion_rate` | derived (Go) | `pets_reunited / searches_started`; guard divide-by-zero → `0` |

### Decisions taken with judgment

1. **In-memory cache (~5 min TTL).** Public endpoint may receive many hits; on Render free
   tier we avoid hitting the DB per request. Impact numbers do not change per second, so
   5 min staleness is invisible. Implementation: `sync.RWMutex` + timestamp, no Redis.
2. **Follows the existing `StatsHandler` pattern** (takes `*gorm.DB`, same style). No new
   architecture.

### Month gap-fill

`GROUP BY` omits months with zero reunions. The backend fills gaps with `count: 0` so the
line is continuous. Window: last 12 months back. Done in Go, not SQL.

## Frontend (web-only)

Follows existing patterns.

| Piece | Location | Responsibility |
|---|---|---|
| Public route `/impacto` | `web/src/App.tsx` (React Router) | No auth guard |
| `ImpactPage.tsx` | `web/src/pages/` | Page: stat tiles + charts + loading/error states |
| `<ImpactLineChart>` | `web/src/components/` | Hand-rolled SVG component (~40 lines, zero deps) |
| `getImpactStats()` | `shared/api/client.ts` | Method on the singleton client |
| `useImpactStats()` | `shared/hooks/index.ts` | React Query hook |
| `ImpactStats` type | `shared/types/index.ts` | Response typing |

### Charting

**Hand-rolled SVG, zero dependencies.** No chart library is installed and one is not added:
the page is one line chart + a few bar/tile elements. Rationale: zero bundle, zero
supply-chain surface (consistent with the project's pnpm-hardening discipline), CSP-safe
without touching `vercel.json`.

### States

- Loading → skeleton.
- Error → `getErrorMessage(err, t)` (rule #11). Never raw error text to the user.

### i18n (GOTCHA — rule #21)

New web-only namespace `impact` in `es/en/pt`. It **MUST be registered explicitly in
`web/src/i18n/index.ts`** (all three language blocks), not just added to the locale JSONs.
If it lives in the JSONs but not the config, `useTranslation('impact')` returns the raw
keys on screen (this is the exact `vets` → `toggle`/`hide` bug from PR #58/#70). Called out
here so it is not repeated.

### Navigation

- Footer link in `MainLayout.tsx`.
- Soft CTA on `HomePage` ("Ver nuestro impacto →") near the existing stats section.

## Testing

- **Backend:** `httptest` for `/api/stats/impact` — asserts the counters, monthly bucketing,
  and zero gap-fill.
- **Web:** Vitest for `useImpactStats`; smoke test for `ImpactPage` (mocks `useImpactStats`).
- **E2E (optional):** Playwright opening `/impacto` and asserting it renders without login.

## Out of scope / follow-ups

- Admin/operational analytics dashboard (separate project).
- Per-city impact (requires adding a city dimension to `platform_events`).
- Mobile impact screen (port, if ever desired).
