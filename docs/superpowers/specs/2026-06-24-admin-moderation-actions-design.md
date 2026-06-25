# Admin Moderation Actions — Design

**Date:** 2026-06-24
**Backlog items:** #13 (backend endpoints) + #14 (frontend confirmation modals)
**Status:** Approved (pending spec review)

## Problem

The admin abuse-reports view (`AbuseReportsPage`, enriched in #11) lets an admin
*see* who reported whom and what content was reported, and mark a report
`resolved`/`dismissed`. But the admin cannot actually *act* on abuse: there is no
way to take down reported content or stop an abusive user. Moderation is
read-only today.

The data already supports the targets: an abuse report points at either a
location `Report` (`target_report_id`) or a `User` (`target_user_id`), and #11
exposes those as enriched refs in the response.

## Goal

Give admins concrete moderation actions from an abuse report:

1. **Delete the reported content** — hard-delete the targeted location `Report`.
2. **Ban / unban the reported user** — reversible, via the existing
   `User.IsBanned` + `BanReason` fields (already enforced at login).

No permanent user deletion (explicitly out of scope — see below).

## Decisions

1. **"Delete report" = delete the reported content**, i.e. the targeted location
   `Report` row. Not the abuse-report record (that is what `resolve`/`dismiss`
   already does). Hard delete: a `Report` is a near-leaf row — photos belong to
   the `Pet`, and `Message.ReportID` is a nullable pointer with no GORM
   association (so no FK blocks the delete; at worst a chat keeps a dangling
   `report_id`, which the app already tolerates).

2. **User moderation = ban/unban only.** `User.IsBanned` already blocks login
   (`auth_service` returns `ErrUserBanned`). Banning fully neutralizes the user,
   is reversible, and carries zero cascade risk. Permanent hard-delete is **out
   of scope** (irreversible, FK-cascade minefield across pets/reports/messages,
   no real need for a $0 social-good app).

3. **Endpoints are scoped to the target entity, not to the abuse report**
   (Approach A). Atomic, RESTful, reusable. The frontend orchestrates: it calls
   the moderation action and, separately, may mark the abuse report resolved via
   the existing endpoint. Resolution stays decoupled from the action.

4. **A new `ModerationService` owns user ban/unban.** Report deletion lives in
   the existing `ReportService` (report domain). User moderation gets its own
   small, cohesive service rather than being folded into `auth_service` (which is
   authentication, a different concern). There is no existing general
   `UserService`, so this fills a real gap without crossing domains.

5. **`is_banned` is added to `AbuseUserRef`** (the #11 DTO ref) so the frontend
   can render Ban vs Unban correctly.

## Architecture & Changes

All new endpoints hang off the existing `RequireAdmin` group in `router.go`.
All errors use `writeError(c, status, err)` → `{code, message}` (project rule
#11).

### Backend — #13

| Action | Endpoint | Layers touched |
| --- | --- | --- |
| Delete reported content | `DELETE /api/admin/reports/:id` | `ReportRepository.Delete` (new) · `ReportService.Delete` (new method) · `report_handler.DeleteReport` (new, admin) |
| Ban user | `PATCH /api/admin/users/:id/ban` body `{reason?}` | `ModerationService.BanUser` (new service) · `moderation_handler.BanUser` (new) |
| Unban user | `PATCH /api/admin/users/:id/unban` | `ModerationService.UnbanUser` · `moderation_handler.UnbanUser` |

- `ReportRepository.Delete(ctx, id)` — hard delete; returns `ErrReportNotFound`
  when the row is absent.
- `ModerationService` depends on `UserRepository` (`GetByID` + `Update`, both
  exist). `BanUser` sets `IsBanned=true`, `BanReason=reason` (reason optional,
  length-capped). `UnbanUser` sets `IsBanned=false`, clears `BanReason`.
- DTO: add an `IsBanned` boolean field (`json:"is_banned"`) to `AbuseUserRef` and
  populate it in `ToAbuseReportResponse` from the preloaded `TargetUser`.

### Business rules / errors

- `DELETE /admin/reports/:id`: `404 report_not_found` if missing; success returns
  the report id (or `204`). Admin-gated.
- `PATCH /admin/users/:id/ban`: `404 user_not_found` if missing; **`400` if the
  target is an admin** (admins are not bannable — also covers self-ban). `reason`
  optional, capped (e.g. 500 chars).
- `PATCH /admin/users/:id/unban`: `404` if missing; idempotent (unbanning a
  non-banned user is a no-op success).
- Auth/authz (401/403) handled by the existing `Auth` + `RequireAdmin`
  middleware — not re-implemented.

### Frontend — #14

- **`ConfirmModal`** — reusable web component: title, message, confirm/cancel,
  destructive styling, loading/disabled state while the mutation runs.
- **`AbuseReportsPage`** — per-row action buttons, conditional on the enriched
  refs:
  - `target_report` present → "Delete content" → `ConfirmModal` →
    `DELETE /admin/reports/:id`.
  - `target_user` present → "Ban"/"Unban" (chosen by `target_user.is_banned`) →
    `ConfirmModal` (ban includes an optional reason field) → ban/unban.
- **`apiClient`** methods: `deleteReport(id)`, `banUser(id, reason?)`,
  `unbanUser(id)`.
- **React Query**: mutations that invalidate the abuse-reports query on success
  so the list reflects the new state.
- **Shared type**: add `is_banned?: boolean` to the `target_user` ref on
  `AbuseReport`.
- **Copy**: modal/button text in English, consistent with the already
  all-English admin page (no i18n there today).

## Data Flow

```
Admin clicks "Delete content" / "Ban"
→ ConfirmModal confirm
→ apiClient.deleteReport(id) | banUser(id, reason)
→ DELETE /admin/reports/:id | PATCH /admin/users/:id/ban   (RequireAdmin)
→ ReportService.Delete | ModerationService.BanUser
→ repository
→ on success: invalidate abuse-reports query; admin may then resolve the report
```

## Known Limitation (documented, out of scope)

`IsBanned` is checked only at login. A user already holding a valid token keeps
access until it expires (72h); banning does not kill an active session.
Closing that gap would require the `Auth` middleware to check `IsBanned` on every
request (an extra DB read per request). Deferred (YAGNI).

## Testing (TDD)

- **Backend:**
  - `ReportRepository.Delete` — repo test against `lostpets_test` DB (delete
    existing → gone; delete missing → `ErrReportNotFound`).
  - `ModerationService.BanUser/UnbanUser` — unit tests with a mock
    `UserRepository` (sets/clears `IsBanned`+`BanReason`; 404 on missing; 400 on
    admin target).
  - Handlers — admin guard enforced, 404 paths, success shapes (`{code,message}`
    on errors).
  - DTO — `is_banned` mapped from the preloaded target user.
- **Frontend:**
  - `ConfirmModal` — renders title/message, fires confirm/cancel, disables while
    loading.
  - `AbuseReportsPage` — shows the right action per target type; Ban vs Unban by
    `is_banned`; confirming calls the right mutation; list invalidates on success.

## Out of Scope (YAGNI)

- Permanent user hard-delete and its FK cascade.
- Killing active sessions of a just-banned user (login-time check only).
- i18n of the admin page (kept English, matching the current page).
- Auto-resolving the abuse report inside the moderation action (resolution stays
  a separate, existing endpoint).

## Delivery

Two focused PRs, off `main`, user controls merge:

- **PR1 — #13 (backend):** repo/service/handler/router + `is_banned` DTO field +
  Go tests.
- **PR2 — #14 (frontend):** `ConfirmModal`, `AbuseReportsPage` actions,
  `apiClient` methods, shared type, web tests. Built after PR1 merges (depends on
  its endpoints and the `is_banned` field).
