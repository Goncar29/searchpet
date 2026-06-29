# Admin Role Management — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)

## Problem

Becoming an admin is the `users.is_admin` bool, checked by `middleware.RequireAdmin`.
Today the **only** way to grant it is the audited CLI command `cmd/promote-admin`
(`make promote-admin EMAIL=...`), which runs against `DATABASE_URL`. Rule #20 of
`CLAUDE.md` deliberately avoided any HTTP path because the original concern was the
**bootstrap hole**: an unauthenticated endpoint that could mint the first admin.

That concern does not apply to an *authenticated, admin-guarded* operation. The
admin group in `router.go` already lets an admin do things of equal or greater
trust (ban/unban users, delete reports and stories). Promoting another user is a
consistent extension of that surface — and it removes the operational pain of
needing CLI + `DATABASE_URL` access just to add a teammate as admin.

## Goal

Let an existing admin grant or revoke the admin role of another user **from inside
the app**, safely:

1. A backend endpoint behind the existing `Auth` + `RequireAdmin` group.
2. A web admin UI to drive it.
3. Anti-lockout protections so the system can never end up with zero admins.
4. A persistent, queryable audit trail of every privilege change.

The CLI (`cmd/promote-admin`) stays as the bootstrap for the first admin and as
the recovery path if the app-level admins ever lock themselves out.

## Decisions

1. **Lookup is by exact email, not by id.** The UI has no user list to pick ids
   from (and deliberately doesn't expose one — discretion). The admin types the
   exact email, mirroring the CLI. Reuses the email-based lookup already in
   `admintool.SetAdmin`. Matching is exact (whitespace-trimmed), consistent with
   how emails are stored verbatim.

2. **The endpoint takes email in the body.** `POST /api/admin/users/admin-role`
   with `{ "email": "...", "grant": true|false }`. A body field is cleaner than a
   path param for emails (which contain `@`/`.`), and avoids a separate
   email→id resolution endpoint.

3. **Guardrails live in a new HTTP-only service layer, NOT in the CLI.**
   A new `AdminService.SetUserAdmin(ctx, actorID, email, grant)` enforces, before
   any write:
   - **No self-revoke:** an admin cannot remove their own admin flag
     (`actorID == targetID` on a revoke → `ErrCannotRevokeSelf`).
   - **No last-admin revoke:** if the target is currently an admin and the total
     admin count is ≤ 1, the revoke is rejected (`ErrCannotRevokeLastAdmin`).

   `admintool.SetAdmin` (used by the CLI) stays **unguarded and unchanged**. The
   CLI is the recovery tool — it must be able to do anything the operator
   explicitly asks, including removing the last admin. Putting the guardrails only
   in the HTTP path keeps recovery always possible.

4. **Audit trail is a persistent DB table, not just logs.** A privilege-change log
   is forensic: it is consulted after a compromise, often long after the event.
   Render free-tier log retention is short (days), so a log-only trail would erase
   exactly the record we need. The volume is tiny (a handful of rows ever), so a
   table costs nothing meaningful on Neon. Email snapshots are stored so the log
   stays readable even if a user is later deleted.

5. **Web admin UI only.** The admin panel (`AdminLayout`) is web-only; mobile has
   no admin section. Mobile is explicitly out of scope.

## Architecture & Changes

### Backend

**New domain model — `AdminAuditLog`** (`internal/domain/models.go`):

```
AdminAuditLog
  id           uuid (pk)
  actor_id     uuid  // admin who made the change
  target_id    uuid  // user whose role changed
  actor_email  string // snapshot, readable even if the user is deleted
  target_email string // snapshot
  action       string // "grant" | "revoke"
  created_at   timestamp
```

Created via AutoMigrate on deploy, like the rest of the schema.

**New repository** — `AdminAuditRepository` (interface + GORM impl) with `Create`
and a `List(limit)` for the recent-changes view. Plus a `CountAdmins(ctx)` method
(on the existing `UserRepository`) for the last-admin guard.

**New service** — `AdminService.SetUserAdmin(ctx, actorID, email, grant)`:
1. Resolve target by email → `ErrUserNotFound` if missing.
2. On revoke: reject self-revoke and last-admin revoke (see Decision 3).
3. Idempotent: if the user is already in the requested state, no-op success
   (mirrors `admintool.SetAdmin`), and **no audit row** is written (nothing
   changed).
4. On an actual change: flip `is_admin` and insert the audit row in the **same
   transaction**.

A `List` path for the UI: `AdminService.RecentRoleChanges(ctx, limit)`.

**New handler + routes** in the existing `RequireAdmin` group (`router.go:367`):
```
POST /api/admin/users/admin-role   → grant/revoke (body: {email, grant})
GET  /api/admin/role-changes       → recent audit entries (for the UI)
```
The handler reads the actor id from the JWT context via the existing `getUserID`
helper, and returns errors through `writeError` (rule #11).

**New error codes** (`{code,message}`, rule #11): `cannot_revoke_self`,
`cannot_revoke_last_admin`. `user_not_found` already exists.

### Frontend (web)

- New page **"Administradores"** under `AdminLayout`: an email input + Grant/Revoke
  action, plus a list of recent role changes from `GET /api/admin/role-changes`.
- Wire into the admin nav and router.
- Strings live in the `admin` i18n namespace (es/en/pt), already registered in
  `web/src/i18n/index.ts` since PR #50 (rule #21). New error codes also added to
  the `errors` namespace consumed by `getErrorMessage`.

### Docs

- Rewrite **rule #20** in `CLAUDE.md`: admin promotion now exists, but **only**
  behind admin auth, with anti-lockout + audit. First-admin bootstrap stays
  CLI-only; the CLI remains the unguarded recovery path.

## Testing (TDD)

- **Go service tests** (`AdminService`):
  - grant succeeds, flips `is_admin`, writes one audit row with the right action.
  - revoke of a non-last, non-self admin succeeds + audits.
  - self-revoke rejected (`ErrCannotRevokeSelf`), no write, no audit.
  - last-admin revoke rejected (`ErrCannotRevokeLastAdmin`), no write, no audit.
  - unknown email → `ErrUserNotFound`.
  - idempotent no-op (already in requested state) → success, no audit row.
- **Go flow test**: authenticated admin hits `POST /api/admin/users/admin-role`;
  non-admin gets 403 (RequireAdmin); error codes surface as `{code,message}`.
- **Web**: smoke test of the Administradores page (renders, submits, shows error).

## Out of Scope

- Mobile admin UI (no admin panel on mobile).
- First-admin bootstrap via app (stays CLI-only — the bootstrap hole rule #20
  guards against).
- Roles beyond the binary `is_admin` (no role hierarchy / granular permissions).
