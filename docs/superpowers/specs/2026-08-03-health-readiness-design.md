# Liveness and readiness — design

**Date:** 2026-08-03
**Depends on:** the monitors shipped in PR #121 (`2026-08-02-quota-exhaustion-alerting-design.md`)

## Problem

`GET /health` is an inline closure in `router.go` that returns `{"status": "ok"}` without
touching anything:

```go
router.GET("/health", func(c *gin.Context) {
    c.JSON(200, gin.H{"status": "ok"})
})
```

The only production monitor points at it. So if Neon goes down, the API starts failing
every request that needs data and the monitor keeps reporting UP. **Nobody finds out.**

This was observed on 2026-08-02 while running the real binary with the Postgres container
stopped: `/api/ops/quota` correctly returned 500 and `/health` kept answering
`{"status":"ok"}` with HTTP 200.

It is the failure shape this project keeps rediscovering — a success signal that is also
emitted when the check never ran. It produced the `varchar(10)` no-op (rule #34), the
`curl` without `--fail` and the `grep -c` misread (rule #41), and the `/health` that
answers 200 from a stale binary (rule #46). This is the same bug in the position where it
costs the most: the thing whose entire job is to notice outages.

## Scope

**In:** a new `GET /health/ready` that reports whether the database answers; one new
UptimeRobot HTTP monitor pointed at it.

**Out:** changing `/health`; checking PostGIS/pgvector; checking Cloudinary, Brevo or
Jina; setting Render's `healthCheckPath`; any automatic remediation.

## Design

### Two endpoints, two questions

| Route | Question | Touches the database |
|---|---|---|
| `/health` | is the process answering? | **no — and that is the point** |
| `/health/ready` | does the database answer? | yes, `SELECT 1` |

`/health` is not modified. Its value is that it is dumb.

The tempting fix — make `/health` query the database — is wrong for a reason worth
stating precisely, because the reason recorded in CLAUDE.md was itself wrong.

That note said a Neon blip would make Render mark the service down and restart it,
worsening the outage. **That cannot happen today: the service has `healthCheckPath: ""`**
(verified through the Render API on 2026-08-03). Render does not poll `/health` at all.
The only consumer is UptimeRobot.

The real reason is diagnostic. Fusing both questions into one bit destroys the
distinction between *the process died* and *the database is unreachable* — two failures
with different responses, arriving as the same alert. It is the same argument the quota
design used to reject a single monitor: the diagnosis lives in the difference between two
signals, not in either one alone.

Keeping `/health` free of dependencies also keeps it correct as a liveness probe if
`healthCheckPath` is ever set. A liveness probe that fails on a dependency outage causes
restart loops during someone else's incident.

### Endpoint

`GET /health/ready`, registered next to `/health` on the root router. **Public** — no
token.

Gating it was considered and rejected on proportion. It would protect a `SELECT 1`, the
cheapest query in the codebase, while `GET /api/pets/search`, `GET /api/shelters` and
`GET /api/pets/:id` sit open and un-rate-limited running real PostGIS work.

There is also a positive reason, not just an absence of risk. `/api/ops/quota` is gated
because it *publishes information* — how much quota remains, which is the scoreboard an
attacker wants. A readiness endpoint publishes nothing that is not already inferable in
one request against any endpoint that uses the database. There is no secret to protect.

### Response

| Condition | Status | Body |
|---|---|---|
| the database answered | 200 | `{"status": "ready"}` |
| it did not | 503 | `{"code": "not_ready", "message": "database unreachable"}` |

The driver error goes **to the log only, never to the body.** Postgres connection errors
routinely carry host, port, user and database name. Putting them in a public response
means the endpoint discloses infrastructure topology precisely when things are worst.
The full error is logged, which is where it will actually be read.

The 503 body follows the `{code, message}` contract this API holds everywhere (rule #11).

### The check

`SELECT 1` through GORM with a **2 second context timeout**.

Two decisions inside that sentence:

**`SELECT 1`, not `db.Ping()`.** Ping can report success against a connection already in
the pool without the server on the other end answering anything — a success signal also
emitted when the check did not run. That is the exact family of bug this endpoint exists
to close, and reintroducing it here would be self-defeating.

**A timeout, not an open wait.** A hung database does not refuse connections; it accepts
them and never answers. Without a deadline the request stays open until the monitor gives
up at 30s, holding a goroutine per poll. A hung database must fail fast, not fail late.

### Placement

New file `internal/handler/health_handler.go`. The handler depends on a small interface,
not on `*gorm.DB`:

```go
type ReadinessChecker interface {
    Check(ctx context.Context) error
}
```

This keeps the handler testable with a stub and respects the intent of the layering
without inventing a repository for a query that returns no domain object. The concrete
implementation wraps the `*gorm.DB` already built in `SetupRouter`.

## Testing

1. **Handler, stubbed.** A checker returning an error yields 503 with `not_ready`; a
   checker returning nil yields 200 with `ready`.
2. **Readiness against real Postgres.** Close the underlying `sql.DB` pool, then call the
   endpoint and assert 503. This exercises the failure path against a real driver rather
   than a simulation of one.
3. **`/health` stays dumb.** With the pool closed, `/health` must still return 200.

Tests 2 and 3 share one closed pool and must run in the same test function, in that
order. Closing the pool is destructive to every later user of that `*gorm.DB`, so this
must not be done against the shared test database handle other tests depend on: open a
dedicated connection for this test and close that one. A test that poisons the shared
handle fails somewhere else, and the failure will not name this file.

Test 3 is the one that matters most. It is this design compiled into an executable
assertion: it is the only thing standing between the diagnostic split and a future
well-intentioned change that "fixes" `/health` by making it query the database. Without
it, the entire value of this work can be silently deleted by someone trying to help.

## Monitor

One new UptimeRobot monitor, type **HTTP** (not KEYWORD), against
`https://searchpet.onrender.com/health/ready`, 300s interval, reusing alert contact
`8348190`.

No keyword and no custom header are needed: PR #121 established empirically that any
non-2xx marks a monitor DOWN, with the incident naming the status as the cause. A plain
HTTP monitor over a 503 is sufficient, which also means this monitor can be created
through the UptimeRobot MCP server — the `customHttpHeaders` limitation that forced the
raw v3 API for the quota monitors does not apply here.

The two monitors are read together:

| `/health` | `/health/ready` | Meaning |
|---|---|---|
| DOWN | — | the process died |
| UP | DOWN | the process is alive, the database is not answering |
| UP | UP | healthy |

## Open risks

- **A 300s poll means up to five minutes of unnoticed database outage.** 300s is the
  floor on the current UptimeRobot plan — `interval: 60` is rejected outright — so this
  is a constraint, not a choice.
- **Readiness reports reachability, not correctness.** A database that answers `SELECT 1`
  while returning wrong data, or one missing a migration, reports ready. Checking
  extensions was deliberately excluded: that is a startup-time failure, and the backend
  already runs migrations at boot and fails loudly. Paying for that check on every poll
  forever buys nothing after the first success.
- **Nothing is remediated.** As with the quota alerting, this change buys the
  measurement. When the alert fires, the response is still manual.
