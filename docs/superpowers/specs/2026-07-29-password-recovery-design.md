# Password recovery — design

**Date:** 2026-07-29
**Status:** approved, ready for implementation planning
**Depends on:** email OTP verification (Brevo mailer, `verification_tokens`); Google Sign-In web (PR #108, `ee8b295`) and mobile (PR #111, `dcf288f`)

## Problem

There is no password recovery in the backend. A user who forgets their password has no way
back into the account through email and password.

Google Sign-In widened this gap without meaning to. When `LoginWithGoogle` links a Google
identity to an existing account whose `EmailVerified` is `false`, it **deliberately discards
the stored `PasswordHash`** — that account could have been planted by an attacker using the
victim's address, because `Register` demands no proof of the email. The defence is correct
(see rule #25), but it leaves the legitimate owner as a Google-only user permanently, with no
door back.

Every piece needed to close this already exists: the `verification_tokens` table, the Brevo
mailer, and the OTP generation, hashing, rate-limiting and attempt-capping logic. This is new
plumbing over existing parts, not new architecture.

## Scope

**In scope:** backend endpoints and service, JWT session invalidation, and the user-facing
flow on both web and mobile.

**Out of scope, and deliberately so:**

- **SMS as a recovery channel.** Email is the only channel. See "Deliberate exclusions".
- **Marking the email verified as a side effect of a reset.** See "Deliberate exclusions".
- **Auto-login after a successful reset.** The user logs in with the new password.
- **Password strength policy.** The reset endpoint enforces the same `min=6` as `Register`.
  Making recovery stricter than signup would be incoherent; changing both is separate work.
- **Localising backend emails.** The existing OTP email is Spanish-only; the reset email
  matches it. Backend email i18n is its own change.

## What already exists and is reused as-is

| Piece | Location | Reused for |
|---|---|---|
| `verification_tokens` table | `domain.VerificationToken` | Reset tokens, under a new `channel` value |
| `generateOTPCode` / `hashOTPCode` | `internal/service/verification_service.go` | Same package, called directly — no duplication |
| `FindActiveByUser` / `MarkUsed` / `IncrementAttempts` | `internal/repository/verification_token_repository.go` | Unchanged. Verified: orders `created_at DESC`, so the newest code always wins, and `channel` is in the `WHERE`, so a verification token can never be spent on a reset or vice versa |
| Brevo transport | `pkg/mailer/mailer.go` | Gains one method; transport, noop degradation and error logging unchanged |
| `runAsync` pattern | `internal/service/auth_service.go` | Fire-and-forget send, inline in tests for determinism |
| IP rate limiting | `internal/middleware` | Applied to both new routes |
| `writeError` / `getErrorMessage` | backend + `shared/utils/apiErrors.ts` | All error responses (rule #11) |

## Architecture

### Where the logic lives: a new `PasswordResetService`

Not in `VerificationService`: that service verifies the identity of an **already
authenticated** user and its `ConfirmOTP` sets `EmailVerified` / `PhoneVerified` as a side
effect. Password reset is anonymous and mutates credentials — different purpose, different
side effects.

Not in `AuthService` either: it is already carrying registration, login, Google, profile,
location, photo and preferences.

New file `internal/service/password_reset_service.go`, new interface in
`internal/service/interfaces.go`:

```go
type PasswordResetService interface {
    // RequestReset always returns nil for any caller-visible outcome — unknown email,
    // banned user, cooldown, mail failure. Errors are logged, never returned.
    RequestReset(ctx context.Context, email string) error
    // ConfirmReset validates the code and sets the new password.
    // Returns domain.ErrOTPInvalid for every failure of the code/email pair.
    ConfirmReset(ctx context.Context, email, code, newPassword string) error
}
```

Dependencies: `VerificationTokenRepository`, `UserRepository`, `mailer.Mailer`, and a
`runAsync func(func())` field, matching `authService`.

Wiring goes in `internal/app/router.go` (rule: DI lives there, not in `main.go`).

### Token storage

Reused table, `channel = "password_reset"`. No new tables, no schema change to
`verification_tokens`. `TargetPhone` stays empty — it is an SMS-only field.

The existing constants apply unchanged: 10-minute TTL, 60-second cooldown, 5 attempts.

## Security decisions

### Enumeration resistance is the whole design of `/forgot`

Returning `200` unconditionally is necessary but **not sufficient**.

**Latency.** Sending the mail synchronously makes an existing address take a Brevo round trip
(~300–500 ms) while an unknown address returns in single-digit milliseconds. That gap is a
usable oracle for enumerating the user base. The send therefore goes through `runAsync`: both
paths return immediately, and Brevo's outcome never reaches the client.

**Status codes.** For the same reason, a Brevo outage must not surface as a `502` — that
status would appear only for addresses that exist. Send failures are logged server-side
(`[password_reset] send failed for user %s: %v`, never the code) and the token is marked used
so the 60-second cooldown does not block the retry, mirroring what `verification_service.go`
already does.

**Cooldown.** `ErrRateLimitOTP` leaks by the same logic — only real users can be rate-limited.
`RequestReset` swallows it and returns `nil`. Abuse is bounded by the per-IP rate limit
middleware, which cannot distinguish accounts and therefore cannot leak.

**Banned users.** Treated exactly like unknown addresses: `200`, no mail, no token.

### `/reset` collapses every failure into one error

`otp_expired` and `otp_invalid` must not be distinguishable here. Otherwise: call `/forgot`
for a target address (`200` regardless), wait past the TTL, submit a garbage code — an
`otp_expired` response proves the account exists.

So **wrong code, expired token, no active token, and unknown email all return
`400 otp_invalid`**. The UI copy covers both real cases in one sentence: *"El código es
inválido o venció. Pedí uno nuevo."*

### Session invalidation

A reset that leaves the attacker's session alive is not a reset. Today's JWTs are stateless
and live 72 hours with no revocation path.

- `users.password_changed_at TIMESTAMPTZ NULL`. `NULL` means "never changed" and rejects
  nothing, so existing sessions survive the deploy with no backfill.
- `jwt.ValidateToken` returns the issued-at alongside the user id (today it returns only the
  id). Three call sites in code, all compiler-caught: `middleware/auth.go:34`,
  `middleware/auth.go:63`, and one assertion in `service/auth_google_test.go`. `GUIDE.md`
  quotes the old signature in four places and goes stale — update it with the change.
- `middleware.Auth` rejects with `401 session_expired` when `iat < password_changed_at`.

**Both gates must be patched, not just `Auth`.** `middleware.OptionalAuth` runs on public
endpoints that enrich their response for a signed-in viewer, and it establishes `userID` from
the same token. Patching only `Auth` would leave a revoked token still granting identity
there. `OptionalAuth` keeps its contract — it never aborts — so on a stale token it simply
declines to set `userID`, exactly as it already does for an invalid one. No `401` from that
path.

**The detail that breaks this if missed:** a JWT's `iat` has **second** granularity while a
Postgres timestamp has microseconds. Storing `12:00:00.500` against a token stamped
`12:00:00` makes a freshly issued token reject itself. `password_changed_at` is therefore
**truncated to the second** on write, and the comparison is strict `<`. The cost is that a
token minted in the very same second as the reset survives; that one-second window is
accepted.

**Middleware cost:** the middleware is stateless today. This adds **one primary-key read per
authenticated request**. At SearchPet's scale that is acceptable, but it is a real change to
the request path and is recorded here as such. To keep the layering honest the middleware
takes a narrow lookup function, not a full `UserRepository`.

### `LoginWithGoogle` also stamps `password_changed_at`

Once the column exists, the pre-hijacking defence in rule #25 gets completed. When
`LoginWithGoogle` discards the `PasswordHash` of an unverified account, it currently leaves
any session that attacker already holds alive. Stamping `password_changed_at` at the same
moment kills it. One line, and it closes the half of that hole that was left open.

### Logging and transport

- The plaintext code is never logged, in line with the existing `SECURITY:` comments.
- The request logger must not dump the `/reset` body — it carries the new password. To be
  verified during implementation.
- No CSRF surface: auth travels in the `Authorization` header, not cookies.
- Email matching goes through `GetByEmail`, which is case-insensitive (rule #26), so an
  account registered as `Carlos@Example.com` is reachable from `carlos@example.com`.

## HTTP contract

Both routes are public and sit behind the per-IP rate limit middleware.

```
POST /api/auth/password/forgot   { email }                       → 200
POST /api/auth/password/reset    { email, code, new_password }   → 200
```

| Endpoint | Situation | Response |
|---|---|---|
| `/forgot` | email exists, does not exist, banned, in cooldown, Brevo down | `200` |
| `/forgot` | malformed body or syntactically invalid email | `400 invalid_request` |
| `/reset` | wrong code, expired, no active token, unknown email | `400 otp_invalid` |
| `/reset` | password shorter than 6, malformed body | `400 invalid_request` |
| both | too many requests from one IP | `429 rate_limit_exceeded` |
| both | unexpected failure | `500 internal_error` |
| auth middleware | token issued before the password changed | `401 session_expired` |

`/forgot` returns a fixed generic body; it must not echo anything derived from whether the
account exists.

New domain error `domain.ErrSessionExpired` with its `CodeFor` entry. `domain.ErrOTPExpired`
already exists and stays in use by the verification flow — the reset path simply never
returns it.

### `401 session_expired` must be handled, not merely displayed

Both clients must **clear the stored token and route to login** on this code. Showing a toast
leaves the user holding a dead session with no way out. This is the one new error code that
needs behaviour, not just copy.

## Data model

Migration `000020_add_password_changed_at`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
```

`IF NOT EXISTS` because AutoMigrate also derives the column from the struct field; both paths
run on every deploy and must not fight (rule: `pkg/database/postgres.go` → `Models` is the
schema source of truth, and `User` is already in it).

Down migration drops the column.

## The reset email

Same skeleton as the existing OTP email — table layout with inline styles, the only thing
Gmail and Outlook honour — and the same SearchPet identity: `#FF6B35` header, the code in
`#E5551F` on `#FFF1EB`, monospaced with wide letter-spacing.

`mailer.Mailer` gains one method:

```go
SendPasswordReset(ctx context.Context, to, code string) error
```

Implemented on `brevoMailer` and on `noopMailer`. **Gotcha to verify:** Go interfaces are
structural, and `sms.SMSSender` currently has a method set identical to `mailer.Mailer`.
Adding a method to `Mailer` may break any site that passes an SMS sender where a `Mailer` is
expected. `NewVerificationService` takes them as separate parameters, so it is expected to be
fine — confirm at implementation time.

Copy differs from the verification email in three ways that matter:

- **No links at all.** A reset mail that never asks the user to click is the strongest
  anti-phishing posture available: it trains them that ours never does.
- **"Si no pediste esto, ignoralo — tu contraseña no cambia."** This is the only signal the
  victim gets that someone is probing their account.
- **"Al cambiarla vas a tener que volver a entrar en tus otros dispositivos."** Without this,
  session invalidation reads as a bug.

Subject: *"Restablecer tu contraseña — SearchPet"*.

## Frontend

**Shared** (`frontend/packages/shared/`): two client methods plus their hooks, following the
existing patterns.

**Web:** one route `/forgot-password` with two internal steps — request the email, then enter
code and new password. One route rather than two keeps the email in component state instead of
a query parameter, where it would end up in browser history and server logs. Linked from
`LoginPage`.

**Mobile:** `app/forgot-password.tsx`, same two steps, linked from the login screen.

**i18n:** new keys in the `auth` namespace for `es`, `en` and `pt`, on both clients, plus the
`session_expired` message in the `errors` namespace. Namespace separator is `:` (rule #12);
web-only namespaces must be registered in `web/src/i18n/index.ts` (rule #21) — `auth` and
`errors` already are.

## Testing

**Go, service unit tests with mocks** — the enumeration guarantees are the point, so they are
tested as behaviour:

- unknown email → `nil`, no token created, no mail sent
- banned user → `nil`, no token, no mail
- user in cooldown → `nil` (the rate-limit error is swallowed)
- mail failure → `nil` to the caller, token marked used
- `ConfirmReset` with a wrong code, an expired token, no token, and an unknown email → all
  four return the **same** `domain.ErrOTPInvalid`
- sixth attempt invalidates the token
- happy path: password hash replaced, `password_changed_at` set and truncated to the second
- a `channel = "email"` token cannot be spent on a reset, and a `password_reset` token cannot
  be spent on `ConfirmOTP`

**JWT and middleware:** `ValidateToken` returns the issued-at; `Auth` rejects a token stamped
before `password_changed_at` with `401 session_expired`; a token stamped in the same second is
accepted; a user with `NULL` `password_changed_at` is unaffected. Separately for
`OptionalAuth`: a stale token leaves `userID` unset and the request proceeds — asserting it
does **not** abort is as important as asserting it drops the identity.

**Handler tests** asserting the status/code table above, including that `/forgot` returns an
identical body for a real and a fake address.

**Web:** Vitest for the two-step page. **Mobile:** Jest smoke test, registering any new
`@shared/hooks` entry in the screen's mock (rule #17).

## Deliberate exclusions

**A reset does not mark the email verified.** The OTP proves the same control that the
verification flow proves, so the temptation is real. But it would create a second path that
grants `is_verified` and the `verified_finder` badge as a side effect, and two ways to become
verified is a maintenance trap. Kept out.

**No SMS, here or anywhere.** Verification by SMS is redundant now that email OTP and Google
Sign-In both exist. More importantly, wiring Twilio into location alerts — the item this
change retires from the roadmap — **violates rule #1**: Twilio bills per message, alerts fire
per nearby report, so the cost would scale with the app's success. FCM is free, unlimited, and
already shipped. The existing Twilio OTP code stays where it is: it degrades to a no-op
without credentials, costs nothing, and is tested. Nothing new gets built on top of it.

The consequence, stated plainly: **email becomes the only route back into an account.** A user
who loses their mailbox loses the account. For a free pet-finding app that is an acceptable
trade — and it is exactly why this flow has to be correct.

## Findings from the security review (2026-07-29), and what was done

The review found **no vulnerability at or above its confidence bar**. It raised three
sub-threshold notes. One was a real defect and is fixed; two are accepted and recorded
here rather than silently dropped.

**Fixed — the `max=72` on the password did not do what its comment claimed.**
`go-playground/validator`'s `max` tag counts **runes** (`utf8.RuneCountInString`) while
`bcrypt.GenerateFromPassword`'s limit is 72 **bytes**. Verified empirically: 72 `ñ`
characters are 144 bytes and sail through the binding. They would then fail inside
bcrypt as a `500`, *after* `IncrementAttempts` had already spent one of five tries —
exactly the failure the bound was added to prevent. The handler now checks the byte
length before any state moves (`bcryptMaxPasswordBytes`), with a test that fails when
the check is removed.

**Accepted — a resend leaves the older reset OTP usable.** `FindActiveByUser` returns
only the newest token, so after a successful reset spends it, a previous still-active
token becomes the next candidate for its remaining TTL. Exploiting that requires
already knowing that older code, which means mailbox access — at which point the
attacker has the newest code too, so the security gain of fixing it is zero. Closing
it properly needs a new repository method (invalidate all tokens for user+channel)
plus its interface and mocks; that is not worth the surface for no gain. The
pre-existing email-verification flow has the identical gap.

**Accepted — an already-open WebSocket survives a reset.** New connections are
blocked (tickets are minted from the now freshness-gated `protected` group), but a
connection established before the reset keeps streaming until it drops. This is an
incompleteness of a brand-new control, not a regression. Making revocation airtight
means the hub must drop a user's live connections on a credential change — its own
piece of work, and out of scope here.

## Open risks

- **Middleware DB read per authenticated request.** Accepted above. If it ever shows up in
  Render metrics, the fix is a short-TTL in-process cache of `password_changed_at`, not a
  redesign. Not built now: Render free runs a single instance, and premature caching would
  repeat the multi-process problem that pushed rate limiting to Redis.
- **`Mailer` interface change vs. structural typing with `sms.SMSSender`.** Expected to be
  contained; confirm by compiling.
- **Concurrent `IncrementAttempts`.** The increment is atomic but the read-back is a separate
  statement, so two simultaneous attempts can observe the same value. The cap still holds
  within one attempt. Pre-existing, not introduced here, and not worth fixing for a 5-attempt
  counter.
