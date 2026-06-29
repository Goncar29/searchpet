# Lifetime Impact Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage hero counters honest by splitting them into two kinds. Two **lifetime / achievement** counters — "pets reunited" and "searches started" — become numbers that only ever grow (survive status changes AND hard deletes). Two **current-size / snapshot** counters — "members" and "pets registered" — stay as live `COUNT()`s that honestly reflect what exists *now* (and may dip when an account or pet is deleted, which is correct). All four are shown.

**Architecture:** Add an append-only `platform_events` ledger (no foreign keys, so a deleted pet never removes its history). The pet service writes an event **synchronously, in-request** at each lost/found transition (NOT via the fire-and-forget EventBus, which silently drops events). The stats handler computes the two lifetime numbers from the ledger — `pets_reunited = COUNT(DISTINCT pet_id WHERE event_type='pet_found')`, `searches_started = COUNT(* WHERE event_type='search_started')` — and keeps the two snapshot numbers as plain `COUNT()`s over `users` and `pets`. A one-off CLI command backfills a baseline from existing data. The frontend relabels the two lifetime cards and keeps the two snapshot cards.

**Tech Stack:** Go 1.25 + Gin + GORM + PostgreSQL; React + Vite + TypeScript; i18next (es/en/pt).

---

## Why this design (read before starting)

- A `COUNT()` over a live table (`pets`, `reports`) can never be historical: it drops on status change, on re-report (DISTINCT collapses repeats), and on hard delete (`pet_repository.go` does `Delete(&domain.Pet{})` — a hard delete; `reports` cascade with the pet). Confirmed in code review.
- Therefore impact numbers must come from an append-only ledger that has **no FK to pets**, so deleting a pet leaves the event row intact.
- The ledger is written **synchronously in the request path**, never through `event.EventBus` — that bus runs handlers in detached goroutines with `recover()` and no retry, so a failure is silently lost (the same root cause that makes embeddings go missing). Synchronous writes are best-effort + logged, but vastly more reliable for a vanity counter.
- `pets_reunited` counts DISTINCT `pet_id` (a pet found twice is one reunited pet). `searches_started` counts every row (a pet lost twice is two searches).

## File Structure

**Backend — create:**
- `backend/internal/domain/platform_event.go` — `PlatformEvent` model + event-type constants
- `backend/internal/repository/platform_event_repository.go` — `StatEventRepository` interface + GORM impl (`Record`)
- `backend/cmd/backfill-stats/main.go` — one-off baseline backfill
- `backend/tests/platform_event_repository_test.go` — repo test
- `backend/tests/stat_events_flow_test.go` — service-level event-recording + survives-delete test

**Backend — modify:**
- `backend/internal/service/pet_service.go` — add `statEvents` dep + `recordStat` helper + 5 call sites
- `backend/internal/handler/stats_handler.go` — query the ledger; drop `total_pets`
- `backend/internal/app/router.go:88,106` — construct the repo, pass to `NewPetService`
- `backend/pkg/database/postgres.go` — add `&domain.PlatformEvent{}` to AutoMigrate
- `backend/tests/stats_handler_test.go` — update expectations

**Frontend — modify:**
- `frontend/packages/shared/types/index.ts` — `Stats` interface
- `frontend/packages/web/src/pages/HomePage.tsx` — cards + threshold gate
- `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — `home.stats.*` keys
- `frontend/packages/web/src/pages/HomePage.test.tsx` — card visibility tests (create if absent)

---

## Task 1: PlatformEvent domain model + event-type constants

**Files:**
- Create: `backend/internal/domain/platform_event.go`

- [ ] **Step 1: Write the model and constants**

```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Stat event type values for the append-only platform_events ledger.
const (
	// StatEventPetFound is recorded every time a pet transitions into "found".
	// pets_reunited counts DISTINCT pet_id over these rows.
	StatEventPetFound = "pet_found"
	// StatEventSearchStarted is recorded every time a new lost/stray search is
	// opened (publish-lost, stray creation, or a registered->lost edit).
	// searches_started counts every row.
	StatEventSearchStarted = "search_started"
)

// PlatformEvent is an append-only impact-metrics ledger entry. It deliberately
// has NO foreign key to pets: deleting a pet must NOT remove its history, so the
// lifetime counters never decrease. PetID is a plain value (nullable) used only
// to deduplicate pets_reunited; it is never joined back to the pets table.
type PlatformEvent struct {
	ID        uuid.UUID  `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	EventType string     `gorm:"type:varchar(50);not null;index" json:"event_type"`
	PetID     *uuid.UUID `gorm:"type:uuid;index" json:"pet_id,omitempty"`
	CreatedAt time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

// TableName pins the table name (GORM would otherwise pluralize to
// "platform_events", which is what we want, but pin it to be explicit).
func (PlatformEvent) TableName() string { return "platform_events" }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && go build ./internal/domain/...`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/domain/platform_event.go
git commit -m "feat(stats): add append-only PlatformEvent ledger model"
```

---

## Task 2: StatEventRepository (write path)

**Files:**
- Create: `backend/internal/repository/platform_event_repository.go`
- Test: `backend/tests/platform_event_repository_test.go`

- [ ] **Step 1: Write the failing test**

```go
package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestStatEventRepository_RecordAndCount(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	repo := repository.NewStatEventRepository(gormDB)
	ctx := context.Background()

	petA := uuid.New()
	petB := uuid.New()

	// Same pet found twice -> distinct = 1; searches counted per row.
	if err := repo.Record(ctx, domain.StatEventPetFound, &petA); err != nil {
		t.Fatalf("record found A #1: %v", err)
	}
	if err := repo.Record(ctx, domain.StatEventPetFound, &petA); err != nil {
		t.Fatalf("record found A #2: %v", err)
	}
	if err := repo.Record(ctx, domain.StatEventPetFound, &petB); err != nil {
		t.Fatalf("record found B: %v", err)
	}
	if err := repo.Record(ctx, domain.StatEventSearchStarted, &petA); err != nil {
		t.Fatalf("record search A: %v", err)
	}

	reunited, err := repo.CountDistinctPets(ctx, domain.StatEventPetFound)
	if err != nil {
		t.Fatalf("count distinct: %v", err)
	}
	if reunited != 2 {
		t.Errorf("pets_reunited: want 2 distinct, got %d", reunited)
	}

	searches, err := repo.CountByType(ctx, domain.StatEventSearchStarted)
	if err != nil {
		t.Fatalf("count by type: %v", err)
	}
	if searches != 1 {
		t.Errorf("searches_started: want 1, got %d", searches)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && go test ./tests/ -run TestStatEventRepository_RecordAndCount`
Expected: FAIL — `undefined: repository.NewStatEventRepository`.

- [ ] **Step 3: Write the implementation**

```go
package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// StatEventRepository writes and counts append-only impact-metric events.
type StatEventRepository interface {
	// Record appends one event. petID may be nil for events not tied to a pet.
	Record(ctx context.Context, eventType string, petID *uuid.UUID) error
	// CountByType returns the total number of rows of the given type.
	CountByType(ctx context.Context, eventType string) (int64, error)
	// CountDistinctPets returns the number of distinct non-null pet_id values
	// for the given type.
	CountDistinctPets(ctx context.Context, eventType string) (int64, error)
}

type statEventRepository struct {
	db *gorm.DB
}

func NewStatEventRepository(db *gorm.DB) StatEventRepository {
	return &statEventRepository{db: db}
}

func (r *statEventRepository) Record(ctx context.Context, eventType string, petID *uuid.UUID) error {
	return r.db.WithContext(ctx).Create(&domain.PlatformEvent{
		EventType: eventType,
		PetID:     petID,
	}).Error
}

func (r *statEventRepository) CountByType(ctx context.Context, eventType string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.PlatformEvent{}).
		Where("event_type = ?", eventType).Count(&n).Error
	return n, err
}

func (r *statEventRepository) CountDistinctPets(ctx context.Context, eventType string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.PlatformEvent{}).
		Where("event_type = ? AND pet_id IS NOT NULL", eventType).
		Distinct("pet_id").Count(&n).Error
	return n, err
}
```

- [ ] **Step 4: Register the model in AutoMigrate so the test DB creates the table**

Modify `backend/pkg/database/postgres.go`: find the `AutoMigrate(` call listing the models and add `&domain.PlatformEvent{},` to the list (place it alongside the other models, e.g. right after `&domain.Report{},`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestStatEventRepository_RecordAndCount`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/platform_event_repository.go backend/pkg/database/postgres.go backend/tests/platform_event_repository_test.go
git commit -m "feat(stats): add StatEventRepository and migrate platform_events"
```

---

## Task 3: Wire the repo into petService and record events at every transition

**Files:**
- Modify: `backend/internal/service/pet_service.go` (struct lines 33-39, constructor line 48, call sites at CreatePet ~138, UpdatePet ~239 and ~248, MarkAsFound ~347, PublishLost ~429)
- Modify: `backend/internal/app/router.go:88,106`
- Test: `backend/tests/stat_events_flow_test.go`

- [ ] **Step 1: Add the dependency to the struct and constructor**

In `pet_service.go`, change the struct (currently lines 33-39):

```go
type petService struct {
	repo         repository.PetRepository
	eventBus     *event.EventBus
	photoService PhotoService
	reportRepo   repository.ReportRepository
	uow          repository.UnitOfWork
	statEvents   repository.StatEventRepository
}
```

And the constructor (currently line 48):

```go
func NewPetService(repo repository.PetRepository, eventBus *event.EventBus, photoService PhotoService, reportRepo repository.ReportRepository, uow repository.UnitOfWork, statEvents repository.StatEventRepository) PetService {
	return &petService{repo: repo, eventBus: eventBus, photoService: photoService, reportRepo: reportRepo, uow: uow, statEvents: statEvents}
}
```

- [ ] **Step 2: Add the `recordStat` helper near the top of the service methods**

Add this method to `pet_service.go` (anywhere among the methods, e.g. right after `NewPetService`):

```go
// recordStat appends a lifetime impact event synchronously, in-request.
// Best-effort: a failure is logged but never aborts the operation the event
// describes (the status change already succeeded). It deliberately does NOT go
// through the EventBus, whose fire-and-forget handlers drop failures silently.
func (s *petService) recordStat(eventType string, petID uuid.UUID) {
	if s.statEvents == nil {
		return
	}
	id := petID
	if err := s.statEvents.Record(context.Background(), eventType, &id); err != nil {
		log.Printf("[pet_service] recordStat %s pet=%s: %v", eventType, petID, err)
	}
}
```

Ensure `"context"` is imported in `pet_service.go` (add it if missing).

- [ ] **Step 3: Record `search_started` in CreatePet (stray path)**

In `CreatePet`, the stray branch publishes `pet.stray` (around line 150). Immediately after the `if err := s.uow.Execute(...)` block returns success for the stray branch (i.e. right after line 141 `}` that closes the error check, still inside `if status == domain.PetStatusStray`), add:

```go
		s.recordStat(domain.StatEventSearchStarted, pet.ID)
```

- [ ] **Step 4: Record events in UpdatePet (lost and found transitions)**

In `UpdatePet`, after the existing `pet.lost` publish block (currently ends ~line 241), add:

```go
	if oldStatus != domain.PetStatusLost && pet.Status == domain.PetStatusLost {
		s.recordStat(domain.StatEventSearchStarted, pet.ID)
	}
```

And after the existing `pet.found` publish block (currently ends ~line 258), add:

```go
	if oldStatus != domain.PetStatusFound && pet.Status == domain.PetStatusFound {
		s.recordStat(domain.StatEventPetFound, pet.ID)
	}
```

- [ ] **Step 5: Record `pet_found` in MarkAsFound**

In `MarkAsFound`, after the `pet.found` EventBus publish block (currently ends ~line 382, before `return pet, nil`), add:

```go
	s.recordStat(domain.StatEventPetFound, pet.ID)
```

- [ ] **Step 6: Record `search_started` in PublishLost**

In `PublishLost`, after the `s.uow.Execute` block returns success and the `pet.lost` events are published (after line 451, before `return pet, nil`), add:

```go
	s.recordStat(domain.StatEventSearchStarted, pet.ID)
```

- [ ] **Step 7: Update the DI wiring**

In `router.go`, after line 88 (`reportRepo := repository.NewReportRepository(db)`), add:

```go
	statEventRepo := repository.NewStatEventRepository(db)
```

Change line 106 to pass it:

```go
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo, petUow, statEventRepo)
```

- [ ] **Step 8: Fix every other NewPetService caller (tests)**

Run: `cd backend && grep -rn "NewPetService(" --include=*.go | grep -v "func NewPetService"`
For each caller (test files), add a `repository.NewStatEventRepository(gormDB)` argument (or `nil` where the test does not exercise stats — `recordStat` is nil-safe).

- [ ] **Step 9: Write the flow test (records on transition, survives delete)**

Create `backend/tests/stat_events_flow_test.go`:

```go
package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

func TestPublishLostThenFound_RecordsLifetimeEvents_SurvivesDelete(t *testing.T) {
	db := testdb.SetupTestDB(t)
	ctx := context.Background()

	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	statRepo := repository.NewStatEventRepository(db)
	uow := repository.NewUnitOfWork(db) // use the project's UoW constructor
	svc := service.NewPetService(petRepo, nil, nil, reportRepo, uow, statRepo)

	owner := uuid.New()
	// Seed an owning user row if the FK requires it; otherwise create the pet directly.
	pet := &domain.Pet{OwnerID: &owner, Name: "Repro", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	if _, err := svc.PublishLost(owner.String(), pet.ID.String(), dtoPublishLost()); err != nil {
		t.Fatalf("publish lost: %v", err)
	}
	if _, err := svc.MarkAsFound(owner.String(), pet.ID.String()); err != nil {
		t.Fatalf("mark found: %v", err)
	}

	searches, _ := statRepo.CountByType(ctx, domain.StatEventSearchStarted)
	reunited, _ := statRepo.CountDistinctPets(ctx, domain.StatEventPetFound)
	if searches != 1 || reunited != 1 {
		t.Fatalf("after publish+found: searches=%d reunited=%d, want 1/1", searches, reunited)
	}

	// Hard-delete the pet — lifetime counters must NOT change.
	if err := petRepo.Delete(pet.ID.String()); err != nil {
		t.Fatalf("delete pet: %v", err)
	}
	searches2, _ := statRepo.CountByType(ctx, domain.StatEventSearchStarted)
	reunited2, _ := statRepo.CountDistinctPets(ctx, domain.StatEventPetFound)
	if searches2 != 1 || reunited2 != 1 {
		t.Errorf("after delete: searches=%d reunited=%d, want unchanged 1/1", searches2, reunited2)
	}
}
```

NOTE: replace `dtoPublishLost()` with the project's `dto.PublishLostRequest{Latitude: -34.9, Longitude: -56.1, Note: "x"}` literal, and `repository.NewUnitOfWork(db)` / `svc.MarkAsFound` with the exact constructor/method names in the codebase (grep `func NewUnitOfWork` and `MarkAsFound` / `MarkPetAsFound`). If `MarkAsFound` requires a user that owns the pet, seed a `domain.User{ID: owner}` first via `repository.NewUserRepository(db)`.

- [ ] **Step 10: Run the flow test**

Run: `cd backend && go test ./tests/ -run TestPublishLostThenFound_RecordsLifetimeEvents_SurvivesDelete`
Expected: PASS.

- [ ] **Step 11: Build everything**

Run: `cd backend && go build ./...`
Expected: success.

- [ ] **Step 12: Commit**

```bash
git add backend/internal/service/pet_service.go backend/internal/app/router.go backend/tests/stat_events_flow_test.go backend/tests/
git commit -m "feat(stats): record lifetime impact events at every lost/found transition"
```

---

## Task 4: Stats handler returns lifetime + snapshot numbers

**Files:**
- Modify: `backend/internal/handler/stats_handler.go`
- Test: `backend/tests/stats_handler_test.go`

The response keeps the two snapshot keys (`total_users`, `total_pets`) and replaces the old `total_reports`/`found_pets` with the two lifetime keys (`pets_reunited`, `searches_started`).

- [ ] **Step 1: Update the failing handler test first**

In `stats_handler_test.go`, update the success-case assertions to expect the new JSON shape: keys `pets_reunited`, `searches_started`, `total_users`, `total_pets`; and assert `total_reports` and `found_pets` are absent. Seed the test DB with: one user, one pet, and `platform_events` rows (two `pet_found` for the same petA, one `search_started`). Then assert `pets_reunited == 1` (distinct), `searches_started == 1`, `total_users == 1`, `total_pets == 1`. (Mirror the existing setup in this file; it already wires a gorm DB.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && go test ./tests/ -run TestStatsHandler`
Expected: FAIL (handler still returns old keys).

- [ ] **Step 3: Rewrite the handler body**

Replace `GetStats` in `stats_handler.go` with:

```go
// GetStats godoc
// GET /api/stats
func (h *StatsHandler) GetStats(c *gin.Context) {
	var totalUsers, totalPets, petsReunited, searchesStarted int64

	// Snapshot numbers — honest "size right now". They may dip when an account
	// or pet is deleted, which is correct: a deleted member is not a member.
	if err := h.db.Model(&domain.User{}).Count(&totalUsers).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}
	if err := h.db.Model(&domain.Pet{}).Count(&totalPets).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	// Lifetime impact numbers come from the append-only platform_events ledger,
	// NOT from COUNT() over pets/reports — those decrease on status changes and
	// hard deletes. pets_reunited counts distinct pets ever marked found;
	// searches_started counts every lost/stray search opened.
	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ? AND pet_id IS NOT NULL", domain.StatEventPetFound).
		Distinct("pet_id").Count(&petsReunited).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	if err := h.db.Model(&domain.PlatformEvent{}).
		Where("event_type = ?", domain.StatEventSearchStarted).
		Count(&searchesStarted).Error; err != nil {
		writeError(c, http.StatusServiceUnavailable, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"total_users":      totalUsers,
		"total_pets":       totalPets,
		"pets_reunited":    petsReunited,
		"searches_started": searchesStarted,
	})
}
```

- [ ] **Step 4: Run the handler test**

Run: `cd backend && go test ./tests/ -run TestStatsHandler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/stats_handler.go backend/tests/stats_handler_test.go
git commit -m "feat(stats): serve lifetime pets_reunited + searches_started alongside snapshot counts"
```

---

## Task 5: One-off backfill command (baseline from existing data)

**Files:**
- Create: `backend/cmd/backfill-stats/main.go`

- [ ] **Step 1: Write the command**

```go
// Command backfill-stats seeds a one-time baseline into the platform_events
// ledger from pre-existing data, because the ledger only started being written
// when this feature shipped. It is idempotent: it does nothing if the ledger
// already has rows. Run once after deploy:
//   DATABASE_URL=... go run ./cmd/backfill-stats
//
// Baseline heuristic (an approximation of un-logged history):
//   - pet_found:     one event per pet currently in status 'found'.
//   - search_started: one event per report with status 'lost' (publish-lost),
//                     plus one per pet currently in status 'stray'.
// Going forward the counters are exact; this only seeds the starting point.
package main

import (
	"context"
	"log"

	"lost-pets/config"
	"lost-pets/internal/domain"
	"lost-pets/pkg/database"
)

func main() {
	cfg := config.Load()
	db, err := database.Connect(cfg)
	if err != nil {
		log.Fatalf("backfill-stats: db connect: %v", err)
	}

	var existing int64
	if err := db.Model(&domain.PlatformEvent{}).Count(&existing).Error; err != nil {
		log.Fatalf("backfill-stats: count existing: %v", err)
	}
	if existing > 0 {
		log.Printf("backfill-stats: platform_events already has %d rows — skipping", existing)
		return
	}

	_ = context.Background()

	// pet_found baseline
	if err := db.Exec(`
		INSERT INTO platform_events (id, event_type, pet_id, created_at)
		SELECT gen_random_uuid(), ?, id, now()
		FROM pets WHERE status = ?`,
		domain.StatEventPetFound, domain.PetStatusFound).Error; err != nil {
		log.Fatalf("backfill-stats: pet_found: %v", err)
	}

	// search_started baseline: publish-lost reports
	if err := db.Exec(`
		INSERT INTO platform_events (id, event_type, pet_id, created_at)
		SELECT gen_random_uuid(), ?, pet_id, COALESCE(created_at, now())
		FROM reports WHERE status = ?`,
		domain.StatEventSearchStarted, "lost").Error; err != nil {
		log.Fatalf("backfill-stats: search_started (lost reports): %v", err)
	}

	// search_started baseline: current strays
	if err := db.Exec(`
		INSERT INTO platform_events (id, event_type, pet_id, created_at)
		SELECT gen_random_uuid(), ?, id, now()
		FROM pets WHERE status = ?`,
		domain.StatEventSearchStarted, domain.PetStatusStray).Error; err != nil {
		log.Fatalf("backfill-stats: search_started (strays): %v", err)
	}

	var n int64
	db.Model(&domain.PlatformEvent{}).Count(&n)
	log.Printf("backfill-stats: done — platform_events now has %d rows", n)
}
```

NOTE: confirm the exact names `config.Load()` and `database.Connect(cfg)` against an existing command (e.g. `backend/cmd/seed/main.go` or `cmd/promote-admin`); match whatever those use.

- [ ] **Step 2: Verify it builds**

Run: `cd backend && go build ./cmd/backfill-stats`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/backfill-stats/main.go
git commit -m "feat(stats): add one-off backfill-stats baseline command"
```

---

## Task 6: Frontend — Stats type

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`

- [ ] **Step 1: Update the Stats interface**

Find the `Stats` interface and replace its body with:

```ts
export interface Stats {
  total_users: number;
  total_pets: number;
  pets_reunited: number;
  searches_started: number;
}
```

(Keep `total_users` and `total_pets`; remove `total_reports` and `found_pets`, add `pets_reunited` and `searches_started`.)

- [ ] **Step 2: Verify the web build type-checks (will fail at HomePage — expected, fixed in Task 7)**

Run: `cd frontend/packages/web && pnpm build`
Expected: type errors in `HomePage.tsx` referencing the removed fields. That is expected — Task 7 fixes them.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/shared/types/index.ts
git commit -m "feat(stats): update shared Stats type to lifetime metrics"
```

---

## Task 7: Frontend — HomePage cards (4 counters)

**Files:**
- Modify: `frontend/packages/web/src/pages/HomePage.tsx` (stats cards, ~lines 330-349)

- [ ] **Step 1: Relabel/repoint the four stat cards**

The section keeps four cards. Two are lifetime, two are snapshot — all always shown:
- "Pets reunited" card → `{stats?.pets_reunited || 0}` with label `t('home:stats.reunited')`
- "Searches started" card → `{stats?.searches_started || 0}` with label `t('home:stats.searches')`
- "Members" card → `{stats?.total_users || 0}` with label `t('home:stats.members')` (always shown)
- "Pets registered" card → `{stats?.total_pets || 0}` with label `t('home:stats.registered')` (always shown)

Example (adapt class names to the existing markup in this file):

```tsx
<div className="...existing grid wrapper...">
  <div>
    <p className="text-3xl font-bold text-primary">{stats?.pets_reunited || 0}</p>
    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.reunited')}</p>
  </div>
  <div>
    <p className="text-3xl font-bold text-primary">{stats?.searches_started || 0}</p>
    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.searches')}</p>
  </div>
  <div>
    <p className="text-3xl font-bold text-primary">{stats?.total_users || 0}</p>
    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.members')}</p>
  </div>
  <div>
    <p className="text-3xl font-bold text-primary">{stats?.total_pets || 0}</p>
    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('home:stats.registered')}</p>
  </div>
</div>
```

- [ ] **Step 2: Verify the build type-checks**

Run: `cd frontend/packages/web && pnpm build`
Expected: success (no references to removed fields).

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/pages/HomePage.tsx
git commit -m "feat(stats): relabel home counters to reunited/searches/members/registered"
```

---

## Task 8: Frontend — i18n labels (es/en/pt)

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/es.json`, `en.json`, `pt.json`

- [ ] **Step 1: Update the `home.stats` keys in all three locales**

In each file, inside the `home` namespace's `stats` object, ensure these four keys exist (replace `found`/`reports`/`pets`/`users`):

`es.json`:
```json
"stats": {
  "reunited": "Mascotas reencontradas",
  "searches": "Búsquedas iniciadas",
  "members": "Miembros de la comunidad",
  "registered": "Mascotas registradas"
}
```

`en.json`:
```json
"stats": {
  "reunited": "Pets reunited",
  "searches": "Searches started",
  "members": "Community members",
  "registered": "Pets registered"
}
```

`pt.json`:
```json
"stats": {
  "reunited": "Pets reencontrados",
  "searches": "Buscas iniciadas",
  "members": "Membros da comunidade",
  "registered": "Pets cadastrados"
}
```

Remove now-unused keys (`stats.found`, `stats.reports`, `stats.pets`, `stats.users`) if nothing else references them — grep first: `cd frontend/packages/web && grep -rn "home:stats\." src/`.

- [ ] **Step 2: Validate JSON**

Run: `cd frontend/packages/web && node -e "['es','en','pt'].forEach(l=>require('./src/i18n/locales/'+l+'.json'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/i18n/locales/
git commit -m "feat(stats): i18n labels for reunited/searches/members (es/en/pt)"
```

---

## Task 9: Frontend — HomePage stat-card rendering test

**Files:**
- Modify or create: `frontend/packages/web/src/pages/HomePage.test.tsx`

- [ ] **Step 1: Write the test**

Mock `@shared/hooks` so `useStats` returns a controlled value (and stub the other hooks HomePage uses — `useSearchPets`, `useStories`, `useImageClassify`, `useImageSearch` — returning empty/no-op, matching the existing mock pattern in sibling tests). Mock `react-i18next` `t` to return the key. Then:

```tsx
it('renders the four stat counters with their values', () => {
  mockStats = { total_users: 150, total_pets: 320, pets_reunited: 42, searches_started: 88 };
  render(<HomePage />, { wrapper });

  expect(screen.getByText('home:stats.reunited')).toBeTruthy();
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.getByText('home:stats.searches')).toBeTruthy();
  expect(screen.getByText('88')).toBeTruthy();
  expect(screen.getByText('home:stats.members')).toBeTruthy();
  expect(screen.getByText('150')).toBeTruthy();
  expect(screen.getByText('home:stats.registered')).toBeTruthy();
  expect(screen.getByText('320')).toBeTruthy();
});
```

(If `HomePage.test.tsx` already exists, add this case and reuse its existing mocks/wrapper. If creating it, copy the mock/wrapper scaffolding from `AbuseReportsPage.test.tsx`.)

- [ ] **Step 2: Run the test**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/HomePage.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/pages/HomePage.test.tsx
git commit -m "test(stats): cover the four home stat counters render"
```

---

## Task 10: Full verification

- [ ] **Step 1: Backend tests + build**

Run: `cd backend && go build ./... && go test ./...`
Expected: all pass. (If running against a dev DB, re-seed afterward — integration tests truncate tables.)

- [ ] **Step 2: Web + shared tests + build**

Run: `cd frontend/packages/web && pnpm test:run && pnpm build`
Expected: all pass, build succeeds.

- [ ] **Step 3: Manual smoke (optional, local stack running)**

Publish a registered pet as lost, mark it found, hit `GET /api/stats` → `pets_reunited` and `searches_started` both incremented. Hard-delete the pet → those two stay the same, while `total_pets` drops by one (snapshot, expected). Confirm the homepage shows all four cards.

- [ ] **Step 4: Commit any fixups, then open the PR**

Use the `searchpet-pr` conventions. Note in the PR body: backend changed (`go test ./...` ran), web changed (`pnpm test:run`), and that `cmd/backfill-stats` must be run once post-deploy to seed the baseline.

---

## Self-Review notes

- **Spec coverage:** two lifetime counters (Tasks 1-5) ✅; two snapshot counters kept + shown (members, registered) (Tasks 4,6,7) ✅; survives delete for the lifetime ones (Task 3 test) ✅; snapshot ones intentionally reflect "now" and may dip (Task 4 handler comment) ✅; survives re-report/re-find via DISTINCT + per-row counts (Tasks 2,4) ✅; reliable in-request writes not via EventBus (Task 3 `recordStat`) ✅; backfill baseline (Task 5) ✅.
- **Method names to confirm against the codebase before coding:** `repository.NewUnitOfWork`, `MarkAsFound` (vs `MarkPetAsFound`), `config.Load`/`database.Connect`, and the AutoMigrate call site in `pkg/database/postgres.go`. These are flagged inline in the relevant tasks.
- **Open product choice (not blocking):** `searches_started` counts re-publishes of the same pet as separate searches (by design — a new search episode). If "distinct pets ever searched" is preferred instead, change Task 4's `searches_started` query to `Distinct("pet_id")` like `pets_reunited`.
