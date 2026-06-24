# Success Story Pet Photo — Design

**Date:** 2026-06-23
**Backlog item:** #15
**Status:** Approved (pending spec review)

## Problem

Success stories render no image. Across web (`StoriesPage` cards, `StoryDetailPage`)
and mobile (`story/index.tsx` cards) the stories are text-only. The `StoryResponse`
DTO carries `photo_before` / `photo_after`, but no UI ever populates them, so those
fields are always empty in practice. The result is a flat, imageless feed for one of
the most emotionally resonant surfaces of the app — pets reunited with their families.

The pet that each story is about already has a published photo (the one used when it
was reported lost/stray). We want to surface that photo automatically.

## Goal

Show the pet's published photo on every success-story surface, sourced automatically
from the pet the story is about. No new upload UI.

## Decisions

1. **Scope:** web + mobile. The backend change feeds both; doing one without the other
   leaves an inconsistent feed.
2. **Contract:** a dedicated new field `pet_photo` on `StoryResponse`. We do NOT reuse
   or auto-fill `photo_before`, because that field is semantically "before" and is
   reserved for a future manual before/after feature. `pet_photo` means "the pet's
   published photo", which is honest about its source.
3. **Which photo:** the canonical primary = the **first** photo by `created_at ASC, id ASC`.
   This matches the rule established in #17 (PR #41) and deliberately ignores the
   `is_primary` flag, which #17 found unreliable (newest upload stole the flag). Using
   the ordering rule directly makes #15 independent of #41's merge order.

## Architecture & Changes

### Backend

- `internal/repository/success_story_repository.go`
  - In the three read paths (`GetByID`, `GetByPetID`, `GetAll`) preload the pet's photos
    ordered canonically:
    `Preload("Pet.Photos", func(db *gorm.DB) *gorm.DB { return db.Order("created_at ASC, id ASC") })`.
  - Extract the ordering into a small local helper/closure to avoid repeating the literal
    in three places.

- `internal/dto/success_story_dto.go`
  - Add `PetPhoto string \`json:"pet_photo,omitempty"\`` to `StoryResponse`.
  - In `ToStoryResponse`: if the preloaded `Pet` has at least one photo, set
    `PetPhoto = s.Pet.Photos[0].URL`. If the pet was deleted or has no photos, leave it
    empty (graceful — the field is `omitempty`).

### Shared types

- `frontend/packages/shared/types/index.ts`
  - Add `pet_photo?: string;` to the `SuccessStory` interface.

### Web

- `pages/StoriesPage.tsx`
  - When `story.pet_photo` is present, render a header image at the top of the card
    (`object-cover`, fixed height, rounded top corners). When absent, keep the current
    text-only card layout unchanged.

- `pages/StoryDetailPage.tsx`
  - When `story.pet_photo` is present, render it as a hero image above the title.
  - Leave the existing `photo_before` / `photo_after` block untouched (still empty today,
    but not this change's job to remove).

### Mobile

- `app/story/index.tsx`
  - When `item.pet_photo` is present, render an `<Image>` at the top of the card, styled
    consistently with the existing card (rounded top, fixed height). Absent → unchanged.

## Data Flow

`GET /api/stories` / `GET /api/stories/:id`
→ repository loads story + `Pet` + `Pet.Photos` (ordered)
→ `ToStoryResponse` maps `Pet.Photos[0].URL` → `pet_photo`
→ frontend renders `pet_photo` when present.

## Error / Edge Handling

- Pet deleted (no preloaded Pet) → `pet_photo` empty → UI shows text-only card. No error.
- Pet exists but has zero photos → `pet_photo` empty → same graceful fallback.
- Multiple photos → deterministic first-by-`created_at ASC, id ASC` (canonical primary).

## Testing (TDD)

- **Backend (the real logic):**
  - Repository/DTO test: a story whose pet has multiple photos returns `pet_photo` equal
    to the URL of the earliest photo (canonical order), regardless of `is_primary`.
  - A story whose pet has no photos returns empty `pet_photo`.
- **Web/shared:** minimal smoke — card/detail render the image element when `pet_photo`
  is set, and omit it when not.

## Out of Scope (YAGNI)

- Manual before/after photo upload UI.
- Touching the `is_primary` flag or `photo_service` primary-selection logic (that's #17).
- Removing the existing `photo_before` / `photo_after` detail block.
