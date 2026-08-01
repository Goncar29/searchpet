# Email verification: drop SMS, add a daily quota — design

**Date:** 2026-07-31
**Status:** approved, not implemented
**Closes:** the second open risk of `2026-07-31-password-reset-daily-quota-design.md` — "the
`250 of 300` justification is not enforced anywhere".

## Problem

The password-reset daily quota reserves 50 of Brevo's 300 daily messages and its spec claims
this "leaves 250 for verification". **Nothing enforces that.** `VerificationService.SendOTP`
has no daily cap at all; its only brake is the same 60-second per-token cooldown that the
reset work already demonstrated to be insufficient.

Registration is open and `Register` sends no mail, so consuming the quota takes three steps —
register, log in, call `/verification/send-email` — but none of them is bounded per day. An
attacker who registers accounts and loops that endpoint still drains the shared 300/day, and
draining it takes **password recovery down with it**. The reset caps we just shipped can be
bypassed entirely through the channel next door.

A second, unrelated exposure surfaced while measuring this: `/api/verification/send-sms` has
**no route rate limit at all** (`send-email` has 5/min) and every message it sends costs
money through Twilio.

## Scope

**In:** removal of the SMS verification flow, end to end; a per-account and a channel-wide
daily cap for email verification; honest `429` responses and a real countdown in the UI;
repair of the legacy error shape on the existing cooldown response.

**Out:** removing the `users.phone_verified` column; changing the reset caps; moving off
Brevo; the per-route rate-limit middleware, which stays as it is.

## Part A — Remove the SMS verification flow

SMS was already retired from the roadmap on 2026-07-29 for violating rule #1 (the project
costs $0/month), but the OTP path was explicitly kept. That exception ends here: the flow is
not necessary, it is the only paid dependency in the product, and its endpoint is the least
protected one in the API.

**Removed:** routes `POST /api/verification/send-sms` and `/confirm-sms`; the corresponding
handler and service methods; `pkg/sms` and the `TWILIO_*` configuration; `mobile/app/verify-phone.tsx`;
the SMS section of the profile screen on **both** mobile and web; the `useSendSmsOTP` /
`useConfirmSmsOTP` hooks and their client methods in `shared`; the SMS keys across the six
locale files.

**Kept:** `users.phone_verified`. Existing users hold `true` there and `IsVerified` reads it
(`verification_service.go:207`). Dropping the column would touch live data for no benefit;
the invariant simply stops having a way to become true from now on.

**Why the backend goes too, not just the screens.** Removing the UI while leaving the
endpoint alive is the worst of both worlds: it stays authenticated, still has no rate limit,
and still spends real money per message — only now nothing in the product exercises it, so
nobody would notice it being abused.

## Part B — Daily quota for email verification

### Disjoint budgets that sum to the plan

| Channel | Global / 24 h | Per account / 24 h |
|---|---|---|
| `email` (verification) | **250** | **5** |
| `password_reset` | 50 (already shipped) | 3 (already shipped) |
| **Total** | **300 = the Brevo plan** | |

Neither channel can starve the other, and together they cannot exceed what Brevo will
accept. Five per account rather than the reset's three because this is onboarding: the user
is actively waiting, and friction here costs a signup.

**The cap does not create an outage — it makes an inevitable one visible.** Today, at 300
messages Brevo simply starts rejecting, and the failure is nearly mute. With the cap we fail
early, deliberately, with a log that says which budget ran out.

### This channel tells the truth

`/verification/send-email` sits behind `protected`, so the caller is already authenticated:
there is no account-existence secret to defend and therefore no reason for the opacity that
`/forgot` requires. The endpoint already returns `429` with `Retry-After` for the cooldown.

The caps follow that precedent: a real `429` and a **distinct code per limit**, so the client
can say something true rather than "too many requests".

| Situation | Status | `code` | Extra |
|---|---|---|---|
| 60-second cooldown | 429 | `otp_cooldown` | `Retry-After` header, seconds |
| Per-account daily cap | 429 | `otp_daily_limit` | `Retry-After` header, seconds until the oldest of the five leaves the window |
| Channel reserve exhausted | 429 | `otp_channel_unavailable` | no `Retry-After` — it depends on other users, so any number would be a guess |

The three are deliberately separate: "wait a minute", "you are done for today" and "the
platform is out of budget" are different situations for the user and different signals for
us. Collapsing them would be the same mistake as the generic message we are fixing below.

**This is the counter the reset flow could not have** — the difference is authentication,
not policy.

### Repairing the error contract on the way through

`verification_handler.go:156` answers the cooldown with
`gin.H{"error": "rate limit excedido", "retry_after": N}`. That breaks rule #11: the other
thirteen errors in the same file use `writeError` → `{code, message}`, and the frontend's
`getErrorMessage` looks up `errors:{code}`. Today that 429 renders as a generic failure
instead of a real message. The new caps must not copy the broken shape, so the existing one
is corrected in the same change, preserving the `Retry-After` header.

### Reuse, not new machinery

`CountSince`, `repository.TokenRetention` and the 24-hour window already exist and are
already exercised against real Postgres. No new table, no new index — the
`(channel, created_at)` index from migration `000022` serves these queries unchanged.

## Testing

- Per-account cap blocks the sixth request in the window; a different account is unaffected.
- The channel reserve blocks even an account under its own cap.
- **The sweeper test extends to the `email` channel.** Rule #40: this table has an hourly
  hard-delete reaper, so any query counting history over a window must be tested with the
  reaper running. The existing guard covers `password_reset` only.
- The cooldown `429` carries `{code, message}` **and** the `Retry-After` header.
- After Part A, no route, handler, service method, hook, client method or locale key
  references SMS verification; `IsVerified` still honours a pre-existing `phone_verified`.

## Delivery

Two pull requests. **A first, B on top.**

Part A is almost entirely deletion across many files; Part B is a small amount of new logic.
Merged into one diff, the deletions bury the code that actually needs review. A also
simplifies B: with one channel gone, the budget has fewer moving parts to reason about.

## Open risks

- **250 is an estimate, not a measurement.** Nobody has counted how many verification
  messages a normal day consumes. If real signups ever approach it, the answer is a larger
  mail plan, not a larger cap — the ceiling is Brevo's, and this only rations it.
- **Hitting the channel reserve blocks new signups from verifying** for the rest of the
  window. Accepted for the reason above: without the cap the same thing happens anyway, as
  an opaque provider error rather than a deliberate, logged decision.
- **`users.phone_verified` becomes write-once history.** No flow can set it after this
  change, but existing `true` values keep counting toward `IsVerified`. That is intentional;
  removing them would silently un-verify real users.
