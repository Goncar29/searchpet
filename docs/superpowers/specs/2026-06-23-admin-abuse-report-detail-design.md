# Admin Abuse Report Detail — Design

**Date:** 2026-06-23
**Backlog item:** #11 (first of the admin cluster: #11 → #13 → #14)
**Status:** Approved (pending spec review)

## Problem

The admin abuse-reports table (`AbuseReportsPage.tsx`) shows raw, truncated UUIDs:
`user: abc12345` / `report: abc12345`, and no information about WHO filed the report.
An admin cannot meaningfully triage a report — they can't see the reporter, can't see
who/what was reported, and can't click through to investigate. The backend
`AbuseReportResponse` only carries flat foreign-key IDs (`reporter_id`,
`target_user_id`, `target_report_id`); `domain.ReportAbuse` has no GORM associations.

The `reason` field is free text (`size:255`), so it is already human-readable — no
mapping needed there.

## Goal

Give the admin enough context to act: the reporter's name (linked to their profile),
and the reported target's name (user → profile link; report → pet name linked to the
pet page).

## Decisions

1. **Scope:** backend (model + repo + DTO) + web admin page. Web-only — there is no
   mobile admin surface.
2. **Enrichment approach:** GORM associations + `Preload`, matching the established repo
   pattern (e.g. success stories preload `Pet`/`User`). The alternative (service-layer
   batch fetch) was rejected as a second, inconsistent pattern with more code.
3. **Backward compatibility:** keep the existing flat IDs on `AbuseReportResponse` and
   ADD nested enriched objects alongside them. Existing consumers keep working; the new
   fields are additive.
4. **Graceful degradation:** if a referenced user/report was deleted, the preload yields
   a zero-value association → the nested object is omitted (`omitempty`) and the frontend
   falls back to the truncated raw ID.

## Architecture & Changes

### Backend

- `internal/domain/models.go` — add associations to `ReportAbuse` (not serialized raw):
  ```go
  Reporter     User    `gorm:"foreignKey:ReporterID" json:"-"`
  TargetUser   *User   `gorm:"foreignKey:TargetUserID" json:"-"`
  TargetReport *Report `gorm:"foreignKey:TargetReportID" json:"-"`
  ```
  `Report` already has a `Pet` association, so `TargetReport.Pet` resolves the pet name.

- `internal/repository/abuse_report_repository.go` — add to `GetAll` and `GetByID`:
  `Preload("Reporter")`, `Preload("TargetUser")`, `Preload("TargetReport.Pet")`.

- `internal/dto/abuse_report_dto.go` — keep flat IDs; add nested DTOs + mapping:
  - `Reporter *AbuseUserRef` → `{ id, name }` (omitempty; populated when `Reporter.ID` non-zero)
  - `TargetUser *AbuseUserRef` → `{ id, name }` (omitempty; only when target is a user and it exists)
  - `TargetReport *AbuseTargetReportRef` → `{ id, pet_id, pet_name }` (omitempty; only when target is a report and it exists)
  - New ref types:
    ```go
    type AbuseUserRef struct {
        ID   uuid.UUID `json:"id"`
        Name string    `json:"name"`
    }
    type AbuseTargetReportRef struct {
        ID      uuid.UUID `json:"id"`
        PetID   uuid.UUID `json:"pet_id"`
        PetName string    `json:"pet_name"`
    }
    ```

### Shared types

- `frontend/packages/shared/types/index.ts` — extend `AbuseReport`:
  ```ts
  reporter?: { id: string; name: string };
  target_user?: { id: string; name: string };
  target_report?: { id: string; pet_id: string; pet_name: string };
  ```

### Web

- `pages/admin/AbuseReportsPage.tsx`:
  - **Reporter** column (new): `reporter.name` as a `<Link to={`/users/${reporter.id}`}>`;
    fallback to truncated `reporter_id` when `reporter` is absent.
  - **Target** column (enriched): if `target_user` → name linked to `/users/:id`; if
    `target_report` → `pet_name` linked to `/pets/:petId`; fallback to the current
    truncated-ID text when neither nested object is present.

## Data Flow

`GET /api/abuse-reports` (admin)
→ repo `GetAll` preloads `Reporter`, `TargetUser`, `TargetReport.Pet`
→ `ToAbuseReportResponse` maps associations into nested refs (omitting empties)
→ web renders names as links to existing `/users/:id` and `/pets/:id` routes.

## Error / Edge Handling

- Reporter deleted → `reporter` omitted → fallback to truncated `reporter_id`.
- Target user/report deleted → nested object omitted → fallback to truncated raw ID.
- A report target whose pet is missing → `target_report` omitted (treated as not
  resolvable) → fallback to raw `target_report_id`.

## Testing (TDD)

- **Backend repository:** `GetAll`/`GetByID` populate `Reporter` and the relevant target
  association (a report whose reporter + target user exist comes back with both loaded).
- **Backend DTO (pure):** mapping produces nested refs from a populated `ReportAbuse`;
  a report with a zero-value target association omits the nested object.
- **Web:** `AbuseReportsPage` test (new) — renders the reporter name linked to
  `/users/:id`; a user-target renders a profile link; a report-target renders the pet
  name linked to `/pets/:petId`; missing nested objects fall back to truncated IDs.

## Out of Scope (YAGNI)

- Destructive admin actions (delete report, suspend/delete user) → **#13**.
- Confirmation modals → **#14**.
- Any mobile admin surface (none exists).
- Changing the `reason` representation (already free-text and readable).
