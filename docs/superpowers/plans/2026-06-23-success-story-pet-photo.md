# Success Story Pet Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the pet's published photo on every success-story surface (web cards + detail, mobile cards), sourced automatically from the pet.

**Architecture:** Add a `pet_photo` field to `StoryResponse`, populated from the pet's canonical primary photo (first by `created_at ASC, id ASC` — the rule from #17, ignoring the unreliable `is_primary` flag). The success-story repository preloads `Pet.Photos` ordered; the DTO maps the first photo's URL. Frontends render `pet_photo` when present, with a graceful text-only fallback when absent.

**Tech Stack:** Go 1.25 + Gin + GORM (backend), React + Vite + Vitest (web), React Native + Expo + Jest (mobile), TypeScript shared types.

---

## File Structure

- `backend/internal/dto/success_story_dto.go` — add `PetPhoto` field + mapping in `ToStoryResponse`.
- `backend/internal/repository/success_story_repository.go` — preload `Pet.Photos` ordered in `GetByID`, `GetByPetID`, `GetAll`.
- `backend/tests/success_story_dto_test.go` — NEW: pure unit test for the DTO mapping (no DB).
- `backend/tests/success_story_repository_test.go` — add ordered-preload test.
- `frontend/packages/shared/types/index.ts` — add `pet_photo?: string` to `SuccessStory`.
- `frontend/packages/web/src/pages/StoriesPage.tsx` — card image.
- `frontend/packages/web/src/pages/StoriesPage.test.tsx` — image render test.
- `frontend/packages/web/src/pages/StoryDetailPage.tsx` — hero image.
- `frontend/packages/web/src/pages/StoryDetailPage.test.tsx` — hero render test.
- `frontend/packages/mobile/app/story/index.tsx` — card image.

## Test DB note (backend repo test only)

The repository test needs the Postgres test DB. The DTO unit test (Task 1) needs **no** DB.

Ensure the docker DB is up (`make dev`) and a `lostpets_test` database exists in the
`lostpets-db` container (host port 5433). Run backend tests with:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/...
```

`testdb.SetupTestDB` **skips** when `DATABASE_URL` is unset and **truncates all tables** —
never point it at the seeded `lostpets` DB.

---

### Task 1: Backend DTO — `pet_photo` field + mapping

**Files:**
- Modify: `backend/internal/dto/success_story_dto.go`
- Test: `backend/tests/success_story_dto_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/success_story_dto_test.go`:

```go
package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

func TestToStoryResponse_PetPhoto_UsesFirstPhoto(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{
		ID:    uuid.New(),
		PetID: petID,
		Body:  "Reunited",
		Pet: domain.Pet{
			ID:   petID,
			Name: "Toby",
			Photos: []domain.Photo{
				{ID: uuid.New(), URL: "https://cdn/first.jpg"},
				{ID: uuid.New(), URL: "https://cdn/second.jpg"},
			},
		},
	}

	resp := dto.ToStoryResponse(story)

	if resp.PetPhoto != "https://cdn/first.jpg" {
		t.Errorf("want pet_photo=first.jpg, got %q", resp.PetPhoto)
	}
}

func TestToStoryResponse_PetPhoto_EmptyWhenNoPhotos(t *testing.T) {
	petID := uuid.New()
	story := &domain.SuccessStory{
		ID:    uuid.New(),
		PetID: petID,
		Body:  "Reunited",
		Pet:   domain.Pet{ID: petID, Name: "Toby"},
	}

	resp := dto.ToStoryResponse(story)

	if resp.PetPhoto != "" {
		t.Errorf("want empty pet_photo, got %q", resp.PetPhoto)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestToStoryResponse_PetPhoto -v`
Expected: COMPILE FAIL — `resp.PetPhoto undefined (type dto.StoryResponse has no field PetPhoto)`.

- [ ] **Step 3: Add the field**

In `backend/internal/dto/success_story_dto.go`, add to the `StoryResponse` struct
(right after the `PhotoAfter` field, line ~32):

```go
	PetPhoto    string     `json:"pet_photo,omitempty"`
```

- [ ] **Step 4: Map it in `ToStoryResponse`**

In `backend/internal/dto/success_story_dto.go`, inside `ToStoryResponse`, extend the
existing `if s.Pet.ID != (uuid.UUID{})` block so it reads:

```go
	if s.Pet.ID != (uuid.UUID{}) {
		resp.PetName = s.Pet.Name
		if len(s.Pet.Photos) > 0 {
			resp.PetPhoto = s.Pet.Photos[0].URL
		}
	}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestToStoryResponse_PetPhoto -v`
Expected: PASS (both subtests). No DB needed.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/dto/success_story_dto.go backend/tests/success_story_dto_test.go
git commit -m "feat(api): add pet_photo to StoryResponse from first pet photo (#15)"
```

---

### Task 2: Backend repository — ordered `Pet.Photos` preload

**Files:**
- Modify: `backend/internal/repository/success_story_repository.go`
- Test: `backend/tests/success_story_repository_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/success_story_repository_test.go`:

```go
func TestSuccessStoryRepository_GetByID_PreloadsPhotosOrdered(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)
	storyRepo := repository.NewSuccessStoryRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "PhotoPet", Type: "perro", Status: domain.PetStatusFound}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Earliest photo is NOT primary; latest IS primary — proves we pick by
	// created_at order, ignoring the is_primary flag.
	base := time.Now().Add(-2 * time.Hour)
	early := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/early.jpg", UploadedBy: owner.ID, IsPrimary: false, CreatedAt: base}
	late := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/late.jpg", UploadedBy: owner.ID, IsPrimary: true, CreatedAt: base.Add(time.Hour)}
	for _, p := range []*domain.Photo{late, early} { // insert out of order on purpose
		if err := photoRepo.Create(p); err != nil {
			t.Fatalf("Create photo: %v", err)
		}
	}

	story := &domain.SuccessStory{ID: uuid.New(), PetID: pet.ID, UserID: owner.ID, Body: "Reunited"}
	if err := storyRepo.Create(ctx, story); err != nil {
		t.Fatalf("Create story: %v", err)
	}

	got, err := storyRepo.GetByID(ctx, story.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if len(got.Pet.Photos) == 0 {
		t.Fatal("want pet photos preloaded, got none")
	}
	if got.Pet.Photos[0].URL != "https://cdn/early.jpg" {
		t.Errorf("want first photo early.jpg (canonical order), got %q", got.Pet.Photos[0].URL)
	}
}
```

Confirm the file already imports `"time"`. If not, add it to the import block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestSuccessStoryRepository_GetByID_PreloadsPhotosOrdered -v`
Expected: FAIL — `want pet photos preloaded, got none` (Pet.Photos is not currently preloaded).

- [ ] **Step 3: Add the ordered preload helper + apply it**

In `backend/internal/repository/success_story_repository.go`, add a package-level helper
near the top (after the constructor):

```go
// preloadOrderedPhotos preloads the pet's photos in canonical primary order
// (first by created_at ASC, id ASC) so Pet.Photos[0] is the canonical primary.
func preloadOrderedPhotos(db *gorm.DB) *gorm.DB {
	return db.Order("created_at ASC, id ASC")
}
```

Then in `GetByID`, `GetByPetID`, and `GetAll`, add the nested preload immediately after
`Preload("Pet")`. For `GetByID`:

```go
	err := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("Pet.Photos", preloadOrderedPhotos).
		Preload("User").
		Where("id = ? AND deleted_at IS NULL", id).
		First(&story).Error
```

For `GetByPetID`:

```go
	err := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("Pet.Photos", preloadOrderedPhotos).
		Preload("User").
		Where("pet_id = ? AND deleted_at IS NULL", petID).
		First(&story).Error
```

For `GetAll` (the `q :=` builder):

```go
	q := r.db.WithContext(ctx).
		Preload("Pet").
		Preload("Pet.Photos", preloadOrderedPhotos).
		Preload("User").
		Where("deleted_at IS NULL")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestSuccessStoryRepository_GetByID_PreloadsPhotosOrdered -v`
Expected: PASS.

- [ ] **Step 5: Run the full success-story suite to check no regression**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestSuccessStory -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/success_story_repository.go backend/tests/success_story_repository_test.go
git commit -m "feat(api): preload pet photos ordered for success stories (#15)"
```

---

### Task 3: Shared type — `pet_photo`

**Files:**
- Modify: `frontend/packages/shared/types/index.ts:413-428`

- [ ] **Step 1: Add the field**

In the `SuccessStory` interface, after `photo_after?: string;` (line ~420), add:

```ts
  pet_photo?: string;
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/types/index.ts
git commit -m "feat(types): add pet_photo to SuccessStory (#15)"
```

---

### Task 4: Web — card image on `StoriesPage`

**Files:**
- Modify: `frontend/packages/web/src/pages/StoriesPage.tsx`
- Test: `frontend/packages/web/src/pages/StoriesPage.test.tsx`

- [ ] **Step 1: Write the failing test**

In `StoriesPage.test.tsx`, add these two tests inside the `describe('StoriesPage', ...)` block:

```ts
  it('muestra la foto de la mascota cuando pet_photo está presente', () => {
    mockStories = [makeStory({ pet_photo: 'https://cdn/toby.jpg' })];
    render(<StoriesPage />, { wrapper });

    const img = screen.getByRole('img', { name: 'Toby' });
    expect(img.getAttribute('src')).toBe('https://cdn/toby.jpg');
  });

  it('no muestra imagen cuando pet_photo está ausente', () => {
    mockStories = [makeStory()];
    render(<StoriesPage />, { wrapper });

    expect(screen.queryByRole('img')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/StoriesPage.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "img"`.

- [ ] **Step 3: Add the image to the card**

In `StoriesPage.tsx`, inside the card `<div ...>` (the one with `className="bg-white dark:bg-gray-900 rounded-xl ...`), add as the FIRST child, before the `{story.featured && (...)}` block:

```tsx
              {story.pet_photo && (
                <img
                  src={story.pet_photo}
                  alt={story.pet_name}
                  className="w-full h-40 object-cover rounded-lg mb-4"
                />
              )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/StoriesPage.test.tsx`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/StoriesPage.tsx frontend/packages/web/src/pages/StoriesPage.test.tsx
git commit -m "feat(web): show pet photo on success story cards (#15)"
```

---

### Task 5: Web — hero image on `StoryDetailPage`

**Files:**
- Modify: `frontend/packages/web/src/pages/StoryDetailPage.tsx`
- Test: `frontend/packages/web/src/pages/StoryDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

In `StoryDetailPage.test.tsx`, add inside the `describe('StoryDetailPage', ...)` block:

```ts
  it('muestra la foto de la mascota como hero cuando pet_photo está presente', () => {
    mockStory = makeStory({ pet_photo: 'https://cdn/toby.jpg' });
    render(<StoryDetailPage />, { wrapper });

    const img = screen.getByRole('img', { name: 'Toby' });
    expect(img.getAttribute('src')).toBe('https://cdn/toby.jpg');
  });

  it('no muestra hero cuando pet_photo está ausente', () => {
    mockStory = makeStory();
    render(<StoryDetailPage />, { wrapper });

    expect(screen.queryByRole('img')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/StoryDetailPage.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "img"`.

- [ ] **Step 3: Add the hero image**

In `StoryDetailPage.tsx`, inside the `<article ...>`, immediately after the
`{story.featured && (...)}` badge block and BEFORE the `{/* Title */}` `<h1>`, add:

```tsx
        {/* Pet photo hero */}
        {story.pet_photo && (
          <img
            src={story.pet_photo}
            alt={story.pet_name}
            className="w-full h-64 object-cover rounded-lg mb-6"
          />
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/StoryDetailPage.test.tsx`
Expected: PASS.

Note: the existing detail page also renders `photo_before`/`photo_after` images when
present. Those are empty in the test mocks, so `queryByRole('img')` stays null in the
absent case. Leave that block untouched.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/StoryDetailPage.tsx frontend/packages/web/src/pages/StoryDetailPage.test.tsx
git commit -m "feat(web): show pet photo hero on success story detail (#15)"
```

---

### Task 6: Mobile — card image on story list

**Files:**
- Modify: `frontend/packages/mobile/app/story/index.tsx`

- [ ] **Step 1: Add `Image` import**

In `frontend/packages/mobile/app/story/index.tsx`, change the react-native import (line 5) to include `Image`:

```tsx
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
```

- [ ] **Step 2: Render the image in the card**

In `renderItem`, add as the FIRST child inside the `<TouchableOpacity ...>`, before `<View style={styles.cardHeader}>`:

```tsx
      {item.pet_photo ? (
        <Image source={{ uri: item.pet_photo }} style={styles.cardImage} resizeMode="cover" />
      ) : null}
```

- [ ] **Step 3: Add the style**

In the `StyleSheet.create({ ... })` block, add a `cardImage` entry (place it right before the `cardHeader` style):

```tsx
  cardImage: {
    width: '100%',
    height: 160,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
  },
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run mobile test suite (no regression)**

Run: `cd frontend/packages/mobile && pnpm test:run`
Expected: all suites pass (no story-list test exists; story-detail unaffected).

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/mobile/app/story/index.tsx
git commit -m "feat(mobile): show pet photo on success story cards (#15)"
```

---

### Task 7: Full verification + PR

- [ ] **Step 1: Backend full suite**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./...`
Expected: all PASS.

- [ ] **Step 2: Web + shared tests**

Run: `cd frontend/packages/web && pnpm test:run`
Expected: all PASS.

- [ ] **Step 3: Web typecheck**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Open the PR**

Follow the `searchpet-pr` skill conventions. Branch is `feat/success-story-pet-photo`
off `main`. Conventional commits, NO Co-Authored-By. Push and open the PR; the user
controls the merge.

---

## Self-Review

**Spec coverage:**
- Scope web + mobile → Tasks 4, 5 (web), 6 (mobile). ✓
- New `pet_photo` field → Task 1. ✓
- Canonical first-by-`created_at ASC, id ASC`, ignore `is_primary` → Task 2 (preload + test asserts earliest wins over is_primary). ✓
- Graceful empty when no photos / pet deleted → Task 1 second subtest (empty Photos → ""). ✓
- Shared type → Task 3. ✓
- TDD with backend as the real-logic focus → Tasks 1–2 test-first. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `PetPhoto` (Go) ↔ `pet_photo` (JSON/TS) consistent across Tasks 1, 3, 4, 5, 6. `preloadOrderedPhotos` defined once (Task 2) and reused. `cardImage` style defined and referenced in Task 6. ✓
