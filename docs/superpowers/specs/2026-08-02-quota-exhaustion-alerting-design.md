# Quota exhaustion alerting — design

**Date:** 2026-08-02
**Depends on:** the mail quota shipped in PR #116/#117 (`2026-07-31-email-verification-quota-design.md`)

## Problem

Both mail channels have a per-channel daily reserve: 250 for `email` verification and 50
for `password_reset`, over a rolling 24h window. Exhausting a reserve disables that flow
for every user until the window rolls.

Today nothing reports it. The only signal is a `log.Printf` in `verification_service.go`
and `password_reset_service.go`, on a free-tier host whose logs nobody watches. Two
consequences, and the second is the expensive one:

1. When the platform stops being able to verify emails, the first report comes from a
   confused user, not from the system.
2. **We cannot tell an attack from success.** Registration is open and free, so ~50
   throwaway accounts spending their 5 codes each exhausts the verification reserve
   deliberately. Organic growth exhausts it too. The two look identical after the fact,
   and the response is opposite: one calls for making registration cost something, the
   other for a bigger mail plan.

The prior spec already conceded the measurement gap: *"250 is an estimate, not a
measurement. Nobody has counted how many verification messages a normal day consumes."*

## Scope

**In:** a token-gated status endpoint reporting per-channel consumption and a computed
level; two UptimeRobot keyword monitors, one per level.

**Out:** any change to the caps themselves; an admin bypass for an exhausted reserve;
making registration cost something (captcha, confirm-before-usable). Those are the
"survive it" and "make it expensive" problems. This change only answers "know about it".

Not doing them is a deliberate ordering, not an oversight: a lever you cannot aim is
worth less than a measurement that tells you where to point it.

## Design

### Signal path

The backend computes the level; UptimeRobot only reads it. Thresholds stay in versioned,
tested Go rather than in an external monitor configuration — this project has already
been bitten by build configuration that lived outside the repo and diverged (rule #33).

Two monitors rather than one, because the goal is diagnostic and **the diagnosis is the
interval between them**. Organic growth crosses 80% → 100% over days; an attack crosses
it in minutes. A single monitor reports "not ok" and loses the timestamps that carry the
answer.

Piggybacking on the existing `/health` monitor was rejected. It would fuse two unrelated
questions — *is the service alive?* and *is there quota left?* — into one bit, and a
20-hour warning state would mark the API down for 20 hours, destroying the uptime signal
that monitor exists to produce.

### Endpoint

`GET /api/ops/quota`, registered on the root router alongside
`POST /api/admin/reindex-embeddings` — it is an operations endpoint, not part of any
auth group.

Authorization follows `reindex_handler.go` exactly:

1. If the configured token is empty, return a bare 404 **before reading any header**.
2. If the supplied `X-Ops-Token` does not match, return the same bare 404.

The ordering in step 1 is the whole security property, not a stylistic preference. With
the checks reversed, an unset environment variable would match an empty header and the
endpoint would answer anyone. Rule #18 records this for `REINDEX_TOKEN`; it applies
unchanged here.

404 rather than 401 is also deliberate: 401 confirms the route exists.

Configuration: `OPS_STATUS_TOKEN`. Absent means disabled, and disabled means invisible.

### Level computation

New file `internal/service/ops_quota_service.go`, in package `service`.

The package placement is the design decision. `emailVerificationGlobalDailyMax` and
`passwordResetGlobalDailyMax` are already unexported constants in that package, so a new
file reads them directly. Nothing is exported, nothing is duplicated, and no new coupling
crosses a layer boundary.

The warning threshold is **derived** from the cap, never declared:

```go
func levelFor(used int64, cap int) string {
    switch {
    case used >= int64(cap):
        return "critical"
    case used >= int64(cap)*4/5:
        return "warning"
    default:
        return "ok"
    }
}
```

A separately declared warning constant would drift the first time a cap moves, and the
drift is silent — the threshold would still exist, just no longer mean 80%. That is the
exact failure mode of rule #40, where a cap existed in appearance only. It is also why
rule #43 keeps the four quota constants deriving their window from
`repository.TokenRetention` instead of restating 24h.

Counts come from the existing `CountSince(ctx, nil, channel, since)` — a `nil` userID
counts the whole channel — with `since = now - service.QuotaWindow`. No new repository
method.

### Response

```json
{
  "window_hours": 24,
  "status": "warning",
  "alerts": ["QUOTA_WARN"],
  "channels": [
    { "channel": "email",          "used": 203, "cap": 250, "level": "warning" },
    { "channel": "password_reset", "used": 4,   "cap": 50,  "level": "ok" }
  ]
}
```

`status` is the worst level across channels. `alerts` carries the machine-readable
tokens the monitors match on.

**In `critical`, `alerts` contains both `QUOTA_WARN` and `QUOTA_CRIT`.** Emitting only
the critical token would remove `QUOTA_WARN` from the body, and the warning monitor would
fire a *recovery* notification at the same instant the critical monitor fired a *down*.
Escalation must not read as recovery.

The endpoint returns HTTP 200 when authorized **and both counts succeeded**. Level lives
in the body, not the status code, so the monitors distinguish levels by keyword and a
genuine 5xx still means the service is broken.

### When the count itself fails

If either `CountSince` call returns an error, the endpoint returns **500 with no
`alerts` array** — it must never report `"status": "ok"` on a count it could not perform.

This is the failure shape this project keeps rediscovering: a success signal that is also
emitted when the check never ran. It produced the `varchar(10)` no-op (rule #34), the
`curl` without `--fail` (rule #41), and the `/health` that answers 200 from a stale binary
(rule #46). An endpoint that reports `ok` when the database refused to count is the same
bug wearing a fourth costume.

That leaves one gap the two keyword monitors do not close by themselves: **a 500 makes
both keywords absent, and an `ALERT_EXISTS` monitor does not fire on an absent keyword.**
The alerting would go quiet exactly when it is broken.

Two facts decide how this is handled, and the first must be verified during
implementation rather than assumed:

1. UptimeRobot keyword monitors are expected to mark a monitor DOWN when the HTTP request
   itself fails, independent of the keyword condition. If that holds, the 500 alerts
   through the monitors already specified and nothing more is needed.
2. If it does not hold, add a third monitor over the same URL of type HTTP (not KEYWORD),
   which alerts on any non-2xx.

Do not assume (1). Confirm it by pointing a throwaway monitor at a URL that returns 500
before relying on it.

### Monitors

Both KEYWORD type, `ALERT_EXISTS`, 300s interval, `X-Ops-Token` supplied through
`customHttpHeaders` (verified supported), reusing the alert contacts already proven by
the existing `searchpet.onrender.com/health` monitor.

| Friendly name | Keyword |
|---|---|
| `SearchPet — cuota de mail al 80%` | `QUOTA_WARN` |
| `SearchPet — cuota de mail agotada` | `QUOTA_CRIT` |

## Testing

Three tests, each written failing first.

1. **Level boundaries** — a table covering 199/200 and 249/250 for `email`, 39/40 and
   49/50 for `password_reset`. Boundaries are where off-by-one lives, and `cap*4/5` is
   integer division: 250 → 200 and 50 → 40 both land exactly, which the table pins.
2. **The empty-token guard** — with no configured token and an empty `X-Ops-Token`
   header, the response is 404. This asserts the *ordering* of the two checks; reversing
   them still passes every other test.
3. **An end-to-end test against real Postgres** that seeds token rows and asserts the
   endpoint counts them. Repository mocks have no constraints and no sweeper, and this
   quota has already shipped broken twice for exactly that reason (rules #34 and #40).
4. **A failing count returns 500 and no `alerts`** — a repository stub that errors must
   not produce a body containing `"status": "ok"`. Without this test, the most dangerous
   state of the feature is the one nothing exercises.

## Open risks

- **The endpoint publishes how much quota remains, which is the scoreboard an attacker
  wants.** It tells them whether they have already won and how much further to go. This
  is why it is token-gated and why every unauthorized path ends in a silent 404. The
  residual risk is a leaked `OPS_STATUS_TOKEN`, whose blast radius is disclosure of two
  integers — no write path, no user data.
- **Knowing is not surviving.** When the critical alert fires, the reserve is already
  gone and there is no lever: no admin bypass, and raising a cap requires a deploy. This
  change deliberately buys the measurement first, on the argument that the right lever is
  unknowable without it.
- **A 300s poll can miss a fast attack's warning stage.** ~50 accounts spending 5 codes
  each could cross 80% → 100% inside one interval, collapsing the diagnostic gap the two
  monitors exist to produce. The interval is not lowered because a missed warning still
  leaves the critical alert correct, and the free tier's shorter intervals are better
  spent on liveness.
- **`QUOTA_WARN` fires at 80% of a cap that is itself an estimate.** If 250 turns out to
  be wrong, the warning is wrong by the same factor. The endpoint's `used` value is the
  measurement that will eventually correct it — which is the point of building this
  before touching the caps.
