# Search Episodes — Map Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a minimal `search_episodes` entity so the global map (`FindNearby`) shows only the reports of each pet's CURRENT search episode, hiding stale pins from previously-resolved searches of the same pet.

**Architecture:** A pet gets a first-class search episode that OPENS on any transition into `lost`/`stray` and CLOSES (sets `ended_at` + `resolution`) on any transition out to `found`/`archived`/`registered`. Every report is stamped with the `episode_id` that was open when it was created. `pets.current_episode_id` denormalizes a pointer to the most-recently-opened episode so `FindNearby` can filter with a single equality (`reports.episode_id = pets.current_episode_id`). Episode open/close is orchestrated INLINE and TRANSACTIONALLY in the service layer — NOT via EventBus — because there are no events for `archived`/`registered` transitions and episode integrity is core data, not a side effect. A single `EpisodeService.HandleTransition(oldStatus, newStatus, petID)` centralizes the open-vs-close decision so each call site is a one-liner.

**Tech Stack:** Go 1.25 + Gin, GORM, PostgreSQL 15 + PostGIS, golang-migrate (SQL migrations), uuid.UUID keys. Integration tests hit a real Postgres (`lostpets_test`).

---

## Scope & Non-Goals

**In scope:**
- `search_episodes` table (`id`, `pet_id`, `started_at`, `ended_at`, `resolution`) + `reports.episode_id` FK + `pets.current_episode_id` FK.
- Open/close orchestration across ALL five transition paths.
- `FindNearby` filters to the current episode.
- A `ValidateTransition` guard added to `CreateReport`'s status-change paths (required for episode integrity — see Task 7).

**Explicitly NOT in scope (deferred until real requirements exist):**
- The public analytics dashboard (V2.1). We build only the load-bearing data model, no metrics/queries/UI.
- Historical episode reconstruction / backfill. There is no production data yet; the migration is schema-only. Existing local/seed pets in `lost`/`stray` will not appear on the map until they next transition into `lost`/`stray` (acceptable per product owner). Re-run `make db-reset` + seed, or re-publish the pet, to get an episode.
- `FindByPetID` (the pet-detail card timeline) stays UNCHANGED — the card keeps full cross-episode history.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/internal/domain/models.go` | `SearchEpisode` struct; add `EpisodeID` to `Report`, `CurrentEpisodeID` to `Pet` | Modify |
| `backend/internal/domain/episode.go` | Episode resolution constants + `IsActiveSearchStatus` helper | Create |
| `backend/migrations/000015_add_search_episodes.up.sql` / `.down.sql` | Table, columns, FKs, indexes | Create |
| `backend/pkg/database/postgres.go` | Register `SearchEpisode` in `Models` | Modify |
| `backend/tests/testdb/setup.go` | Register `search_episodes` in `allTableNames` (FK order) | Modify |
| `backend/internal/repository/interfaces.go` | `EpisodeRepository` interface | Modify |
| `backend/internal/repository/episode_repository.go` | `EpisodeRepository` GORM impl | Create |
| `backend/internal/repository/unit_of_work.go` | Add `Episodes` to `UnitOfWorkRepos` | Modify |
| `backend/internal/service/episode_service.go` | `EpisodeService.HandleTransition` + report stamping helper | Create |
| `backend/internal/service/pet_service.go` | Call `HandleTransition` at each transition; stamp reports | Modify |
| `backend/internal/service/report_service.go` | Inject episode service; validate transitions; stamp reports | Modify |
| `backend/internal/repository/report_repository.go` | `FindNearby` filters by current episode | Modify |
| `backend/internal/app/router.go` | Wire `EpisodeRepository` + `EpisodeService` | Modify |
| `backend/tests/episode_flow_test.go` | Integration tests for open/close + the re-lost map bug | Create |

---

## Conventions for the implementing engineer

- **IDs are `uuid.UUID`** everywhere (not strings) on the models. Repository methods that take an id use `string` (e.g. `UpdateStatus(id string, ...)`) — match the existing style of the neighbouring method.
- **Test command (Windows PowerShell — the product owner's environment):**
  ```powershell
  $env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
  go test ./tests/... -run <TestName> -v
  ```
  NOTE: the local Postgres is on host port **5433**, not 5432. NEVER point `DATABASE_URL` at `lostpets` (the dev DB) when running `go test` — the test cleanup TRUNCATEs every table and will wipe your seed data. Always use `lostpets_test`.
- **Unit tests** (no DB) run with `go test ./internal/...`.
- Commit after every green step. Conventional commits, no AI attribution (project rule).

---

### Task 1: Episode domain model & constants

**Files:**
- Create: `backend/internal/domain/episode.go`
- Modify: `backend/internal/domain/models.go` (add `SearchEpisode` struct; add fields to `Pet` and `Report`)
- Test: `backend/internal/domain/episode_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/domain/episode_test.go`:

```go
package domain_test

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestIsActiveSearchStatus(t *testing.T) {
	active := map[string]bool{
		domain.PetStatusLost:  true,
		domain.PetStatusStray: true,
	}
	all := []string{
		domain.PetStatusRegistered, domain.PetStatusLost, domain.PetStatusStray,
		domain.PetStatusFound, domain.PetStatusArchived,
	}
	for _, s := range all {
		if got := domain.IsActiveSearchStatus(s); got != active[s] {
			t.Errorf("IsActiveSearchStatus(%q) = %v, want %v", s, got, active[s])
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/domain/ -run TestIsActiveSearchStatus -v`
Expected: FAIL — `undefined: domain.IsActiveSearchStatus`

- [ ] **Step 3: Create `backend/internal/domain/episode.go`**

```go
package domain

// IsActiveSearchStatus reports whether a status represents an OPEN search —
// the states during which a search episode is active. Transitioning INTO one
// of these (from a non-active state) opens an episode; transitioning OUT of
// one closes it.
func IsActiveSearchStatus(status string) bool {
	return status == PetStatusLost || status == PetStatusStray
}
```

- [ ] **Step 4: Add the `SearchEpisode` struct and model fields**

In `backend/internal/domain/models.go`, add the `SearchEpisode` struct (place it immediately AFTER the `Report` struct, ~line 110):

```go
// SearchEpisode is one continuous search for a pet: it opens when the pet
// transitions into lost/stray and closes (ended_at + resolution) when it
// leaves that state. Reports created while an episode is open belong to it.
// The global map shows only the pet's CURRENT episode (pets.current_episode_id).
type SearchEpisode struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"pet_id"`
	StartedAt  time.Time  `gorm:"autoCreateTime;index" json:"started_at"`
	EndedAt    *time.Time `json:"ended_at,omitempty"`
	Resolution *string    `gorm:"size:50" json:"resolution,omitempty"`
}
```

Add `CurrentEpisodeID` to the `Pet` struct (after the `Version` field, ~line 78):

```go
	CurrentEpisodeID *uuid.UUID `gorm:"type:uuid;index" json:"current_episode_id,omitempty"`
```

Add `EpisodeID` to the `Report` struct (after the `PetID` field, ~line 96):

```go
	EpisodeID *uuid.UUID `gorm:"type:uuid;index" json:"episode_id,omitempty"`
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/domain/ -run TestIsActiveSearchStatus -v`
Expected: PASS

- [ ] **Step 6: Verify the whole domain package still compiles**

Run: `go build ./internal/domain/`
Expected: no output (success)

- [ ] **Step 7: Commit**

```bash
git add backend/internal/domain/episode.go backend/internal/domain/models.go backend/internal/domain/episode_test.go
git commit -m "feat(domain): add SearchEpisode model and episode status helper"
```

---

### Task 2: SQL migration for the schema

**Files:**
- Create: `backend/migrations/000015_add_search_episodes.up.sql`
- Create: `backend/migrations/000015_add_search_episodes.down.sql`
- Modify: `backend/pkg/database/postgres.go` (register model)
- Modify: `backend/tests/testdb/setup.go` (register table for truncation)

> AutoMigrate runs BEFORE the SQL migrations at startup (`main.go:31-40`). AutoMigrate will create the `search_episodes` table and the new columns from the struct tags, but it does NOT add FK constraints between `reports.episode_id`/`pets.current_episode_id` and `search_episodes`. The migration adds those FKs explicitly and is idempotent so it is safe whether AutoMigrate ran first or not.

- [ ] **Step 1: Create the up migration `backend/migrations/000015_add_search_episodes.up.sql`**

```sql
-- search_episodes: one continuous search per pet (opens on lost/stray, closes on resolution).
CREATE TABLE IF NOT EXISTS search_episodes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pet_id      uuid NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
    started_at  timestamptz NOT NULL DEFAULT now(),
    ended_at    timestamptz,
    resolution  varchar(50)
);

CREATE INDEX IF NOT EXISTS idx_search_episodes_pet_started
    ON search_episodes (pet_id, started_at DESC);

-- reports.episode_id: which episode a report belongs to. SET NULL on episode delete
-- so reports survive (consistent with the report_abuses FK pattern in 000014).
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS episode_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_reports_episode'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT fk_reports_episode
            FOREIGN KEY (episode_id) REFERENCES search_episodes (id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_episode_id ON reports (episode_id);

-- pets.current_episode_id: pointer to the most-recently-opened episode. Used by
-- FindNearby to show only the current episode's reports.
ALTER TABLE pets
    ADD COLUMN IF NOT EXISTS current_episode_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_pets_current_episode'
    ) THEN
        ALTER TABLE pets
            ADD CONSTRAINT fk_pets_current_episode
            FOREIGN KEY (current_episode_id) REFERENCES search_episodes (id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pets_current_episode_id ON pets (current_episode_id);
```

- [ ] **Step 2: Create the down migration `backend/migrations/000015_add_search_episodes.down.sql`**

```sql
ALTER TABLE pets DROP CONSTRAINT IF EXISTS fk_pets_current_episode;
DROP INDEX IF EXISTS idx_pets_current_episode_id;
ALTER TABLE pets DROP COLUMN IF EXISTS current_episode_id;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS fk_reports_episode;
DROP INDEX IF EXISTS idx_reports_episode_id;
ALTER TABLE reports DROP COLUMN IF EXISTS episode_id;

DROP INDEX IF EXISTS idx_search_episodes_pet_started;
DROP TABLE IF EXISTS search_episodes;
```

- [ ] **Step 3: Register the model in `backend/pkg/database/postgres.go`**

In the `Models` slice (~line 123), add `&domain.SearchEpisode{}` immediately BEFORE `&domain.Report{}` (so AutoMigrate creates the episodes table before anything references it):

```go
	&domain.User{},
	&domain.Pet{},
	&domain.SearchEpisode{},
	&domain.Report{},
```

- [ ] **Step 4: Register the table for test truncation in `backend/tests/testdb/setup.go`**

Find the `allTableNames` slice (~line 32). Add `"search_episodes"` in the correct reverse-FK truncation order. Because `reports.episode_id` and `pets.current_episode_id` reference `search_episodes`, and `search_episodes.pet_id` references `pets`, the truncation (children first) must list `reports` before `search_episodes` before `pets`. Place `"search_episodes"` AFTER `"reports"` and BEFORE `"pets"`:

```go
	"reports",
	"search_episodes",
	"pets",
```

> `truncateAll` uses `TRUNCATE ... RESTART IDENTITY CASCADE`, so exact ordering is forgiving, but keep children-before-parents for clarity.

- [ ] **Step 5: Verify migration applies against a scratch test DB**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestReportRepository_CreateAndGetByID -v
```
Expected: PASS — `SetupTestDB` runs AutoMigrate + all migrations including 000015 without error. (This existing test is a smoke check that the schema still builds.)

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/000015_add_search_episodes.up.sql backend/migrations/000015_add_search_episodes.down.sql backend/pkg/database/postgres.go backend/tests/testdb/setup.go
git commit -m "feat(db): add search_episodes table, reports.episode_id, pets.current_episode_id"
```

---

### Task 3: EpisodeRepository

**Files:**
- Modify: `backend/internal/repository/interfaces.go` (add `EpisodeRepository`)
- Create: `backend/internal/repository/episode_repository.go`
- Modify: `backend/internal/repository/unit_of_work.go` (expose `Episodes` in the UoW)
- Test: `backend/tests/episode_repository_test.go`

The repository has three operations:
- `Open(petID)` — insert a new open episode AND point `pets.current_episode_id` at it, atomically.
- `CloseCurrent(petID, resolution)` — set `ended_at`/`resolution` on the pet's currently-open episode (the one with `ended_at IS NULL`); no-op if none.
- `FindCurrent(petID)` — return the pet's most-recently-started episode (open or closed), or `nil`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/episode_repository_test.go`:

```go
package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestEpisodeRepository_OpenSetsCurrentAndCloseResolves(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	epRepo := repository.NewEpisodeRepository(db)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Fido",
		Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("create pet: %v", err)
	}

	ep, err := epRepo.Open(pet.ID.String())
	if err != nil {
		t.Fatalf("open episode: %v", err)
	}
	if ep.EndedAt != nil {
		t.Errorf("newly opened episode should have nil EndedAt")
	}

	// pets.current_episode_id must now point at ep
	reloaded, _ := petRepo.FindByID(pet.ID.String())
	if reloaded.CurrentEpisodeID == nil || *reloaded.CurrentEpisodeID != ep.ID {
		t.Fatalf("pet.CurrentEpisodeID = %v, want %v", reloaded.CurrentEpisodeID, ep.ID)
	}

	// FindCurrent returns the open episode
	cur, err := epRepo.FindCurrent(pet.ID.String())
	if err != nil {
		t.Fatalf("find current: %v", err)
	}
	if cur == nil || cur.ID != ep.ID {
		t.Fatalf("FindCurrent = %v, want %v", cur, ep.ID)
	}

	// Close resolves it
	if err := epRepo.CloseCurrent(pet.ID.String(), domain.PetStatusFound); err != nil {
		t.Fatalf("close: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.EndedAt == nil {
		t.Errorf("closed episode should have EndedAt set")
	}
	if cur.Resolution == nil || *cur.Resolution != domain.PetStatusFound {
		t.Errorf("resolution = %v, want %q", cur.Resolution, domain.PetStatusFound)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestEpisodeRepository_OpenSetsCurrentAndCloseResolves -v
```
Expected: FAIL — `undefined: repository.NewEpisodeRepository`

- [ ] **Step 3: Add the interface to `backend/internal/repository/interfaces.go`**

Add after the `ReportRepository` interface (~line 41):

```go
// EpisodeRepository manages search episodes (one continuous search per pet).
type EpisodeRepository interface {
	// Open inserts a new open episode and points pets.current_episode_id at it.
	Open(petID string) (*domain.SearchEpisode, error)
	// CloseCurrent sets ended_at=now and resolution on the pet's OPEN episode
	// (ended_at IS NULL). No-op if the pet has no open episode.
	CloseCurrent(petID string, resolution string) error
	// FindCurrent returns the pet's most-recently-started episode, or nil.
	FindCurrent(petID string) (*domain.SearchEpisode, error)
}
```

- [ ] **Step 4: Create `backend/internal/repository/episode_repository.go`**

```go
package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type PostgresEpisodeRepository struct {
	db *gorm.DB
}

func NewEpisodeRepository(db *gorm.DB) EpisodeRepository {
	return &PostgresEpisodeRepository{db: db}
}

// Open creates a new open episode and repoints pets.current_episode_id atomically.
func (r *PostgresEpisodeRepository) Open(petID string) (*domain.SearchEpisode, error) {
	pid, err := uuidFromString(petID)
	if err != nil {
		return nil, err
	}
	ep := &domain.SearchEpisode{PetID: pid}
	err = r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(ep).Error; err != nil {
			return err
		}
		return tx.Model(&domain.Pet{}).
			Where("id = ?", pid).
			Update("current_episode_id", ep.ID).Error
	})
	if err != nil {
		return nil, err
	}
	return ep, nil
}

// CloseCurrent resolves the pet's currently-open episode.
func (r *PostgresEpisodeRepository) CloseCurrent(petID string, resolution string) error {
	now := time.Now()
	return r.db.Model(&domain.SearchEpisode{}).
		Where("pet_id = ? AND ended_at IS NULL", petID).
		Updates(map[string]interface{}{"ended_at": now, "resolution": resolution}).Error
}

// FindCurrent returns the pet's most-recently-started episode (open or closed).
func (r *PostgresEpisodeRepository) FindCurrent(petID string) (*domain.SearchEpisode, error) {
	var ep domain.SearchEpisode
	err := r.db.Where("pet_id = ?", petID).
		Order("started_at DESC").
		First(&ep).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ep, nil
}
```

> `uuidFromString` helper: if it does not already exist in the `repository` package, add it to `episode_repository.go`:
> ```go
> import "github.com/google/uuid"
> func uuidFromString(s string) (uuid.UUID, error) { return uuid.Parse(s) }
> ```
> First check for an existing parse helper in the package (grep `uuid.Parse` under `backend/internal/repository/`) and reuse it if present to stay DRY.

- [ ] **Step 5: Expose `Episodes` in the Unit of Work — `backend/internal/repository/unit_of_work.go`**

Add `Episodes EpisodeRepository` to the `UnitOfWorkRepos` struct (~line 10-13):

```go
type UnitOfWorkRepos struct {
	Pets     PetRepository
	Reports  ReportRepository
	Episodes EpisodeRepository
}
```

Then in the `Execute` implementation where the tx-scoped repos are constructed, add:

```go
		Episodes: NewEpisodeRepository(tx),
```

alongside the existing `Pets: NewPetRepository(tx)` / `Reports: NewReportRepository(tx)` lines. (Open a `unit_of_work.go` read first to match the exact construction site.)

- [ ] **Step 6: Run test to verify it passes**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestEpisodeRepository_OpenSetsCurrentAndCloseResolves -v
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/episode_repository.go backend/internal/repository/unit_of_work.go backend/tests/episode_repository_test.go
git commit -m "feat(repo): add EpisodeRepository (open/close/find current) + UoW wiring"
```

---

### Task 4: EpisodeService.HandleTransition (the orchestration brain)

**Files:**
- Create: `backend/internal/service/episode_service.go`
- Test: `backend/tests/episode_service_test.go`

`HandleTransition(petID, oldStatus, newStatus)` centralizes the decision:
- OPEN when entering active search: `!IsActiveSearchStatus(old) && IsActiveSearchStatus(new)`.
- CLOSE when leaving active search: `IsActiveSearchStatus(old) && !IsActiveSearchStatus(new)` → resolution = `new`.
- Otherwise no-op (e.g. `found → archived`: old `found` is not active, so no close is triggered — the episode was already closed at `lost → found`; `CloseCurrent` is also idempotent as a second guard).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/episode_service_test.go`:

```go
package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

func TestEpisodeService_HandleTransition_OpensAndCloses(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	epRepo := repository.NewEpisodeRepository(db)
	svc := service.NewEpisodeService(epRepo)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Fido",
		Type: "perro", Status: domain.PetStatusRegistered}
	petRepo.Create(pet)

	// registered -> lost : opens
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusRegistered, domain.PetStatusLost); err != nil {
		t.Fatalf("open transition: %v", err)
	}
	cur, _ := epRepo.FindCurrent(pet.ID.String())
	if cur == nil || cur.EndedAt != nil {
		t.Fatalf("expected one open episode, got %#v", cur)
	}
	firstEpisode := cur.ID

	// lost -> found : closes with resolution=found
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusLost, domain.PetStatusFound); err != nil {
		t.Fatalf("close transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.EndedAt == nil || cur.Resolution == nil || *cur.Resolution != domain.PetStatusFound {
		t.Fatalf("expected closed found episode, got %#v", cur)
	}

	// found -> archived : no-op (no new episode, still same closed one)
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusFound, domain.PetStatusArchived); err != nil {
		t.Fatalf("noop transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID != firstEpisode {
		t.Fatalf("found->archived must not create a new episode")
	}

	// archived -> lost (re-lost) : opens a SECOND episode
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusArchived, domain.PetStatusLost); err != nil {
		t.Fatalf("re-lost transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID == firstEpisode || cur.EndedAt != nil {
		t.Fatalf("re-lost must open a new open episode, got %#v", cur)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestEpisodeService_HandleTransition_OpensAndCloses -v
```
Expected: FAIL — `undefined: service.NewEpisodeService`

- [ ] **Step 3: Create `backend/internal/service/episode_service.go`**

```go
package service

import (
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// EpisodeService centralizes the open/close decision for search episodes so
// every pet-status transition site is a single call. Runs inline with the
// status change (NOT via EventBus) because there are no events for archived/
// registered transitions and episode integrity is core data.
type EpisodeService interface {
	// HandleTransition opens an episode when the pet enters an active search
	// (lost/stray) from a non-active state, and closes the current episode when
	// it leaves an active search. No-op otherwise. Idempotent on repeats.
	HandleTransition(petID, oldStatus, newStatus string) error
}

type episodeService struct {
	episodeRepo repository.EpisodeRepository
}

func NewEpisodeService(episodeRepo repository.EpisodeRepository) EpisodeService {
	return &episodeService{episodeRepo: episodeRepo}
}

func (s *episodeService) HandleTransition(petID, oldStatus, newStatus string) error {
	wasActive := domain.IsActiveSearchStatus(oldStatus)
	isActive := domain.IsActiveSearchStatus(newStatus)

	switch {
	case !wasActive && isActive:
		_, err := s.episodeRepo.Open(petID)
		return err
	case wasActive && !isActive:
		return s.episodeRepo.CloseCurrent(petID, newStatus)
	default:
		return nil
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestEpisodeService_HandleTransition_OpensAndCloses -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/episode_service.go backend/tests/episode_service_test.go
git commit -m "feat(service): add EpisodeService.HandleTransition open/close orchestration"
```

---

### Task 5: Wire episode handling into pet_service transitions

**Files:**
- Modify: `backend/internal/service/pet_service.go` (constructor + `CreatePet`, `UpdatePet`, `PublishLost`, `MarkAsFound`)

`petService` gains an `episodes EpisodeService` dependency. At each transition point, after the status is persisted, call `HandleTransition(petID, oldStatus, newStatus)`. For report-creating paths, stamp the report with the pet's current episode.

> **Ordering rule for report stamping:** open the episode FIRST (so `pets.current_episode_id` is set), then read `current_episode_id` and stamp the report. In UoW paths, do both inside the transaction using `tx.Episodes` / `tx.Reports`.

- [ ] **Step 1: Add the dependency to the constructor**

In `pet_service.go`, add `episodes EpisodeService` to the `petService` struct and to `NewPetService`'s parameter list + assignment. New signature:

```go
func NewPetService(
	repo repository.PetRepository,
	bus event.Bus,
	photoService PhotoService,
	reportRepo repository.ReportRepository,
	uow repository.UnitOfWork,
	statEventRepo repository.StatEventRepository,
	episodes EpisodeService,
) PetService {
```

(Match the existing constructor's exact parameter names/types by reading the current definition first.)

- [ ] **Step 2: `UpdatePet` — handle transition after `repo.Update(pet)`**

In `UpdatePet`, `oldStatus` is already captured (line ~222). After `s.repo.Update(pet)` succeeds (line ~252) and BEFORE the event publishes, add:

```go
	if req.Status != "" && req.Status != oldStatus {
		if err := s.episodes.HandleTransition(pet.ID.String(), oldStatus, pet.Status); err != nil {
			return nil, err
		}
	}
```

- [ ] **Step 3: `MarkAsFound` — close the episode and stamp the closure report**

In `MarkAsFound`, capture `oldStatus := pet.Status` before `UpdateStatus`. After `s.repo.UpdateStatus(petID, PetStatusFound)` (line ~375) and BEFORE building the closure report, stamp the closure report with the current episode and close:

```go
	oldStatus := pet.Status
	// ... existing UpdateStatus(found) ...
	// Stamp the closure report with the pet's current episode BEFORE closing it
	// (CloseCurrent does not clear current_episode_id, so ordering is not critical,
	// but read it explicitly for the report).
	if cur, err := s.episodeRepo.FindCurrent(petID); err == nil && cur != nil {
		closureReport.EpisodeID = &cur.ID
	}
	if err := s.episodes.HandleTransition(petID, oldStatus, domain.PetStatusFound); err != nil {
		return nil, err
	}
```

> `MarkAsFound` already has `s.reportRepo` injected; it needs read access to the current episode. Inject `episodeRepo repository.EpisodeRepository` into `petService` as well (add to struct + constructor) OR add a `FindCurrent`-style read via the existing `s.episodes` service by extending its interface. Simplest: inject `episodeRepo` into `petService` (constructor already being edited in Step 1 — add `episodeRepo repository.EpisodeRepository` too) and use it for the stamp read.

- [ ] **Step 4: `PublishLost` — open episode inside the UoW and stamp the report**

`PublishLost` already runs in `s.uow.Execute`. Inside the transaction, AFTER `tx.Pets.UpdateStatus(petID, PetStatusLost)` and BEFORE `tx.Reports.Create(report)`, open the episode and stamp the report:

```go
	err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.UpdateStatus(petID, domain.PetStatusLost); err != nil {
			return err
		}
		ep, err := tx.Episodes.Open(petID)
		if err != nil {
			return err
		}
		report.EpisodeID = &ep.ID
		return tx.Reports.Create(report)
	})
```

(Adapt to the existing variable names in `PublishLost`; the key is: `UpdateStatus` → `Episodes.Open` → stamp → `Reports.Create`, all inside the one transaction.)

- [ ] **Step 5: `CreatePet` (stray) — open episode inside the UoW and stamp the initial report**

`CreatePet`'s stray path already runs in `s.uow.Execute` (creates pet then report). Modify that transaction to open the episode after the pet is created and stamp the report:

```go
	err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.Create(pet); err != nil {
			return err
		}
		ep, err := tx.Episodes.Open(pet.ID.String())
		if err != nil {
			return err
		}
		report.EpisodeID = &ep.ID
		return tx.Reports.Create(report)
	})
```

- [ ] **Step 6: Compile**

Run: `go build ./...`
Expected: FAILS at the call sites in `router.go`/wire until Task 6 injects the new dependency. That is expected — Task 6 fixes wiring. To verify THIS file compiles in isolation, run `go vet ./internal/service/` and confirm the only errors are the constructor-arity mismatches in the app package (not within pet_service.go itself).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/service/pet_service.go
git commit -m "feat(service): open/close search episodes across pet_service transitions"
```

---

### Task 6: Wire episode handling into report_service + fix the ValidateTransition bypass

**Files:**
- Modify: `backend/internal/service/report_service.go`

`CreateReport` currently calls `petRepo.UpdateStatus` directly (lines 121, 142), bypassing `ValidateTransition`. With episodes, an invalid forced transition (e.g. `found → lost`) would open a bogus episode. Fix: only perform the status flip + episode handling when `ValidateTransition(oldStatus, newStatus)` passes; if it does not, still create the report (as a record) but leave status/episodes untouched. Stamp every report with the pet's current episode.

- [ ] **Step 1: Write the failing test**

Create/extend `backend/tests/episode_flow_test.go` with the report path (this file gets the full flow tests in Task 8; start it here):

```go
package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// A "lost" report on a registered pet must open an episode and stamp the report.
func TestCreateReport_LostOpensEpisodeAndStampsReport(t *testing.T) {
	db := testdb.SetupTestDB(t)
	deps := newEpisodeTestDeps(t, db) // helper defined in Task 8
	owner := newTestUser(t, deps.userRepo)

	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex",
		Type: "perro", Status: domain.PetStatusRegistered}
	deps.petRepo.Create(pet)

	rep, err := deps.reportService.CreateReport(owner.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "lost", Latitude: mvdLat, Longitude: mvdLng,
	})
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	if rep.EpisodeID == nil {
		t.Fatalf("report should be stamped with an episode id")
	}
	cur, _ := deps.episodeRepo.FindCurrent(pet.ID.String())
	if cur == nil || *rep.EpisodeID != cur.ID {
		t.Fatalf("report episode %v must equal pet current episode %v", rep.EpisodeID, cur)
	}
	reloaded, _ := deps.petRepo.FindByID(pet.ID.String())
	if reloaded.Status != domain.PetStatusLost {
		t.Fatalf("pet should be lost, got %s", reloaded.Status)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestCreateReport_LostOpensEpisodeAndStampsReport -v
```
Expected: FAIL — helper `newEpisodeTestDeps` undefined and/or `CreateReport` does not stamp episode. (If it fails only on the helper, implement Task 8's helper Step 1 first, then return here.)

- [ ] **Step 3: Add dependencies to `reportService`**

Add `episodes EpisodeService`, `episodeRepo repository.EpisodeRepository`, and `uow repository.UnitOfWork` to the `reportService` struct and `NewReportService`. New signature:

```go
func NewReportService(
	repo repository.ReportRepository,
	petRepo repository.PetRepository,
	bus event.Bus,
	statEventRepo repository.StatEventRepository,
	episodes EpisodeService,
	episodeRepo repository.EpisodeRepository,
	uow repository.UnitOfWork,
) ReportService {
```

- [ ] **Step 4: Rework `CreateReport` status handling**

Replace the direct `UpdateStatus` blocks (lines ~118-155) with a version that: loads `oldStatus`, validates the transition, and only flips status + handles the episode when valid — all inside a transaction with the report creation. Stamp the report with the current episode regardless.

```go
	loaded, err := s.repo.FindByID(report.ID.String()) // existing reload
	if err != nil {
		return nil, err
	}
	oldStatus := loaded.Pet.Status

	// Determine the target status implied by the report, if any.
	target := ""
	switch req.Status {
	case "found":
		target = domain.PetStatusFound
	case "lost":
		target = domain.PetStatusLost
	}

	// Apply status + episode only for a VALID transition. Invalid forced
	// transitions (e.g. found->lost) leave the pet untouched but keep the report.
	if target != "" && target != oldStatus && domain.ValidateTransition(oldStatus, target) == nil {
		err = s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
			if err := tx.Pets.UpdateStatus(req.PetID, target); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		if err := s.episodes.HandleTransition(req.PetID, oldStatus, target); err != nil {
			return nil, err
		}
	}

	// Stamp the report with the pet's current episode (now reflects a freshly
	// opened one if this report just opened a search).
	if cur, err := s.episodeRepo.FindCurrent(req.PetID); err == nil && cur != nil {
		if err := s.repo.SetEpisodeID(report.ID.String(), cur.ID); err != nil {
			return nil, err
		}
		report.EpisodeID = &cur.ID
	}
```

> This introduces `ReportRepository.SetEpisodeID(reportID string, episodeID uuid.UUID) error`. Add it to the interface and implement it in `report_repository.go`:
> ```go
> func (r *PostgresReportRepository) SetEpisodeID(reportID string, episodeID uuid.UUID) error {
> 	return r.db.Model(&domain.Report{}).Where("id = ?", reportID).
> 		Update("episode_id", episodeID).Error
> }
> ```
> Preserve the EXISTING event-publish and `recordStat` calls that currently live in the `found`/`lost` branches — move them to fire after a successful valid transition (keep the same `oldStatus` guards they already use).

- [ ] **Step 5: Run test to verify it passes** (after Task 8 Step 1 helper exists)

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestCreateReport_LostOpensEpisodeAndStampsReport -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/service/report_service.go backend/internal/repository/interfaces.go backend/internal/repository/report_repository.go backend/tests/episode_flow_test.go
git commit -m "feat(service): CreateReport opens/closes episodes, validates transitions, stamps reports"
```

---

### Task 7: FindNearby filters to the current episode

**Files:**
- Modify: `backend/internal/repository/report_repository.go` (`FindNearby`)
- Test: `backend/tests/report_repository_test.go` (new subtest)

The map must show only reports whose `episode_id` equals the pet's `current_episode_id`. This hides previous-episode pins on a re-lost pet while keeping the `found` "recovered here" reports (a found pet's `current_episode_id` still points at the just-closed episode).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/report_repository_test.go`:

```go
// A re-lost pet must show ONLY its current episode's reports on the map,
// not pins from a previous, resolved search episode.
func TestReportRepository_FindNearby_ScopesToCurrentEpisode(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	epRepo := repository.NewEpisodeRepository(db)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex",
		Type: "perro", Status: domain.PetStatusLost}
	petRepo.Create(pet)

	// Episode 1 (old) with a pin, then closed.
	ep1, _ := epRepo.Open(pet.ID.String())
	oldReport := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &ep1.ID}
	reportRepo.Create(oldReport)
	epRepo.CloseCurrent(pet.ID.String(), domain.PetStatusFound)

	// Episode 2 (current) with its own pin. Pet is lost again.
	ep2, _ := epRepo.Open(pet.ID.String())
	newReport := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &ep2.ID}
	reportRepo.Create(newReport)

	got, err := reportRepo.FindNearby(mvdLat, mvdLng, 50000)
	if err != nil {
		t.Fatalf("find nearby: %v", err)
	}
	for _, r := range got {
		if r.ID == oldReport.ID {
			t.Errorf("old-episode report must NOT appear on the map")
		}
	}
	foundNew := false
	for _, r := range got {
		if r.ID == newReport.ID {
			foundNew = true
		}
	}
	if !foundNew {
		t.Errorf("current-episode report must appear on the map")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestReportRepository_FindNearby_ScopesToCurrentEpisode -v
```
Expected: FAIL — old-episode report still appears (no episode filter yet).

- [ ] **Step 3: Add the episode filter to `FindNearby`**

In `report_repository.go`'s `FindNearby`, add one `Where` clause to the existing query chain (after the `pets.status IN (?)` clause, before the PostGIS `ST_DWithin` clause):

```go
		Where("reports.episode_id = pets.current_episode_id").
```

The full chain becomes:

```go
	err := r.db.Preload("Pet").Preload("Reporter").
		Joins("JOIN pets ON pets.id = reports.pet_id").
		Where("pets.status IN (?)", domain.MapVisibleStatuses).
		Where("reports.episode_id = pets.current_episode_id").
		Where(`
			ST_DWithin(
				ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
				?
			)
		`, lng, lat, radiusMeters).
		Order(orderExpr).
		Find(&reports).Error
```

> Note: rows where either `reports.episode_id` or `pets.current_episode_id` is NULL are excluded (`NULL = NULL` is not true in SQL). This is the intended cutover behavior for pre-migration data with no episode (see Non-Goals).

- [ ] **Step 4: Run test to verify it passes**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestReportRepository_FindNearby_ScopesToCurrentEpisode -v
```
Expected: PASS

- [ ] **Step 5: Re-run the existing FindNearby status test to confirm no regression**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run TestReportRepository_FindNearby -v
```
Expected: PASS for all `FindNearby` subtests. If `TestReportRepository_FindNearby_FiltersByPetStatus` now fails because its fixtures create reports without episodes, UPDATE that test to open an episode and stamp its reports (the map now legitimately requires an episode). Document the fixture change in the commit.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/report_repository.go backend/tests/report_repository_test.go
git commit -m "feat(repo): FindNearby scopes map reports to the pet's current episode"
```

---

### Task 8: DI wiring + full-flow integration test

**Files:**
- Modify: `backend/internal/app/router.go` (construct + inject episode repo/service)
- Test: `backend/tests/episode_flow_test.go` (helper + the re-lost map bug end-to-end)

- [ ] **Step 1: Add the shared test helper to `backend/tests/episode_flow_test.go`**

```go
type episodeTestDeps struct {
	userRepo      repository.UserRepository
	petRepo       repository.PetRepository
	reportRepo    repository.ReportRepository
	episodeRepo   repository.EpisodeRepository
	petService    service.PetService
	reportService service.ReportService
}

func newEpisodeTestDeps(t *testing.T, db *gorm.DB) episodeTestDeps {
	t.Helper()
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	episodeRepo := repository.NewEpisodeRepository(db)
	uow := repository.NewUnitOfWork(db)
	statRepo := repository.NewStatEventRepository(db)
	bus := event.NewBus() // match the constructor used elsewhere in tests
	episodeSvc := service.NewEpisodeService(episodeRepo)
	petSvc := service.NewPetService(petRepo, bus, nil, reportRepo, uow, statRepo, episodeSvc, episodeRepo)
	reportSvc := service.NewReportService(reportRepo, petRepo, bus, statRepo, episodeSvc, episodeRepo, uow)
	return episodeTestDeps{userRepo, petRepo, reportRepo, episodeRepo, petSvc, reportSvc}
}
```

> Adjust `event.NewBus()`, the `nil` photoService arg, and constructor arg order to match the ACTUAL signatures after Tasks 5-6. Read the constructors before finalizing. If `NewPetService` panics on a nil photoService anywhere in the exercised path, pass a no-op fake instead.

- [ ] **Step 2: Write the end-to-end re-lost map test**

```go
// End-to-end: a pet lost, found, then re-lost through the services shows only
// the second episode's report on the map.
func TestEpisodeFlow_ReLostPet_MapShowsOnlyCurrentEpisode(t *testing.T) {
	db := testdb.SetupTestDB(t)
	deps := newEpisodeTestDeps(t, db)
	owner := newTestUser(t, deps.userRepo)

	// Publish lost (episode 1)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex",
		Type: "perro", Status: domain.PetStatusRegistered}
	deps.petRepo.Create(pet)
	_, err := deps.petService.PublishLost(owner.ID.String(), pet.ID.String(),
		service.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng})
	if err != nil {
		t.Fatalf("publish lost: %v", err)
	}

	// Mark found -> closes episode 1
	if _, err := deps.petService.MarkAsFound(owner.ID.String(), pet.ID.String()); err != nil {
		t.Fatalf("mark found: %v", err)
	}
	// Back to registered, then re-lost (episode 2)
	deps.petRepo.UpdateStatus(pet.ID.String(), domain.PetStatusRegistered)
	_, err = deps.petService.PublishLost(owner.ID.String(), pet.ID.String(),
		service.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng})
	if err != nil {
		t.Fatalf("re-publish lost: %v", err)
	}

	got, _ := deps.reportRepo.FindNearby(mvdLat, mvdLng, 50000)
	// Exactly the episode-2 lost report should be on the map (episode-1 lost +
	// found-closure reports are from the previous episode and must be hidden).
	cur, _ := deps.episodeRepo.FindCurrent(pet.ID.String())
	for _, r := range got {
		if r.PetID == pet.ID && (r.EpisodeID == nil || *r.EpisodeID != cur.ID) {
			t.Errorf("map shows a report from a non-current episode: %s", r.ID)
		}
	}
	if len(got) == 0 {
		t.Errorf("expected the current-episode report on the map")
	}
}
```

> Adjust `PublishLostRequest` / `MarkAsFound` / `PublishLost` names and signatures to the real ones (read the service before finalizing). The assertion is the load-bearing part: no map report may belong to a non-current episode.

- [ ] **Step 3: Wire episode repo/service in `backend/internal/app/router.go`**

After `statEventRepo := repository.NewStatEventRepository(db)` (~line 90), add:

```go
	episodeRepo := repository.NewEpisodeRepository(db)
	episodeService := service.NewEpisodeService(episodeRepo)
```

Update the pet + report service construction (lines ~107-108) to pass the new dependencies:

```go
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo, petUow, statEventRepo, episodeService, episodeRepo)
	reportService := service.NewReportService(reportRepo, petRepo, bus, statEventRepo, episodeService, episodeRepo, petUow)
```

(Confirm the exact existing argument order/names before editing.)

- [ ] **Step 4: Build everything**

Run: `go build ./...`
Expected: success (no output). This confirms all constructor arities line up.

- [ ] **Step 5: Run the full episode test suite**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./tests/... -run "Episode|FindNearby|CreateReport" -v
```
Expected: PASS for all episode/nearby/report subtests.

- [ ] **Step 6: Run the whole backend suite for regressions**

Run:
```powershell
$env:DATABASE_URL = "postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable"
go test ./...
```
Expected: PASS. Pay special attention to existing `pet_service` / `report_service` / `report_repository` tests whose fixtures may now need an episode. Fix fixtures where the map/episode invariant legitimately requires one; do NOT weaken the production filter to accommodate a stale test.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/app/router.go backend/tests/episode_flow_test.go
git commit -m "feat(app): wire EpisodeService/Repository; add re-lost map integration test"
```

---

## Self-Review Checklist (run before handing off to review)

- [ ] **Every transition path opens/closes an episode:** `CreatePet` stray (Task 5.5), `UpdatePet`→lost/→resolved (Task 5.2), `PublishLost` (Task 5.4), `MarkAsFound` (Task 5.3), `CreateReport` lost/found (Task 6.4). Grep for `UpdateStatus(` and `pet.Status =` and confirm each is paired with a `HandleTransition` call.
- [ ] **Every report-creating path stamps `episode_id`:** `CreatePet` initial report, `PublishLost` report, `MarkAsFound` closure report, `CreateReport`. Grep for `Reports.Create(` / `reportRepo.Create(` and confirm the report carries an `EpisodeID` where the pet is active.
- [ ] **`FindByPetID` is untouched** (card keeps full history).
- [ ] **`FindNearby`** filters `reports.episode_id = pets.current_episode_id`.
- [ ] **`ValidateTransition` guard** protects `CreateReport`'s status flip.
- [ ] **No placeholder** left in code; all constructor signatures consistent across Tasks 5, 6, 8.
- [ ] **Migration is idempotent** and has a working `down`.

---

## Review Workload Forecast

- Estimated changed lines: ~450-550 (model + migration + repo + service orchestration across 2 services + query + tests).
- Touches `**/service/**` transition logic and a PostGIS query. **Recommend a fresh-context 4R review before PR** (risk + reliability especially: episode integrity across all transition paths is the whole point).
- 400-line budget risk: Moderate/High. Consider whether to split (e.g. PR 1 = schema + repo + EpisodeService; PR 2 = service wiring + FindNearby + tests) if the review diff feels too large.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.
