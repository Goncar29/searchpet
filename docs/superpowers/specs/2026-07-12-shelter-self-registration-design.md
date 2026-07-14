# Shelter Self-Registration — Design

**Date:** 2026-07-12
**Status:** Approved for planning
**Scope:** Web + backend. Mobile keeps its read-only directory unchanged.

## Problem

Today shelters get into the directory only by contacting the team out-of-band; an
admin creates the record via `POST /api/admin/shelters`. This does not scale and
the public shelters page ends with a "contact us to be listed" dead end.

## Goal

A logged-in user registers their shelter in-app. The shelter goes through an
admin approval queue before appearing in the public directory. After approval,
the owner manages their own listing — with re-approval required for the fields
that carry fraud risk (donation and website links).

## Decisions (settled during brainstorming)

1. **Ownership model**: a regular user account owns at most one shelter
   (`owner_user_id`, partial unique index). No separate "shelter account" type.
2. **Visibility**: only `approved` shelters appear in the public directory.
   Existing rows are grandfathered to `approved` by migration.
3. **Edits after approval**: `donation_url` / `website_url` changes are staged
   in pending columns and require admin approval; the public listing keeps
   serving the current values meanwhile. All other fields apply immediately.
4. **Platform**: registration/management UI is web-only. Approval queue lives
   in the existing web admin section.
5. **Defaults**: registering requires a verified email (existing OTP flow);
   rejection stores a reason visible to the owner in-app; no emails sent.
6. **Process transparency (user-requested)**: before the form, the user sees an
   explicit "how it works" step describing the 3-step path to publication; the
   same steps render as a status stepper while the shelter is under review.

## Data model

Extend the existing `Shelter` struct (`backend/internal/domain/models.go`):

| Field | Type | Notes |
|---|---|---|
| `OwnerUserID` | `*uuid.UUID` | nullable — seed/admin-created rows have no owner; partial unique index (`WHERE owner_user_id IS NOT NULL`) enforces one shelter per account |
| `Status` | `string` | `pending \| approved \| rejected`, indexed, default `pending` |
| `RejectionReason` | `string` | shown only to owner and admins |
| `PendingDonationURL` | `*string` | `nil` = no staged change; `""` = staged clear (rule #22 pointer pattern) |
| `PendingWebsiteURL` | `*string` | same semantics |
| `UpdatedAt` | `time.Time` | model currently has only `CreatedAt` |

State rules:

- Public directory (web + mobile, no UI change) filters `status = 'approved'`
  at the repository level.
- Migration marks **all existing shelters** `approved` (they were hand-vetted);
  `IsVerified` keeps its current independent "verified badge" semantics.
- `rejected` is not terminal: the owner edits and resubmits → back to `pending`.
- Sensitive-field staging applies only in `approved`; in `pending`/`rejected`
  every field edits freely.

## API

Clean Architecture layers as usual; all errors via `writeError` → `{code,message}`.

Owner endpoints (JWT-protected; service enforces verified email):

```
POST /api/shelters          create own shelter (status: pending)
                            409 shelter_already_owned | 403 email_not_verified
GET  /api/shelters/mine     full own record (status, rejection_reason, pendings)
PUT  /api/shelters/mine     pending/rejected: free edit, rejected → pending
                            approved: normal fields apply; donation/website → Pending*
```

Admin endpoints (existing `RequireAdmin` group):

```
GET  /api/admin/shelters/pending        queue: pending registrations + approved
                                        shelters with staged link changes
POST /api/admin/shelters/:id/approve    pending → approved
POST /api/admin/shelters/:id/reject     pending → rejected, body {reason} required
POST /api/admin/shelters/:id/links/approve   copy Pending* into live fields, clear
POST /api/admin/shelters/:id/links/reject    discard Pending*
```

Existing `POST/PUT /api/admin/shelters` stay: manual admin creation, born
`approved`, no owner. Public `GET /api/shelters` gains the `approved` filter.

DTO boundaries (rule #7): the public response never exposes `owner_user_id`,
`rejection_reason`, or pending fields; those appear only in the owner and admin
responses.

Events (rule #8): `shelter.approved` / `shelter.rejected` → NotificationService
pushes to the owner (same pattern as `pet.found`). `shelter.submitted` is
published with no listener yet (future: admin alerting/analytics).

## Web UI

**Register page** (`/shelters/register`, login required; linked from the
shelters page CTA that currently says "contact us"):

1. **Step 0 — How it works**: pre-form screen with the 3 process steps
   (fill in your data → team reviews it, you get a notification → it goes
   live in the directory), plus two honest notes: what gets reviewed and why
   (donation link fraud), and that SearchPet never collects money. If the
   user's email is unverified, this screen says so and links to verification
   instead of letting them hit a 403 at submit time.
2. **Form**: shelter fields (name, city, phone, email, description, website,
   donation link; location optional). Inline validation; API errors via
   `getErrorMessage`.
3. **Confirmation**: submitted, under review.

**My shelter page** (`/shelters/mine`; the register CTA redirects here when a
shelter already exists):

- Status stepper reusing the same 3 steps: `pending` highlights "under
  review"; `rejected` shows the admin's reason + "fix and resubmit";
  `approved` shows the published listing.
- In `approved`: edit form; touching donation/website warns the change goes
  to review and the listing keeps the previous link meanwhile ("link change
  under review" badge).

**Admin page**: new "Shelters" page in the existing admin section (web-only
`admin` i18n namespace, already registered — rule #21). Queue cards show all
data with clickable links for vetting; approve / reject (reason required).
Approved shelters with staged link changes appear in the same queue showing
an old → new diff.

i18n: es/en/pt for everything; shared `shelters` namespace for user-facing
pages, `admin` namespace for the queue.

## Error handling

New error codes (backend + `errors:` keys in the 3 locales):
`shelter_already_owned` (409), `email_not_verified` (403),
`shelter_not_found` (404), `invalid_shelter_status` (409 — illegal
transition, or link approval with nothing staged),
`rejection_reason_required` (400). URL fields must be well-formed `https://`
(inline form validation first, backend returns `invalid_input`).

Web pages follow the PR #82 pattern: distinct error states with retry, never
an empty state on fetch failure.

## Testing

- **Backend**: repository tests against real Postgres (approved filter, owner
  uniqueness, state transitions, staging apply/discard); service tests with
  mocks (guards: unverified email, already-owned, reject without reason,
  sensitive edit staging); handler tests (status codes, error codes,
  admin-only queue, and a security test asserting the public DTO leaks no
  owner/reason/pending fields).
- **Web**: stepper states, register flow (validation, submit, error), edit
  with staged-link warning, admin queue (approve/reject with reason, link
  diff). Hooks mocked as usual.
- **Optional E2E**: Go flow test covering register → reject → resubmit →
  approve → visible in `GET /api/shelters`.

## Out of scope

Shelter dashboard, adoption listings (separate upcoming feature), admin
notifications for new submissions, mobile registration/management.
