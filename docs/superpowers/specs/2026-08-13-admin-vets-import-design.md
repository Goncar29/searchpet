# Admin-triggered OSM vet import, with a stale-row sweep — design

**Date:** 2026-08-13
**Status:** designed
**Branch:** `feat/admin-vets-import`, off `origin/main` at `ed1b8e3`

## Problem

Two defects share one cause: refreshing the `vets` table is a manual, credentialed operation
that only a human with the production `DATABASE_URL` can perform.

**Refreshing requires the production database password.** `cmd/import-vets` is the only way to
re-sync the table. Running it means holding the production `DATABASE_URL` in hand. On 2026-08-12
it took four attempts to import two vets the user had just added to OpenStreetMap, because no
agent can obtain that credential: `.env` is read-denied, the Render MCP does not expose
environment variables, and `list_postgres_instances` returns empty (the database is Neon, not
Render Postgres). The embeddings backfill solved this exact problem with
`POST /api/admin/reindex-embeddings`; the equivalent for vets was never built.

There is a trap while the endpoint does not exist. `config.Load()` calls `godotenv.Load()`, so
running the command **without** an explicit `DATABASE_URL` imports into the *local* database
with no error and every appearance of success — the same failure shape as rule #41: a success
signal that is also emitted when the intended work did not happen.

**Deleted vets never leave the table.** `Importer.Run` only upserts. When someone deletes a
veterinary clinic from OpenStreetMap, our row survives forever and the map keeps drawing a
business that has closed. This is not hypothetical: OSM went from 182 to 181 between the June
import and 2026-08-12, and that removal is still in our database. It is measurable by counting —
after the 2026-08-12 import there are **72** vets within 5 km of central Montevideo against
**71** in OSM. The extra row is dead.

## Non-goals

- **Community submission of vets.** Users proposing clinics that OSM does not have is a separate
  change (a `submitted/approved/rejected` flow modelled on `shelters`). This design covers only
  the OSM mirror.
- **Scheduled/automatic imports.** The endpoint is operator-triggered. A cron would have to
  reason about Overpass etiquette and Neon compute budget (rule #47); not now.
- **Sources other than OSM.** The sweep is scoped to `source = 'osm'` precisely so a future
  non-OSM source is untouched by it.

## Measurements this design rests on

Taken 2026-08-13, against the live Overpass API with the exact query in `osmimport`:

| Quantity | Value |
|---|---|
| Round-trip time for the Uruguay vet query | **10.9 s** |
| Response size | **46 KB** |
| Elements returned | **183** |

11 seconds is what makes a synchronous endpoint the right shape. If Overpass ever slows to the
point where this is false, the measurement — not a guess — is what should overturn the decision.

## Design

### 1. Soft delete on `domain.Vet`

Add `DeletedAt gorm.DeletedAt` (indexed). GORM then excludes deleted rows from every query built
on the model, which `FindNearby` is (`.Model(&domain.Vet{})`), so the read path needs no change.

**That automatic exclusion gets a test.** An invariant that holds because a library happens to
behave a certain way, asserted only by a comment, is the exact shape of rule #37. The test seeds
a vet, sweeps it, and requires `FindNearby` not to return it.

`Upsert` adds `deleted_at` to its `DoUpdates` column list. A vet that returns to OSM resurrects
itself: the incoming record's `DeletedAt` is the zero value, so `EXCLUDED.deleted_at` is NULL.
No revival code path, and therefore no revival code path to forget.

### 2. Two new repository methods

```go
// SoftDeleteStaleBefore marks every OSM-sourced vet whose last successful sync predates
// cutoff. Returns the number of rows affected.
SoftDeleteStaleBefore(ctx context.Context, cutoff time.Time) (int64, error)

// CountActiveOSM counts the live OSM-sourced rows. It is the denominator of the sanity
// threshold, so it must exclude soft-deleted rows.
CountActiveOSM(ctx context.Context) (int64, error)
```

`SoftDeleteStaleBefore` updates `WHERE source = 'osm' AND deleted_at IS NULL AND
last_synced_at < ?`. The `source` predicate is what keeps a future community-submitted or
manually-curated vet out of the blast radius.

### 3. The sweep, and the two guards it must pass

The cutoff is captured **before the fetch**. Every successful upsert writes `last_synced_at =
now()`, which is necessarily later, so what remains behind the cutoff is what OSM no longer has.

The sweep runs only when **both** hold:

**Guard 1 — sanity threshold.** `upserted >= 0.8 × active_before`. This defends the ugly failure
mode: Overpass answering **200 with a short body**, no error anywhere. A zero-element response
fails it (`0 >= 0.8 × 72` is false) and so does any large unexplained shrink. When
`active_before` is 0 the table is empty and there is nothing to sweep either way.

**Guard 2 — no failed upserts.** This forces a change to `Result`, and the change is the point.
Today `Skipped` conflates two outcomes that must not be conflated:

- an element with no usable coordinates — it was never in the table, so it cannot be swept;
- an upsert that **failed** — that row *is* in the table and its `last_synced_at` stayed old,
  so the sweep would delete a vet that is alive in OSM.

They split into `SkippedNoCoords` and `UpsertFailed`. Only `UpsertFailed > 0` blocks the sweep.
Without the split, a single malformed OSM element would either block the sweep forever or, worse,
let a failed write masquerade as a deletion.

When a guard blocks, nothing is deleted and the response says which one and why —
`sweep_skipped: "below_threshold" | "upsert_failures"`. A skipped sweep is never silent.

### 4. `Result` shape

```go
type Result struct {
    Scanned         int
    Upserted        int
    SkippedNoCoords int
    UpsertFailed    int
    Swept           int
    SweepSkipped    string // "" when the sweep ran
}
```

### 5. HTTP surface

`POST /api/admin/vets/import`, inside the existing `admin` group in `router.go`
(`middleware.Auth` + `middleware.RequireAdmin`). Authorization is an admin JWT, not a shared
secret: this is recurring maintenance rather than the one-off that justified `REINDEX_TOKEN`,
and it needs no new environment variable.

**Synchronous**, on the 11-second measurement. Responds 200 with the `Result` as JSON.

**Overpass client timeout: 60 s** — roughly 5.5× the measured time. `cmd/import-vets` keeps its
own 150 s ceiling; a CLI can afford to wait where a browser request should not.

**Concurrency: an atomic flag, 409 `import_already_running`.** Two concurrent runs would both
upsert harmlessly, but their cutoffs and thresholds would interleave over one another's writes,
which is exactly the state the guards exist to reason about. Serialising is cheaper than
reasoning about it.

Errors use `writeError(c, status, err)` → `{code, message}` (rule #11). Overpass failure is
502 `vet_import_upstream_failed`.

### 6. One code path, two entry points

The import logic stays in `internal/osmimport`. `cmd/import-vets` and the new handler both call
it. Neither reimplements the sweep or the guards.

This is not tidiness. The defect that PR #153 just fixed was one rule (a 5 km radius) written
twice, and fixing it in two places would have reproduced the condition that created it. A sweep
that deletes rows is a much worse thing to have two copies of.

### 7. Web

New `VetsAdminPage` under `AdminLayout`, alongside the six pages already there. A button, a
confirmation, and the run result rendered field by field — including a blocked sweep and its
reason, since that is the outcome the operator most needs to see.

i18n lives in the `admin` namespace across es/en/pt. That namespace is already registered in
`web/src/i18n/index.ts`, so rule #21 is satisfied; adding keys is enough.

## Delivery

Two slices, because the backend and the panel are independently reviewable and the pair is
likely to clear 400 lines:

1. **Backend** — soft delete, the two repository methods, the split `Result`, the guards, the
   handler and route, `cmd/import-vets` rewired, and every test below. Shippable and useful on
   its own: the endpoint is callable with an admin token before any UI exists.
2. **Web** — `VetsAdminPage` and its i18n keys.

If they are chained, slice 2 is merged base-first and **without `--delete-branch`**, retargeting
the child to `main` before deleting anything (rule #49).

## Testing

Repository tests run against real Postgres. A mock has no columns, no `source` predicate and no
rows to sweep, so it cannot fail the way production would (rule #34).

| Test | What it pins |
|---|---|
| Soft-deleted vet vanishes from `FindNearby` | The GORM exclusion this design relies on |
| Upsert of a soft-deleted vet clears `deleted_at` | Resurrection when a vet returns to OSM |
| `SoftDeleteStaleBefore` ignores non-`osm` rows | The blast-radius boundary |
| `SoftDeleteStaleBefore` ignores rows at/after the cutoff | The cutoff boundary |
| Threshold blocks the sweep on a short Overpass response | Guard 1 |
| `UpsertFailed > 0` blocks the sweep | Guard 2 |
| Handler: 403 without admin, 409 while a run is in flight | The HTTP contract |

**Guard 1's test is verified red first.** With the threshold removed, a fake Overpass server
returning two elements against a seeded table must wipe it. A guard whose test passes with the
guard deleted is not a guard — rules #18 and #52 are both about exactly that mistake.

## Risks accepted

- **A synchronous 11-second request.** If Overpass degrades, the operator sees a slow button and
  eventually a 502. The alternative (async job + status polling) buys resilience at the cost of
  run state that would not survive a free-tier restart, and would hide the sweep result behind a
  second request. Revisit if Overpass actually degrades.
- **The 0.8 threshold is a judgement call, not a measurement.** OSM losing more than 20% of
  Uruguay's vets in one step would block the sweep and require a human decision. That is the
  intended behaviour, but the number itself is arbitrary and should be revisited if it ever
  fires on a legitimate run.
- **Soft-deleted rows accumulate forever.** At OSM's rate of change this is a handful of rows per
  year against a table of ~183. No reaper; if it ever matters, the rows carry the timestamp
  needed to write one.
