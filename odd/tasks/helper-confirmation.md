# Helper confirmation when a pet is found (T8)

## Objective

When a pet turns `found`, its owner must say who helped, choosing among the
people who reported on it during the current search. Only those people earn
points, badges and the profile "Encontradas" count, and they get a push.

## Problem

Since PR #313 nobody earns anything when a pet is found: the old listener
credited the OWNER (+100, found_count, pet_rescuer, super_finder), which let an
owner farm points by toggling their own pet. The system cannot know who really
found the animal; the owner can.

## Owner decisions (2026-10-01)

- "Encontradas" = pets I helped find. The owner never earns by finding their
  own pet; they may still mark it found.
- Answering is MANDATORY on every path that turns a pet found; "nobody" is a
  valid answer.
- Enforced in the BACKEND (one function used by every door), not per screen.

## Findings (mapper, 2026-10-04)

- Three backend doors set `found` and publish `pet.found`, all inside
  `uow.Execute`:
  1. `UpdatePet` — `PUT /api/pets/:id` (`pet_service.go` ~447).
  2. `MarkAsFound` — `PATCH /api/pets/:id/found` (~570-669), no body today.
  3. `CreateReport` with status `found` — `POST /api/reports`
     (`report_service.go` ~169-212).
  No admin door. Authorization is `canManagePet` on all three: owner, or the
  reporter of a stray. A non-owner CANNOT flip a pet to found (403 before any
  write, `report_service.go:146-153`), so the "door 3 non-owner" question is
  closed.
- Current episode: `tx.Episodes.FindCurrent(petID)`; `CloseCurrent` keeps
  `pets.current_episode_id`, so it resolves to the same episode before or after
  `HandleTransition` inside the same transaction. Reports carry `episode_id`;
  old rows and pets never lost may have none → empty candidate list.
- UI paths: web `MyPetsPage.tsx:85` (door 1), `PetDetailPage.tsx:474-510`
  (door 2), `CreateReportPage.tsx:~230` (door 3); mobile `my-pets.tsx:156`
  (door 2), `my-pets.tsx:112-153` (door 3), `pet/[id].tsx:184` (door 2).
- Reuse: removed `onPetFound` body (`git show 8cc0fe38^:backend/internal/service/gamification_service.go`),
  `AwardBadgeIfEligible` (idempotent), `NotificationService.pushToUser`,
  `EventBus.SubscribeSync` (no sleep in tests), web `ConfirmModal` (children
  slot), mobile transparent `Modal` pattern (`foster-home/[id].tsx:306-340`).
- `user_points.Upsert` is NOT idempotent: awards must fire only when the credit
  insert really inserted (`ON CONFLICT DO NOTHING` + RowsAffected).
- Next migration number: `000028`. New model must be added to
  `pkg/database/postgres.go var Models`.

## Design

- Table `pet_helper_credits` (pet_id, episode_id, helper_user_id, credited_by,
  credited_at), unique index per the credit-scope decision.
- `ConfirmHelpers(tx, pet, actorID, helperIDs *[]uuid.UUID)` called inside the
  transaction of each door when the target status is `found`. Candidates are
  computed server-side; nil list → 400 `helper_ids_required` (only when there
  are candidates); unknown id / owner / stray reporter → 400 `invalid_helpers`.
- `GET /api/pets/:id/helper-candidates` (canManagePet) for the pickers.
- After commit, `pet.helpers_credited` event: sync gamification listener
  (+100, pet_rescuer, super_finder ≥5) and a push to each helper.
- Profile `found_count` counts credit rows.

## Defaults (APPROVED by the owner on 2026-10-04)

1. Credit once per PET (not per episode): a found → lost → found loop cannot
   credit the same helper twice.
2. Candidates: every distinct reporter of the current episode, any report
   status, excluding the owner / stray reporter.
3. A stray's reporter acts as the owner (chooses helpers, earns nothing).
4. No backfill (production has 0 pets).
5. No retroactive edits once the pet is found.

## Tasks

- [ ] T1 — Backend: model + migration 000028, candidates query, ConfirmHelpers
  in the three doors, errors, candidates endpoint, credited event + listeners,
  profile count from credits. Tests against real Postgres. Route: delegated.
- [ ] T2 — Shared: types, client, hooks (`useHelperCandidates`, helper_ids on
  the three mutations), i18n keys. Route: delegated (with T3 or T4).
- [ ] T3 — Web: picker component + the three paths. Route: delegated.
- [ ] T4 — Mobile: picker component + the three paths. Route: delegated.
- [ ] T5 — Replace `OnPetFound_CreditsNobody` sleep with sync dispatch (review
  suggestion from #313).

## Checks

Backend `go test ./... -count=1 -p 1 -timeout 40m` with DATABASE_URL on
`lostpets_test`, e2e with `-tags e2e`, `go vet`, `govulncheck`. Web
`pnpm test:run`, `build`, `lint`. Mobile `pnpm test:run`, `tsc`, `lint`. RED
first; mutation proofs must name a failing test.

## Progress

- 2026-10-04: mapper report; doc created on `feat/helper-confirmation`.
- 2026-10-04: owner approved the five defaults as written.

## Next step

T1 (backend) delegated.
