# Nearby Veterinaries — Design

**Date:** 2026-06-19
**Status:** Approved by user (brainstorming session)

## Problem / Goal

A lost-pets app has a recurring real-world need: someone finds a hurt or stray
animal and needs a veterinary clinic **right now, near them**. The app already
owns the map surface and the geospatial infrastructure (PostGIS `ST_DWithin` /
`ST_Distance`, used by `reports`), but there is no way to discover nearby vets.

Goal: let any user — including unauthenticated visitors who arrived via a shared
link — open the map, reveal veterinary clinics near a location, and act on one
(get directions, call if a phone is known).

This is roadmap item **V2.0 — Veterinarias cercanas**.

## Decisions (user-confirmed)

1. **Data source: OpenStreetMap.** OSM tags veterinary clinics as
   `amenity=veterinary`. A live Overpass query around Montevideo
   (15 km radius) returned **121 clinics, 101 named** — real, recognizable
   coverage for Uruguay. OSM is free (no API key, no billing, no card), and its
   ODbL license **permits storing the data** (attribution required).
2. **Google Places was rejected.** It does the same thing, but: (a) it costs
   money — the post-March-2025 model gives ~5,000 free Nearby/Text Search calls
   per month then bills, and requires a billing account with a card even for the
   free tier; (b) its Terms of Service **prohibit caching/storing** Places
   content (only `place_id` may be persisted), which is incompatible with owning
   a directory. Wrong fit for a $0/month project.
3. **Own the data — import into a PostGIS `vets` table.** Do **not** call
   Overpass live per user request: Overpass is a shared community service that
   explicitly discourages use as a live application backend (rate-limiting /
   blocking risk), adds external latency, and is a single point of failure. We
   import once and serve from our own PostGIS, reusing the existing `reports`
   nearby query pattern. This also lets us enrich/curate data later (fill missing
   phones, flag 24 h emergency vets).
4. **UX: a layer toggle on the existing map** (not a new tab, not contextual-only).
   Reuses `map.tsx` (mobile, react-native-maps) and `MapPage.tsx` (web, Leaflet).
5. **Refresh is manual / on-demand** via an idempotent import command. Vets churn
   slowly; no cron for the MVP. The same command can later be wrapped in a
   scheduled GitHub Action with zero rework.
6. **Upsert-only, never delete.** Re-running the import upserts by OSM identity.
   Vets removed from OSM are left in place (low harm; deleting risks wiping
   manually curated fields). A `last_synced_at` column enables future cleanup if
   ever needed.
7. **Public endpoint, no auth** — like `shelters` and `stats`. A visitor who
   found a pet via a shared link (no account) must be able to find a vet.

## Architecture Overview

```
cmd/import-vets ──(Overpass API, one-off)──▶ vets table (PostGIS)
                                                  │
Map UI ──"buscar en esta zona"──▶ GET /api/vets/nearby ──▶ VetService ──▶ VetRepository (ST_DWithin)
```

Three layers, mirroring existing patterns:
- **Import** is a batch/ETL job → lives in `cmd/`, NOT an HTTP handler (zero API
  attack surface). Reads `DATABASE_URL`, queries Overpass, upserts.
- **Read API** mirrors `reports/nearby`: handler → service → repository, PostGIS
  distance filter + order, `{code, message}` error contract.
- **Frontend** reuses the map screens, shared types, and a React Query hook.

## Data Model

New `domain.Vet` (registered in `pkg/database/postgres.go` AutoMigrate, mirroring
`domain.Shelter` — a plain table; the geography is built on the fly in the query,
so no PostGIS column type is needed):

| Field | Type | Notes |
|-------|------|-------|
| `ID` | uuid PK | `gen_random_uuid()` |
| `OSMType` | varchar | `node` / `way` (part of natural key) |
| `OSMID` | bigint | OSM element id |
| `Name` | varchar | nullable — 20/121 were unnamed; UI falls back to "Veterinaria" |
| `Latitude` | float64 | not null |
| `Longitude` | float64 | not null |
| `Address` | varchar | nullable — composed from `addr:street` + `addr:housenumber` |
| `Phone` | varchar | nullable — only ~27% of OSM entries have it |
| `Website` | varchar | nullable — from `website` / `contact:website` |
| `OpeningHours` | varchar | nullable — raw OSM `opening_hours` (no parsing in MVP) |
| `Source` | varchar | default `'osm'` |
| `LastSyncedAt` | timestamp | set on every upsert |
| `CreatedAt` / `UpdatedAt` | timestamp | GORM auto |

**Natural key:** unique index on (`OSMType`, `OSMID`) — the import upserts on this
pair (node and way ids can collide, so type is part of the key).

## Import Command — `cmd/import-vets`

A small Go binary. Idempotent: first run seeds, later runs refresh — same code.

1. Load config / `DATABASE_URL`, open the same GORM connection as the server.
2. Query Overpass for Uruguay:
   ```
   [out:json][timeout:60];
   area["ISO3166-1"="UY"][admin_level=2]->.uy;
   ( node["amenity"="veterinary"](area.uy);
     way ["amenity"="veterinary"](area.uy);
   );
   out center tags;
   ```
   (`out center` gives ways a representative lat/lng.)
3. Map each element → `domain.Vet`: `name`, lat/lng (node coords or way center),
   compose `Address` from `addr:*`, read `phone`/`contact:phone`, `website`,
   `opening_hours`. Set `Source='osm'`, `LastSyncedAt=now`.
4. **Upsert** by (`OSMType`, `OSMID`) using GORM `clause.OnConflict` (update the
   mutable fields, keep `ID`/`CreatedAt`). Skip elements with no usable coordinates.
5. Log a summary: scanned / inserted / updated / skipped.

Scope: **Uruguay only** for the MVP (default location is Montevideo). Not the world.

Invocation: `go run ./cmd/import-vets` (and/or a `make import-vets` target),
run by the operator against the prod `DATABASE_URL` when a refresh is wanted
(realistically every 3–6 months). HTTP rate-respectful: Overpass is hit a handful
of times per run, not per user request.

## Read API

```
GET /api/vets/nearby?lat={lat}&lng={lng}&radius={meters}     (public, no auth)
```

- Validation: `lat`/`lng` via the existing `validCoordinates` helper
  (`invalid_input` / `invalid_coordinates` otherwise). `radius` optional, default
  5000 m, clamped to a max (e.g. 50000 m) to bound result size.
- Repository (mirrors `report_repository` nearby): filter with
  `ST_DWithin(geography(point), geography(point), radius)`, order by
  `ST_Distance(...)` ASC, `LIMIT` (e.g. 50).
- Response: array of vet DTOs —
  `{ id, name, latitude, longitude, address?, phone?, website?, opening_hours?, distance_meters }`.
- Errors use the standard `writeError(c, status, err)` → `{code, message}`.

Wiring: register the route in the **public** group in `internal/app/router.go`
next to `shelters`. Construct `VetRepository` / `VetService` / `VetHandler` in
`SetupRouter`, following the shelter wiring.

## Frontend UX

**Shared (`frontend/packages/shared/`):**
- `types/index.ts`: add the `Vet` interface.
- `api/client.ts`: add `getNearbyVets(lat, lng, radius)`.
- `hooks/index.ts`: add `useNearbyVets(...)` (React Query, enabled only when a
  search has been triggered).

**Mobile (`app/(tabs)/map.tsx`, react-native-maps):**
- A toggle chip overlaid on the map: "🏥 Veterinarias". Off by default.
- On toggle-on: fetch vets around the current map center / user location.
- When the user pans beyond a threshold, show a **"Buscar en esta zona"** button
  (do NOT refetch on every region change — protects the backend).
- Vet markers use a distinct icon/color from pet-report markers.
- Tap a marker → bottom sheet: name (or "Veterinaria"), distance, address;
  **"Cómo llegar"** (always — `Linking` to a maps directions URL) and
  **"Llamar"** (only if `phone` — `Linking` to `tel:`).
- **Attribution:** "© OpenStreetMap contributors" shown in the vet sheet (mobile
  tiles are Google's, so OSM credit must appear where OSM data is used).

**Web (`pages/MapPage.tsx`, Leaflet):**
- A layer toggle control with the same behavior.
- "Buscar en esta zona" button shown on `moveend` past a threshold.
- Distinct vet marker icon; popup with the same name/distance/address +
  "Cómo llegar" / "Llamar" actions.
- **Attribution:** Leaflet's OSM tile attribution already satisfies ODbL on web.

**Empty / error states (both):** "No hay veterinarias en esta zona" + retry;
network/5xx → friendly error via the existing `getErrorMessage(err, t)` path.
i18n keys added to es/en/pt (`vets:*` namespace), per project rules #11/#12.

## Testing Strategy

- **Backend repository:** a PostGIS nearby test (real Docker PostGIS, like the
  existing report nearby flow test) — seed 3 vets, assert radius filtering and
  distance ordering.
- **Backend handler:** validation paths (bad/missing coords → 400) and the 200
  response shape, using a mock service.
- **Import command:** unit-test the Overpass-JSON → `domain.Vet` mapping and the
  upsert idempotency, injecting a mock HTTP server (mirror the embedding-service
  test pattern). No live Overpass call in CI.
- **Frontend:** `useNearbyVets` hook test (shaping / enable logic) in
  `shared/hooks` (Vitest, run via `vitest.shared.config.ts`); a map-screen smoke
  test mocking the hook (mobile Jest — add the new hook to the screen's mock).

## Out of Scope (YAGNI for this change)

- Cron / scheduled automatic refresh (manual command now; GitHub Action later).
- Contextual entry points (e.g. a "vet cerca" shortcut from a stray/found pet
  detail) — a good phase-2 complement to the map layer, not the MVP.
- Worldwide import (Uruguay only).
- Delete-on-disappear logic (upsert-only + `last_synced_at`).
- Vet reviews / ratings / verification / donation links.
- 24 h emergency filtering and `opening_hours` parsing (raw string stored only).
- Hybrid seed + live-OSM fallback.

## Reused Patterns (no reinvention)

- PostGIS nearby query: `report_repository.go` (`ST_DWithin` / `ST_Distance`).
- Table/repo/service/handler shape and AutoMigrate registration: `shelters`.
- Error contract `{code, message}` + `getErrorMessage`: project rule #11.
- Map screens, markers, React Query hooks, shared types/client.
- Token-free batch job in `cmd/` (new, but the cleanest home for an ETL import).
