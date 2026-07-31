# Password reset: daily quota — design

**Date:** 2026-07-31
**Status:** approved, not implemented
**Supersedes:** the first bullet of "Open risks" in `2026-07-29-password-recovery-design.md`

## Problem

`POST /api/auth/password/forgot` has exactly one per-account bound today: the 60-second
cooldown in `RequestReset`. That allows **1440 messages per day against a single address**,
every one of them passing all validation.

The route rate limit does not help. `middleware/rate_limit.go` builds its key as
`"ratelimit:" + c.FullPath() + ":" + c.ClientIP()`, so it bounds a *source*, never an
*account*: a distributed caller sidesteps it entirely, and even a single IP at one request
per minute stays under the 5/min limit.

The damage is not primarily the mailbombing. Brevo free is **300 messages/day, shared with
the email-verification OTP** (rule #24). At 1440/day the shared quota is gone in roughly
five hours, and from that moment **no user on the platform can verify their email**. The
blast radius is the whole product, not the target.

It also breaks **silently**: `RequestReset` swallows mailer errors so it cannot leak whether
an account exists, so every user keeps reading "we sent you a code" while nothing is sent.
Same signature as the `varchar(10)` bug (rule #34).

## Scope

**In:** a per-account daily cap and a global daily reserve for the `password_reset` channel;
the counting query and its index; a static policy line and a local resend countdown on web
and mobile; logging that makes reserve exhaustion visible.

**Out:** changing the rate-limit middleware's keying; moving off Brevo; raising the Brevo
plan; any change to `/reset`; making the limits configurable by environment variable (see
Deliberate exclusions).

## Decisions

Three decisions were taken during design and each one closed a fork:

1. **The UI reports policy, never account state.** A real "you have 2 of 3 left" counter is
   computable only for an account that exists, so rendering it would turn `/forgot` into an
   account-existence oracle — the precise property the endpoint is built to deny. The screen
   therefore shows a fixed sentence, identical for a registered address and an invented one.
2. **Two layers, not one.** A per-account cap alone lowers the attack from one address to
   roughly seventeen registered addresses; it does not protect the shared quota. The global
   reserve is what guarantees email verification never falls over because of resets.
3. **The count lives in Postgres, not in the rate-limit store.** Verified 2026-07-31: the
   Render account has **no Key Value instance**, so production runs the `InMemoryStore`, on a
   free-plan service that sleeps on inactivity. A daily counter in memory resets on every
   restart, which makes it worthless as a daily bound. `verification_tokens` already stores
   one row per request with a `created_at`, so the count is a query over data that exists —
   no new table, no new write.

## Limits

| Limit | Value | Window |
|---|---|---|
| Per account | **3** `password_reset` tokens | rolling 24 h |
| Global, `password_reset` channel | **50** tokens | rolling 24 h |

Three covers the real case comfortably: request, nothing arrives, check spam, request again.
Fifty leaves **250 of the 300** daily messages for email verification, which is the primary
consumer because it runs on every signup. An attacker would need about seventeen distinct
registered addresses to exhaust the reset reserve, and doing so would still not touch
verification.

Both live as constants beside `otpRateLimit` and `otpTTL` in the service package.

## Architecture

### Where the checks go

Inside `RequestReset`, **after** `GetByEmail` — so only real accounts are ever counted —
and alongside the existing 60-second cooldown check. Both new checks `return nil` on
rejection, exactly like the cooldown, because every observable outcome of this endpoint must
be identical.

Both run **before** the token is minted, or the row being created would inflate its own
count.

Order: per-account first, then global. The per-account rejection is routine and the global
one is an incident; checking the cheap, common case first keeps the incident log meaningful.

### The counting query

One new method on `VerificationTokenRepository`:

```go
// CountSince counts tokens created in the window. A nil userID counts the whole channel.
CountSince(ctx context.Context, userID *uuid.UUID, channel string, since time.Time) (int64, error)
```

One shape, two uses. `nil` gives the global count.

### The cap counts attempts, not deliveries

A token row is created before the mail is sent, and the send is detached. When the send
fails, `runAsync` calls `MarkUsed(tokenID)` to free the 60-second cooldown so the user can
retry immediately — but the row still exists, and it still counts.

That is intentional, for two reasons. First, the two states are indistinguishable after the
fact: `used = true` means either "redeemed" or "send failed", and adding a column to tell
them apart would be schema churn in service of a rare path. Second, counting attempts is the
conservative direction for a bound whose job is protecting a quota.

The cost is a genuine edge case: a user hitting three consecutive provider failures is
capped for the day having received nothing. It is bounded (they can retry tomorrow), it is
visible (the global-reserve and mailer logs will both be loud), and it only occurs while
mail delivery is already broken — at which point the cap is not what is wrong. Recorded in
Open risks rather than engineered around.

### The trap: the count must ignore `used`

`MarkAllUsedByUserExcept` marks a user's previous codes as used every time a new one is
minted. If `CountSince` filtered on `used = false`, **requesting a new code would reset the
cap** and the limit would not exist. The count keys on `created_at` alone.

This is the single most important line in the implementation and it needs a test that fails
when the filter is added back.

### Failure of the count itself

If `CountSince` returns an error, `RequestReset` logs and **returns nil without minting or
sending** — fail closed. Consistent with every other post-lookup failure in this method,
which cannot surface an error without leaking that the account exists.

## Data model

No schema change beyond one index:

```sql
CREATE INDEX IF NOT EXISTS idx_verification_tokens_channel_created_at
    ON verification_tokens (channel, created_at);
```

Both queries use it, and no existing index serves them — the current ones are on `user_id`,
`used` and `expires_at`. The migration follows rule #35: wrapped in
`DO $$ ... IF EXISTS (information_schema.tables) ... $$`, because `RunMigrations` executes
before `RunAutoMigrate` and the table may not exist yet on a fresh database.

## HTTP contract

**Unchanged, and that is the point.** `POST /api/auth/password/forgot` keeps returning
`200` with the same fixed body in every case: unknown address, banned user, cooldown,
per-account cap, global reserve, mailer failure. A new status or error code for the caps
would be an oracle.

The user-visible consequence is real and accepted: on hitting a cap, the screen says a code
was sent and none arrives. The static policy line is what lets the user make sense of it.

## Frontend

Applies to `web/src/pages/ForgotPasswordPage.tsx` and
`mobile/app/forgot-password.tsx`.

**Static policy line, email step, shown to everyone identically:**
"You can request up to 3 codes per day. Wait a minute between attempts." New i18n keys in
es/en/pt under the existing `forgotPassword` namespace.

**Local resend countdown.** After a submit, the resend control is disabled and counts down
from 60 seconds. On web the deadline goes in **`sessionStorage`**, not `localStorage`:

- One key holding a timestamp, about 13 bytes against a 5–10 MB per-origin budget, and it is
  overwritten rather than appended — size is not a concern.
- The reason is lifetime, not size. `localStorage` never expires, so a key written during a
  once-in-a-lifetime password reset would persist forever. `sessionStorage` is dropped by the
  browser when the tab closes, which is the correct lifetime for a 60-second countdown and
  needs no cleanup code of our own.
- It survives a reload, which is the case that matters: a user who reloads and immediately
  resends otherwise hits the server cooldown and gets a silent 200 with no email.

On mobile the question does not arise — React Native has no `localStorage`, so the deadline
is component state and dies with the screen.

**Deliberately not built: a local "2 of 3 used today" counter.** It would be wrong for anyone
who requests from a phone and then a laptop, and a counter that lies is worse than no
counter. The fixed policy line carries the same information honestly.

## Observability

This feature has been bitten twice by silent failure, so the reserve is not allowed to be
quiet.

- **Per-account cap reached** — routine. One log line, user id, no code, no email address.
- **Global reserve reached** — an incident, and almost certainly an attack. A distinct,
  greppable log line saying the reset channel is exhausted for the day. Without this we
  reproduce the `varchar(10)` failure exactly: a broken flow that nobody can see.

Neither line may contain the OTP. Existing rule from the parent spec.

## Testing

Service level, with mocks:

- The per-account cap blocks the fourth request in the window: no token minted, no mail, and
  `nil` returned.
- A different user in the same window is unaffected.
- The global reserve blocks once the channel total is reached, even for a user under their
  own cap.
- **Retiring old codes does not reset the cap.** The regression guard for the `used` trap.
- A `CountSince` error fails closed: no mint, no mail, `nil` returned.

End-to-end, against real Postgres (`-tags e2e`):

- The counting query itself. A wrong `WHERE` clause passes every mock-based test in the
  suite — mocks have no columns and no `created_at` semantics. This is rule #34 applied to a
  query instead of a column.

## Deliberate exclusions

- **Environment-configurable limits.** Considered and dropped. Two constants that need a
  deploy to change are honest; an env var invites tuning the number instead of understanding
  the quota. If reality disagrees with the estimate, that is a code change with a commit
  message explaining why.
- **Per-IP or per-subnet accounting for resets.** The middleware already does source-based
  limiting and it is the wrong axis for this problem.
- **Telling the user how many attempts remain.** See Decisions, point 1.

## Open risks

- **An attacker with many known registered addresses can still exhaust the reset reserve.**
  Seventeen addresses at three each reaches fifty. The reserve then denies password recovery
  to everyone for the rest of the day, while leaving email verification intact. This is a
  deliberate trade: a bounded outage of one flow instead of an unbounded one across the
  platform. Reassess if it ever happens.
- **Three consecutive provider failures cap a user who received nothing.** Follows from
  counting attempts rather than deliveries; see that section for why the alternative is
  worse. Bounded to 24 hours, and only reachable while mail is already broken.
- **The 300/day Brevo ceiling is the real constraint** and this design only rations it. If
  SearchPet grows past a few hundred signups a day, the answer is a different mail plan or
  provider, not smaller caps.
