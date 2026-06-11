# Publish Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken "Publicar" entry points (web nav, home CTA, mobile Post tab) with a 4-step publish wizard that creates either a `lost` transition for an owned pet or a `stray` pet, both atomically paired with an initial location report.

**Architecture:** Two new/extended transactional backend endpoints (`POST /api/pets/:id/publish-lost`, extended `POST /api/pets` with `initial_report`) wrap pet+report writes in a single GORM transaction via a new `repository.UnitOfWork` abstraction. Shared types/client/hooks expose `publishPetLost` and `usePublishStray`/`usePublishLost`. Web ships a new public `/publish` route hosting a 4-step wizard (Leaflet map); mobile rebuilds the Post tab as the same wizard (MapLibre). i18n adds a `publish` namespace in es/en/pt across shared, web, and mobile.

**Tech Stack:** Go 1.25 + Gin + GORM + PostgreSQL/PostGIS (backend); React + Vite + Tailwind + Leaflet (web); React Native + Expo + MapLibre (mobile); React Query + Zustand; Vitest (web/shared), Jest (mobile), Playwright (E2E).

---

## File Structure

**Backend (new/modified):**
- `backend/internal/repository/unit_of_work.go` — NEW: `UnitOfWork` interface + GORM implementation, exposes a `*gorm.DB` transaction handle and per-aggregate repos bound to it.
- `backend/internal/repository/pet_repository.go` — add `WithTx(tx *gorm.DB) PetRepository` style helper OR constructor that accepts `*gorm.DB` (transaction-scoped). Reuse existing `NewPetRepository(db)`.
- `backend/internal/repository/report_repository.go` — same: reusable with a transaction-scoped `*gorm.DB`.
- `backend/internal/domain/errors.go` — add `ErrInitialReportRequired` + `ErrInitialReportNotAllowed` sentinels and codes.
- `backend/internal/dto/pet_dto.go` — add `InitialReportRequest` struct, extend `CreatePetRequest` with `InitialReport *InitialReportRequest`.
- `backend/internal/dto/report_dto.go` or inline — add `PublishLostRequest` DTO (latitude, longitude, note).
- `backend/internal/service/pet_service.go` — add `PublishLost` method to `PetService` interface + impl; extend `CreatePet` to handle `initial_report` for stray; inject `db *gorm.DB` for transactions.
- `backend/internal/handler/pet_handler.go` — add `PublishLost` handler.
- `backend/internal/app/router.go` — register `POST /api/pets/:id/publish-lost` (protected).
- `backend/internal/service/pet_service_test.go` — new table-driven tests for `PublishLost` and extended `CreatePet`.
- `backend/tests/write_error_test.go` — append new error codes to `TestCodeFor_KnownError`.
- `backend/tests/e2e/publish_flow_test.go` — NEW httptest flow test.

**Shared (frontend/packages/shared/):**
- `types/index.ts` — extend `CreatePetRequest`, add `PublishLostRequest`, `InitialReportRequest`.
- `api/client.ts` — add `publishPetLost`.
- `hooks/index.ts` — add `usePublishLost`, `usePublishStray`.
- `hooks/index.test.ts` (or wherever shared hook tests live) — new tests.
- `i18n/locales/{es,en,pt}.json` — new `publish` namespace.

**Web (frontend/packages/web/):**
- `src/pages/PublishWizardPage.tsx` — NEW: 4-step wizard container + step components in same file (small, cohesive feature — see Task 14 rationale) plus a `src/components/publish/` folder for `IntentStep.tsx`, `LostPetStep.tsx`, `StrayFormStep.tsx`, `LocationStep.tsx`, `SuccessStep.tsx`, `InlineAuthStep.tsx`.
- `src/App.tsx` — add public route `/publish`.
- `src/layouts/MainLayout.tsx` — point "Publicar" links to `/publish`.
- `src/pages/HomePage.tsx` — point CTA to `/publish`.
- `src/i18n/locales/{es,en,pt}.json` — add `publish` namespace (web-only strings if any beyond shared).
- `src/i18n/index.ts` — register `publish` namespace.
- `src/pages/PublishWizardPage.test.tsx` + per-step tests.
- `tests/e2e/publish-stray.spec.ts` — NEW Playwright spec.

**Mobile (frontend/packages/mobile/):**
- `app/(tabs)/post.tsx` — REPLACED with wizard container (reuses `frontend/packages/web` step logic conceptually but RN components).
- `components/publish/` — `IntentStep.tsx`, `LostPetStep.tsx`, `StrayFormStep.tsx`, `LocationStep.tsx`, `SuccessStep.tsx`, `InlineAuthStep.tsx`.
- `i18n/locales/{es,en,pt}.json` — add `publish` namespace.
- `__tests__/post.test.tsx` — rewritten smoke tests for the wizard.

---

## Backend Tasks

### Task 1: Domain errors for initial-report validation

**Files:**
- Modify: `backend/internal/domain/errors.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/domain/errors_publish_test.go`:

```go
package domain_test

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestCodeFor_InitialReportErrors(t *testing.T) {
	cases := []struct {
		err      error
		wantCode string
	}{
		{domain.ErrInitialReportRequired, "initial_report_required"},
		{domain.ErrInitialReportNotAllowed, "initial_report_not_allowed"},
	}

	for _, tc := range cases {
		t.Run(tc.wantCode, func(t *testing.T) {
			got := domain.CodeFor(tc.err)
			if got != tc.wantCode {
				t.Errorf("CodeFor(%v) = %q, want %q", tc.err, got, tc.wantCode)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/domain/... -run TestCodeFor_InitialReportErrors -v`
Expected: FAIL — `undefined: domain.ErrInitialReportRequired` (compile error).

- [ ] **Step 3: Add the sentinel errors and codes**

In `backend/internal/domain/errors.go`, add to the `// Pet` block of the `var (...)` declaration (after `ErrOwnerRequiredForStatus`):

```go
	ErrOwnerRequiredForStatus    = errors.New("owner_required_for_status")
	ErrInitialReportRequired     = errors.New("initial_report_required")
	ErrInitialReportNotAllowed   = errors.New("initial_report_not_allowed")
```

And add to the `ErrorCodes` map's `// Pet` section (after `ErrOwnerRequiredForStatus: "owner_required_for_status",`):

```go
	ErrOwnerRequiredForStatus:  "owner_required_for_status",
	ErrInitialReportRequired:   "initial_report_required",
	ErrInitialReportNotAllowed: "initial_report_not_allowed",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/domain/... -run TestCodeFor_InitialReportErrors -v`
Expected: PASS

- [ ] **Step 5: Append the same two cases to the project-wide error code table**

In `backend/tests/write_error_test.go`, inside `TestCodeFor_KnownError`'s `cases` slice, add after the `{domain.ErrOwnerRequiredForStatus, "owner_required_for_status"},` line (note: check this exact entry exists; if not, add both new lines directly after `{domain.ErrConflict, "conflict"},`):

```go
		{domain.ErrInitialReportRequired, "initial_report_required"},
		{domain.ErrInitialReportNotAllowed, "initial_report_not_allowed"},
```

Run: `go test ./tests/... -run TestCodeFor_KnownError -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/internal/domain/errors.go backend/internal/domain/errors_publish_test.go backend/tests/write_error_test.go
git commit -m "feat(backend): add initial_report_required and initial_report_not_allowed error codes"
```

---

### Task 2: UnitOfWork abstraction for pet+report transactions

**Files:**
- Create: `backend/internal/repository/unit_of_work.go`
- Test: `backend/internal/repository/unit_of_work_test.go`

This is the transactional backbone both new endpoints need. We add a small `UnitOfWork` interface that opens a GORM transaction and exposes transaction-scoped `PetRepository` and `ReportRepository` instances (both repos already accept `*gorm.DB` in their constructors — `NewPetRepository(db)` / `NewReportRepository(db)` — so a transaction-scoped repo is just `NewPetRepository(tx)`). This keeps the existing repository interfaces untouched (rule: "Repositorios siempre detrás de interfaces") while giving services one transaction spanning both aggregates.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/repository/unit_of_work_test.go`:

```go
package repository_test

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// setupSQLiteDB creates an in-memory SQLite DB with the Pet/Report tables for
// transaction tests — avoids requiring a real PostgreSQL instance for unit tests.
func setupSQLiteDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&domain.Pet{}, &domain.Report{}, &domain.User{}); err != nil {
		t.Fatalf("failed to automigrate: %v", err)
	}
	return db
}

func TestUnitOfWork_CommitPersistsBothAggregates(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)

	ownerID := uuid.New()
	pet := &domain.Pet{OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}

	err := uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.Create(pet); err != nil {
			return err
		}
		report := &domain.Report{PetID: pet.ID, ReporterID: ownerID, Status: "lost", Latitude: -34.9, Longitude: -56.1}
		return tx.Reports.Create(report)
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Verify outside the transaction
	plainPetRepo := repository.NewPetRepository(db)
	found, err := plainPetRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("expected pet to be persisted, got error: %v", err)
	}
	if found.Name != "Rex" {
		t.Errorf("expected pet name 'Rex', got %q", found.Name)
	}

	plainReportRepo := repository.NewReportRepository(db)
	reports, err := plainReportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("expected reports query to succeed, got error: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("expected 1 report, got %d", len(reports))
	}
}

func TestUnitOfWork_RollsBackOnReportError(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)

	ownerID := uuid.New()
	pet := &domain.Pet{OwnerID: &ownerID, Name: "Fido", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}

	err := uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.Create(pet); err != nil {
			return err
		}
		// Force an error: invalid report (PetID zero value triggers a NOT NULL-style failure
		// in our sqlite schema since PetID has no default) — simulate explicit failure instead
		// for portability across drivers.
		return domain.ErrInternal
	})
	if err == nil {
		t.Fatal("expected error from Execute, got nil")
	}

	plainPetRepo := repository.NewPetRepository(db)
	_, findErr := plainPetRepo.FindByID(pet.ID.String())
	if findErr == nil {
		t.Fatal("expected pet creation to be rolled back, but pet was found")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/repository/... -run TestUnitOfWork -v`
Expected: FAIL — `undefined: repository.NewUnitOfWork` (compile error). Also: `gorm.io/driver/sqlite` not in `go.mod` yet.

- [ ] **Step 3: Add the sqlite driver as a test-only dependency**

Run: `go get gorm.io/driver/sqlite@latest`

This adds `gorm.io/driver/sqlite` to `go.mod`/`go.sum`. It is only imported from `_test.go` files, so it does not affect the production binary.

- [ ] **Step 4: Implement UnitOfWork**

Create `backend/internal/repository/unit_of_work.go`:

```go
package repository

import (
	"gorm.io/gorm"
)

// UnitOfWorkRepos bundles the repositories that must share a single GORM
// transaction. Add fields here as new composite operations need them —
// today only Pets + Reports are required by the publish flow.
type UnitOfWorkRepos struct {
	Pets    PetRepository
	Reports ReportRepository
}

// UnitOfWork runs a function within a single database transaction, giving it
// transaction-scoped repository instances. If the function returns an error,
// the transaction is rolled back; otherwise it is committed.
//
// This is the least invasive way to get cross-aggregate atomicity (pet + report)
// without changing the PetRepository/ReportRepository interfaces or breaking
// the "repositories behind interfaces" rule — both existing constructors
// (NewPetRepository, NewReportRepository) already accept a *gorm.DB, so binding
// them to tx instead of the top-level db is a transaction-scoped repo "for free".
type UnitOfWork interface {
	Execute(fn func(repos UnitOfWorkRepos) error) error
}

type gormUnitOfWork struct {
	db *gorm.DB
}

// NewUnitOfWork is the constructor — receives the top-level *gorm.DB connection.
func NewUnitOfWork(db *gorm.DB) UnitOfWork {
	return &gormUnitOfWork{db: db}
}

func (u *gormUnitOfWork) Execute(fn func(repos UnitOfWorkRepos) error) error {
	return u.db.Transaction(func(tx *gorm.DB) error {
		repos := UnitOfWorkRepos{
			Pets:    NewPetRepository(tx),
			Reports: NewReportRepository(tx),
		}
		return fn(repos)
	})
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/repository/... -run TestUnitOfWork -v`
Expected: PASS (both `TestUnitOfWork_CommitPersistsBothAggregates` and `TestUnitOfWork_RollsBackOnReportError`)

- [ ] **Step 6: Run the full repository package tests to check no regression**

Run: `go test ./internal/repository/... -v`
Expected: PASS — existing repository tests (if any) unaffected.

- [ ] **Step 7: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/repository/unit_of_work.go backend/internal/repository/unit_of_work_test.go
git commit -m "feat(backend): add UnitOfWork for pet+report transactional writes"
```

---

### Task 3: Extend `CreatePetRequest` with `initial_report` and validate it in `CreatePet`

**Files:**
- Modify: `backend/internal/dto/pet_dto.go`
- Modify: `backend/internal/service/pet_service.go`
- Test: `backend/internal/service/pet_service_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/service/pet_service_test.go` (after the existing `mockReportRepo` / helpers — first check if a `mockReportRepo` exists; if not, add the one below alongside the existing `mockPetRepo`):

```go
// ============================================================
// Mock: ReportRepository (for CreatePet/PublishLost tests)
// ============================================================

type mockReportRepo struct {
	createErr    error
	createdCount int
	lastReport   *domain.Report
}

func (m *mockReportRepo) Create(report *domain.Report) error {
	m.createdCount++
	m.lastReport = report
	return m.createErr
}
func (m *mockReportRepo) FindByID(_ string) (*domain.Report, error) { return nil, nil }
func (m *mockReportRepo) FindByPetID(_ string) ([]domain.Report, error) { return nil, nil }
func (m *mockReportRepo) FindNearby(_, _, _ float64) ([]domain.Report, error) { return nil, nil }
func (m *mockReportRepo) UpdateVerified(_ context.Context, _, _ uuid.UUID) error { return nil }

// ============================================================
// Tests: CreatePet — initial_report validation (stray)
// ============================================================

func TestCreatePet_Stray_RequiresInitialReport(t *testing.T) {
	repo := &mockPetRepo{}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{})

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		// InitialReport intentionally omitted
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error for stray without initial_report, got nil")
	}
	if err.Error() != domain.ErrInitialReportRequired.Error() {
		t.Errorf("expected ErrInitialReportRequired, got %v", err)
	}
}

func TestCreatePet_Stray_WithInitialReport_CreatesPetAndReport(t *testing.T) {
	repo := &capturingPetRepo{}
	reportRepo := &mockReportRepo{}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
			Note:      "Visto cerca de la plaza",
		},
	}

	pet, err := svc.CreatePet(ownerID.String(), req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if pet.Status != domain.PetStatusStray {
		t.Errorf("expected status %q, got %q", domain.PetStatusStray, pet.Status)
	}
	if reportRepo.createdCount != 1 {
		t.Fatalf("expected 1 report created, got %d", reportRepo.createdCount)
	}
	if reportRepo.lastReport.Status != "sighting" {
		t.Errorf("expected report status 'sighting', got %q", reportRepo.lastReport.Status)
	}
	if reportRepo.lastReport.LocationDescription != "Visto cerca de la plaza" {
		t.Errorf("expected location_description to carry the note, got %q", reportRepo.lastReport.LocationDescription)
	}
	if reportRepo.lastReport.PetID != pet.ID {
		t.Errorf("expected report.pet_id == pet.id")
	}
}

func TestCreatePet_Registered_RejectsInitialReport(t *testing.T) {
	repo := &mockPetRepo{}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{})

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Rex",
		Type:   "perro",
		Status: domain.PetStatusRegistered,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
		},
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error for registered pet with initial_report, got nil")
	}
	if err.Error() != domain.ErrInitialReportNotAllowed.Error() {
		t.Errorf("expected ErrInitialReportNotAllowed, got %v", err)
	}
}

func TestCreatePet_Stray_ReportCreationFails_RollsBackPet(t *testing.T) {
	repo := &capturingPetRepo{}
	reportRepo := &mockReportRepo{createErr: domain.ErrInternal}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
		},
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error when report creation fails, got nil")
	}
	if repo.mockPetRepo.pet != nil {
		t.Error("expected pet creation to be rolled back when report creation fails")
	}
}
```

Add `"context"` to the import block of `pet_service_test.go` if not already present (needed for `mockReportRepo.UpdateVerified`).

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/service/... -run TestCreatePet_Stray -v`
Expected: FAIL — `req.InitialReport` undefined (compile error: `dto.CreatePetRequest` has no field `InitialReport`, `dto.InitialReportRequest` undefined).

- [ ] **Step 3: Add `InitialReportRequest` DTO and extend `CreatePetRequest`**

In `backend/internal/dto/pet_dto.go`, add after the `CreatePetRequest` struct:

```go
// InitialReportRequest contains the location data for the initial report that
// must accompany a stray pet creation or a publish-lost transition.
type InitialReportRequest struct {
	Latitude  float64 `json:"latitude" binding:"required"`
	Longitude float64 `json:"longitude" binding:"required"`
	Note      string  `json:"note"`
}
```

Then extend `CreatePetRequest` — add a field after `Status`:

```go
type CreatePetRequest struct {
	Name        string  `json:"name" binding:"required"`
	Type        string  `json:"type" binding:"required"`
	Breed       string  `json:"breed"`
	Color       string  `json:"color"`
	Description string  `json:"description"`
	Gender      string  `json:"gender"`
	MicrochipID *string `json:"microchip_id"`
	// Status is optional. Accepted values: "registered" (default) and "stray".
	// Any other value is rejected by the service layer.
	Status string `json:"status"`
	// InitialReport is required when Status == "stray" (400 initial_report_required
	// otherwise) and forbidden when Status == "registered" or omitted
	// (400 initial_report_not_allowed otherwise).
	InitialReport *InitialReportRequest `json:"initial_report"`
}
```

- [ ] **Step 4: Run test to verify it still fails (now on logic, not compile)**

Run: `go test ./internal/service/... -run TestCreatePet_Stray -v`
Expected: FAIL — `TestCreatePet_Stray_RequiresInitialReport` fails because `CreatePet` does not yet validate `InitialReport`. Note also `capturingPetRepo` may not implement the updated mock — check it compiles; if `capturingPetRepo` embeds `mockPetRepo` it inherits the new fields automatically.

- [ ] **Step 5: Implement validation + transactional creation in `CreatePet`**

In `backend/internal/service/pet_service.go`, the current `CreatePet` ends with:

```go
	if err := s.repo.Create(pet); err != nil {
		return nil, err
	}

	// Publicamos pet.stray cuando se crea una mascota callejera — EmbeddingService
	// se suscribe para backfillear embeddings (no-op si todavía no tiene fotos).
	if s.eventBus != nil && status == domain.PetStatusStray {
		s.eventBus.Publish("pet.stray", event.PetStrayEvent{PetID: pet.ID})
	}

	return s.repo.FindByID(pet.ID.String())
}
```

Replace the whole `CreatePet` function body from the status validation onward. The new full function:

```go
// CreatePet crea una nueva mascota para el usuario autenticado.
// Status defaults to PetStatusRegistered.
// If req.Status == PetStatusStray, OwnerID is nil (stray pet with no owner) and
// req.InitialReport is REQUIRED — a "sighting" report is created in the same
// transaction (400 initial_report_required if absent).
// If req.Status == PetStatusRegistered (or omitted), req.InitialReport is
// FORBIDDEN (400 initial_report_not_allowed if present) — registered pets are
// not published and therefore carry no location report.
// Creating with lost/found/archived is rejected with ErrInvalidStatusTransition.
func (s *petService) CreatePet(ownerID string, req dto.CreatePetRequest) (*domain.Pet, error) {
	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	// Determine status — default to registered
	status := domain.PetStatusRegistered
	if req.Status != "" {
		status = req.Status
	}

	// Only registered and stray are valid at creation
	if status != domain.PetStatusRegistered && status != domain.PetStatusStray {
		return nil, domain.ErrInvalidStatusTransition
	}

	// initial_report rules: required for stray, forbidden for registered
	if status == domain.PetStatusStray && req.InitialReport == nil {
		return nil, domain.ErrInitialReportRequired
	}
	if status == domain.PetStatusRegistered && req.InitialReport != nil {
		return nil, domain.ErrInitialReportNotAllowed
	}

	// Stray pets have no owner; registered pets always have an owner
	var ownerPtr *uuid.UUID
	var reporterPtr *uuid.UUID
	if status == domain.PetStatusStray {
		// OwnerID stays nil; the authenticated user becomes the reporter
		reporterPtr = &ownerUUID
	} else {
		ownerPtr = &ownerUUID
	}

	pet := &domain.Pet{
		OwnerID:     ownerPtr,
		ReporterID:  reporterPtr,
		Name:        req.Name,
		Type:        req.Type,
		Breed:       req.Breed,
		Color:       req.Color,
		Description: req.Description,
		Gender:      req.Gender,
		MicrochipID: req.MicrochipID,
		Status:      status,
		Version:     1,
	}

	if status == domain.PetStatusStray {
		// Pet + initial report must be created atomically — a stray visible in
		// the public feed without a location report is corrupt data for a
		// map-centric product.
		if s.uow == nil {
			return nil, domain.ErrInternal
		}
		err := s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
			if err := tx.Pets.Create(pet); err != nil {
				return err
			}
			report := &domain.Report{
				PetID:               pet.ID,
				ReporterID:          ownerUUID,
				Status:              "sighting",
				Latitude:            req.InitialReport.Latitude,
				Longitude:           req.InitialReport.Longitude,
				LocationDescription: req.InitialReport.Note,
			}
			return tx.Reports.Create(report)
		})
		if err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.Create(pet); err != nil {
			return nil, err
		}
	}

	// Publicamos pet.stray cuando se crea una mascota callejera — EmbeddingService
	// se suscribe para backfillear embeddings (no-op si todavía no tiene fotos).
	if s.eventBus != nil && status == domain.PetStatusStray {
		s.eventBus.Publish("pet.stray", event.PetStrayEvent{PetID: pet.ID})

		// report.created — triggers nearby push notifications via NotificationService
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			PetID:      pet.ID,
			ReporterID: ownerUUID,
			PetName:    pet.Name,
			PetType:    pet.Type,
			Status:     "sighting",
			Lat:        req.InitialReport.Latitude,
			Lng:        req.InitialReport.Longitude,
		})
	}

	return s.repo.FindByID(pet.ID.String())
}
```

Now add the `uow` field, constructor parameter, and `repository` import. The constructor and struct currently are:

```go
type petService struct {
	repo         repository.PetRepository
	eventBus     *event.EventBus
	photoService PhotoService
	reportRepo   repository.ReportRepository
}

func NewPetService(repo repository.PetRepository, eventBus *event.EventBus, photoService PhotoService, reportRepo repository.ReportRepository) PetService {
	return &petService{repo: repo, eventBus: eventBus, photoService: photoService, reportRepo: reportRepo}
}
```

Replace with:

```go
type petService struct {
	repo         repository.PetRepository
	eventBus     *event.EventBus
	photoService PhotoService
	reportRepo   repository.ReportRepository
	uow          repository.UnitOfWork
}

// NewPetService es el constructor — recibe el repository, el bus de eventos, el servicio de fotos,
// el report repository y el UnitOfWork (para operaciones transaccionales pet+report).
// eventBus es opcional — si es nil, los eventos no se publican.
// photoService es opcional — si es nil, la eliminación en cascada de fotos se omite.
// reportRepo es opcional — si es nil, el closure report en MarkAsFound y la creación
// de strays con initial_report se omiten (CreatePet retorna ErrInternal para strays sin uow).
// uow es opcional en tests unitarios que no ejercitan el camino stray/publish-lost,
// pero requerido en producción (ver router.go).
func NewPetService(repo repository.PetRepository, eventBus *event.EventBus, photoService PhotoService, reportRepo repository.ReportRepository, uow repository.UnitOfWork) PetService {
	return &petService{repo: repo, eventBus: eventBus, photoService: photoService, reportRepo: reportRepo, uow: uow}
}
```

This changes `NewPetService`'s signature (5 args instead of 4) — every call site must be updated. There are two call sites: `backend/internal/app/router.go` (production) and every `service.NewPetService(...)` call in `pet_service_test.go` (tests). Tests will be fixed in Step 6; the production call site is fixed in Task 5 (router wiring), since `uow` requires `db` which Task 5 introduces into the constructor call. For THIS step, temporarily pass `nil` from router.go so the package compiles:

In `backend/internal/app/router.go`, find:

```go
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo)
```

Replace with:

```go
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo, nil) // TODO(Task 5): wire UnitOfWork
```

- [ ] **Step 6: Fix existing test call sites**

In `backend/internal/service/pet_service_test.go`, every existing `service.NewPetService(repo, bus, nil, nil)` (or similar 4-arg calls) must become 5-arg calls. For tests that don't exercise the stray/publish-lost transactional path, pass `nil` for `uow` (the new code path only calls `s.uow` when `status == domain.PetStatusStray`, so existing registered-pet tests are unaffected). For the new stray tests added in Step 1 above (`TestCreatePet_Stray_*`), pass `repository.NewUnitOfWork(sqliteDB)` where `sqliteDB` is an in-memory SQLite DB seeded the same way as `unit_of_work_test.go` (Task 2) — because `CreatePet`'s stray path calls `tx.Pets.Create` / `tx.Reports.Create` through real GORM repos inside the transaction, the mocks (`capturingPetRepo`, `mockReportRepo`) are NOT used for the stray path's persistence; they ARE still used for `s.repo.FindByID` (the final read after `uow.Execute`) and `s.eventBus`.

Concretely, for `TestCreatePet_Stray_WithInitialReport_CreatesPetAndReport` and `TestCreatePet_Stray_ReportCreationFails_RollsBackPet`, replace the mock-based setup with a SQLite-backed UnitOfWork:

```go
func TestCreatePet_Stray_WithInitialReport_CreatesPetAndReport(t *testing.T) {
	db := setupSQLiteDB(t) // from unit_of_work_test.go — same package, reuse helper
	uow := repository.NewUnitOfWork(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
			Note:      "Visto cerca de la plaza",
		},
	}

	pet, err := svc.CreatePet(ownerID.String(), req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if pet.Status != domain.PetStatusStray {
		t.Errorf("expected status %q, got %q", domain.PetStatusStray, pet.Status)
	}

	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID failed: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("expected 1 report, got %d", len(reports))
	}
	if reports[0].Status != "sighting" {
		t.Errorf("expected report status 'sighting', got %q", reports[0].Status)
	}
	if reports[0].LocationDescription != "Visto cerca de la plaza" {
		t.Errorf("expected location_description to carry the note, got %q", reports[0].LocationDescription)
	}
}

func TestCreatePet_Stray_ReportCreationFails_RollsBackPet(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	// Force the report insert to fail by using an invalid status that violates
	// the CreateReportRequest validation is bypassed at this layer — instead we
	// drop the reports table to force a SQL error inside the transaction.
	if err := db.Migrator().DropTable(&domain.Report{}); err != nil {
		t.Fatalf("failed to drop reports table: %v", err)
	}

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
		},
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error when report creation fails, got nil")
	}

	var count int64
	db.Model(&domain.Pet{}).Count(&count)
	if count != 0 {
		t.Errorf("expected pet creation to be rolled back, found %d pets", count)
	}
}
```

Remove the now-unused `mockReportRepo`-based versions of these two tests from Step 1 (the `capturingPetRepo`/`reportRepo` mock variants) — keep only `TestCreatePet_Stray_RequiresInitialReport` and `TestCreatePet_Registered_RejectsInitialReport` using mocks (they fail before any persistence happens, so mocks are fine and `uow: nil` is fine since `s.uow` is never reached).

For `TestCreatePet_Stray_RequiresInitialReport` and `TestCreatePet_Registered_RejectsInitialReport`, update the `NewPetService` calls to 5 args with `nil` uow:

```go
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{}, nil)
```

Now do a project-wide fix of all remaining 4-arg `NewPetService` calls in `pet_service_test.go` — append `, nil` as the 5th argument to each.

- [ ] **Step 7: Run all pet_service tests**

Run: `go test ./internal/service/... -v`
Expected: PASS — all `TestCreatePet_*`, `TestMarkAsFound_*`, `TestUpdatePet_*` pass.

- [ ] **Step 8: Run the full backend test suite**

Run: `go test ./... -v 2>&1 | tail -60`
Expected: PASS (router.go now compiles with `nil` uow — `CreatePet` for `registered` status never touches `s.uow`, so the temporary `nil` is safe until Task 5).

- [ ] **Step 9: Commit**

```bash
git add backend/internal/dto/pet_dto.go backend/internal/service/pet_service.go backend/internal/service/pet_service_test.go backend/internal/app/router.go
git commit -m "feat(backend): extend CreatePet with transactional initial_report for strays"
```

---

### Task 4: `PublishLost` service method

**Files:**
- Modify: `backend/internal/service/pet_service.go`
- Modify: `backend/internal/dto/pet_dto.go`
- Test: `backend/internal/service/pet_service_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/service/pet_service_test.go`:

```go
// ============================================================
// Tests: PublishLost
// ============================================================

func TestPublishLost_HappyPath_TransitionsAndCreatesReport(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	pet := &domain.Pet{OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet failed: %v", err)
	}

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645, Note: "Se escapó del jardín"}

	updated, err := svc.PublishLost(ownerID.String(), pet.ID.String(), req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if updated.Status != domain.PetStatusLost {
		t.Errorf("expected status %q, got %q", domain.PetStatusLost, updated.Status)
	}

	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID failed: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("expected 1 report, got %d", len(reports))
	}
	if reports[0].Status != "lost" {
		t.Errorf("expected report status 'lost', got %q", reports[0].Status)
	}
	if reports[0].LocationDescription != "Se escapó del jardín" {
		t.Errorf("expected location_description to carry the note, got %q", reports[0].LocationDescription)
	}
}

func TestPublishLost_NonOwner_Returns403(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	otherUserID := uuid.New()
	pet := &domain.Pet{OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet failed: %v", err)
	}

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(otherUserID.String(), pet.ID.String(), req)
	if err == nil {
		t.Fatal("expected error for non-owner, got nil")
	}
	if err.Error() != domain.ErrForbidden.Error() {
		t.Errorf("expected ErrForbidden, got %v", err)
	}

	reports, _ := reportRepo.FindByPetID(pet.ID.String())
	if len(reports) != 0 {
		t.Error("expected no report to be created for a forbidden publish-lost")
	}
}

func TestPublishLost_InvalidTransition_Returns422(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	// "found" -> "lost" is not in AllowedTransitions for PetStatusFound
	pet := &domain.Pet{OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusFound, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet failed: %v", err)
	}

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(ownerID.String(), pet.ID.String(), req)
	if err == nil {
		t.Fatal("expected error for invalid transition, got nil")
	}
	if err.Error() != domain.ErrInvalidStatusTransition.Error() {
		t.Errorf("expected ErrInvalidStatusTransition, got %v", err)
	}
}

func TestPublishLost_ReportCreationFails_StatusUnchanged(t *testing.T) {
	db := setupSQLiteDB(t)
	uow := repository.NewUnitOfWork(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	pet := &domain.Pet{OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet failed: %v", err)
	}

	// Force the report insert to fail
	if err := db.Migrator().DropTable(&domain.Report{}); err != nil {
		t.Fatalf("failed to drop reports table: %v", err)
	}

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(ownerID.String(), pet.ID.String(), req)
	if err == nil {
		t.Fatal("expected error when report creation fails, got nil")
	}

	// Re-create the reports table to read back the pet status (unaffected by drop)
	reloaded, findErr := petRepo.FindByID(pet.ID.String())
	if findErr != nil {
		t.Fatalf("FindByID failed: %v", findErr)
	}
	if reloaded.Status != domain.PetStatusRegistered {
		t.Errorf("expected status to remain %q after rollback, got %q", domain.PetStatusRegistered, reloaded.Status)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/service/... -run TestPublishLost -v`
Expected: FAIL — `svc.PublishLost` undefined (compile error: `dto.PublishLostRequest` undefined, `PetService.PublishLost` undefined).

- [ ] **Step 3: Add `PublishLostRequest` DTO**

In `backend/internal/dto/pet_dto.go`, add after `InitialReportRequest`:

```go
// PublishLostRequest contains the location data for transitioning an owned,
// registered pet to "lost" with its initial location report — used by
// POST /api/pets/:id/publish-lost.
type PublishLostRequest struct {
	Latitude  float64 `json:"latitude" binding:"required"`
	Longitude float64 `json:"longitude" binding:"required"`
	Note      string  `json:"note"`
}
```

- [ ] **Step 4: Add `PublishLost` to the `PetService` interface and implement it**

In `backend/internal/service/pet_service.go`, add to the `PetService` interface (after `MarkAsFound`):

```go
	// PublishLost transitions an owned pet to "lost" and creates its initial
	// location report atomically. Returns ErrForbidden if the caller does not
	// own the pet, ErrInvalidStatusTransition if the pet's current status
	// cannot transition to "lost".
	PublishLost(ownerID string, petID string, req dto.PublishLostRequest) (*domain.Pet, error)
```

Implement it — add this new method anywhere in the file (e.g. right after `MarkAsFound`'s closing brace):

```go
// PublishLost transitions an owned, registered pet to "lost" and creates its
// initial location report in a single transaction. After commit, publishes
// pet.lost (CLIP embedding backfill) and report.created (nearby push notifications).
func (s *petService) PublishLost(ownerID string, petID string, req dto.PublishLostRequest) (*domain.Pet, error) {
	pet, err := s.repo.FindByID(petID)
	if err != nil {
		return nil, err
	}

	// Solo el dueño puede publicar su mascota como perdida
	if pet.OwnerID == nil || pet.OwnerID.String() != ownerID {
		return nil, domain.ErrForbidden
	}

	// Validar que la transición a "lost" sea permitida desde el status actual
	if err := domain.ValidateTransition(pet.Status, domain.PetStatusLost); err != nil {
		return nil, err
	}

	if s.uow == nil {
		return nil, domain.ErrInternal
	}

	ownerUUID, err := uuid.Parse(ownerID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}

	err = s.uow.Execute(func(tx repository.UnitOfWorkRepos) error {
		if err := tx.Pets.UpdateStatus(petID, domain.PetStatusLost); err != nil {
			return err
		}
		report := &domain.Report{
			PetID:               pet.ID,
			ReporterID:          ownerUUID,
			Status:              "lost",
			Latitude:            req.Latitude,
			Longitude:           req.Longitude,
			LocationDescription: req.Note,
		}
		return tx.Reports.Create(report)
	})
	if err != nil {
		return nil, err
	}

	pet.Status = domain.PetStatusLost
	pet.Version++

	// Publicamos los eventos DESPUÉS del commit — fallos aquí no afectan la transacción ya confirmada
	if s.eventBus != nil {
		s.eventBus.Publish("pet.lost", event.PetLostEvent{PetID: pet.ID})
		s.eventBus.Publish("report.created", event.ReportCreatedEvent{
			PetID:      pet.ID,
			ReporterID: ownerUUID,
			PetOwnerID: ownerUUID,
			PetName:    pet.Name,
			PetType:    pet.Type,
			Status:     "lost",
			Lat:        req.Latitude,
			Lng:        req.Longitude,
		})
	}

	return pet, nil
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestPublishLost -v`
Expected: PASS

- [ ] **Step 6: Run full service test suite**

Run: `go test ./internal/service/... -v 2>&1 | tail -40`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/internal/dto/pet_dto.go backend/internal/service/pet_service.go backend/internal/service/pet_service_test.go
git commit -m "feat(backend): add PublishLost transactional pet+report transition"
```

---

### Task 5: Wire UnitOfWork in router and add `PublishLost` handler + route

**Files:**
- Modify: `backend/internal/app/router.go`
- Modify: `backend/internal/handler/pet_handler.go`
- Test: `backend/internal/handler/pet_handler_test.go` (create if it does not exist — check first)

- [ ] **Step 1: Check for existing pet_handler tests**

Run: `find backend/internal/handler -iname "pet_handler_test.go"`

If it exists, read it to match its mock-service conventions before writing Step 2's test. If it doesn't exist, the test in Step 2 creates the file with a minimal `mockPetService`.

- [ ] **Step 2: Write the failing test**

Create or extend `backend/internal/handler/pet_handler_test.go` with:

```go
package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
)

// mockPetServiceForPublish implements only what PublishLost's handler needs;
// embeds service.PetService via a nil-safe wrapper is unnecessary — Go interfaces
// are structural, so a small struct implementing all methods is required.
// If pet_handler_test.go already defines a fuller mockPetService, extend that one
// instead of declaring this type to avoid duplicate type errors.
type mockPetServiceForPublish struct {
	publishLostPet *domain.Pet
	publishLostErr error
}

func (m *mockPetServiceForPublish) CreatePet(_ string, _ dto.CreatePetRequest) (*domain.Pet, error) {
	return nil, nil
}
func (m *mockPetServiceForPublish) GetPetByID(_ string) (*domain.Pet, error) { return nil, nil }
func (m *mockPetServiceForPublish) GetMyPets(_ string) ([]domain.Pet, error) { return nil, nil }
func (m *mockPetServiceForPublish) UpdatePet(_ string, _ string, _ dto.UpdatePetRequest) (*domain.Pet, error) {
	return nil, nil
}
func (m *mockPetServiceForPublish) DeletePet(_ string, _ string) error { return nil }
func (m *mockPetServiceForPublish) MarkAsFound(_ string, _ string) (*domain.Pet, error) {
	return nil, nil
}
func (m *mockPetServiceForPublish) SearchPets(_ domain.PetSearchCriteria) (dto.PetSearchResponse, error) {
	return dto.PetSearchResponse{}, nil
}
func (m *mockPetServiceForPublish) PublishLost(_ string, _ string, _ dto.PublishLostRequest) (*domain.Pet, error) {
	return m.publishLostPet, m.publishLostErr
}

func TestPublishLostHandler_HappyPath_Returns200(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ownerID := uuid.New()
	petID := uuid.New()
	mockSvc := &mockPetServiceForPublish{
		publishLostPet: &domain.Pet{ID: petID, OwnerID: &ownerID, Name: "Rex", Type: "perro", Status: domain.PetStatusLost, Version: 2},
	}
	h := handler.NewPetHandler(mockSvc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", ownerID.String())
		h.PublishLost(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645, "note": "cerca de casa"})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+petID.String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPublishLostHandler_Forbidden_Returns403(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockPetServiceForPublish{publishLostErr: domain.ErrForbidden}
	h := handler.NewPetHandler(mockSvc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New().String())
		h.PublishLost(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPublishLostHandler_InvalidTransition_Returns422(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockPetServiceForPublish{publishLostErr: domain.ErrInvalidStatusTransition}
	h := handler.NewPetHandler(mockSvc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New().String())
		h.PublishLost(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPublishLostHandler_InvalidLatitude_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockPetServiceForPublish{}
	h := handler.NewPetHandler(mockSvc, nil)

	r := gin.New()
	r.POST("/api/pets/:id/publish-lost", func(c *gin.Context) {
		c.Set("userID", uuid.New().String())
		h.PublishLost(c)
	})

	// latitude out of range [-90, 90]
	body, _ := json.Marshal(map[string]interface{}{"latitude": 120.0, "longitude": -56.1645})
	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/publish-lost", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
```

If `pet_handler_test.go` already defines a `mockPetService` implementing the full `PetService` interface, add only `PublishLost(...)` to that existing mock (with the same `publishLostPet`/`publishLostErr` fields) instead of creating `mockPetServiceForPublish`, and reuse it across the four new tests above (rename references accordingly).

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/handler/... -run TestPublishLostHandler -v`
Expected: FAIL — `h.PublishLost` undefined (compile error).

- [ ] **Step 4: Implement the handler**

In `backend/internal/handler/pet_handler.go`, add this method (e.g. after `MarkAsFound`):

```go
// PublishLost godoc
// POST /api/pets/:id/publish-lost
// Transiciona una mascota propia a "lost" y crea su reporte de ubicación inicial
// en una sola transacción. Solo el dueño puede llamarlo.
func (h *PetHandler) PublishLost(c *gin.Context) {
	ownerID := getUserID(c)
	petID := c.Param("id")

	var req dto.PublishLostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if req.Latitude < -90 || req.Latitude > 90 || req.Longitude < -180 || req.Longitude > 180 {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	pet, err := h.petService.PublishLost(ownerID, petID, req)
	if err != nil {
		if errors.Is(err, domain.ErrPetNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrForbidden) {
			writeError(c, http.StatusForbidden, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeError(c, http.StatusUnprocessableEntity, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToPetResponse(pet))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/handler/... -run TestPublishLostHandler -v`
Expected: PASS

- [ ] **Step 6: Wire UnitOfWork into the router and add the route**

In `backend/internal/app/router.go`, near `petRepo := repository.NewPetRepository(db)` / `reportRepo := repository.NewReportRepository(db)` (around line 78-79), add:

```go
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	petUow := repository.NewUnitOfWork(db)
```

Then update the `petService` construction (the temporary `nil` from Task 3, Step 5):

```go
	petService := service.NewPetService(petRepo, bus, photoService, reportRepo, petUow)
```

Finally, add the route — in the protected group, near `protected.PATCH("/pets/:id/found", petHandler.MarkAsFound)`:

```go
		protected.PATCH("/pets/:id/found", petHandler.MarkAsFound)
		protected.POST("/pets/:id/publish-lost", petHandler.PublishLost)
```

- [ ] **Step 7: Run the full backend test suite**

Run: `go test ./... -v 2>&1 | tail -60`
Expected: PASS — all packages compile and pass, including `internal/app` if it has tests.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/app/router.go backend/internal/handler/pet_handler.go backend/internal/handler/pet_handler_test.go
git commit -m "feat(backend): wire POST /api/pets/:id/publish-lost endpoint"
```

---

### Task 6: Validate latitude/longitude bounds on `POST /api/pets` `initial_report`

**Files:**
- Modify: `backend/internal/handler/pet_handler.go`
- Test: `backend/internal/handler/pet_handler_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/handler/pet_handler_test.go`:

```go
func TestCreatePetHandler_InvalidInitialReportLatitude_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockPetServiceForPublish{}
	h := handler.NewPetHandler(mockSvc, nil)

	r := gin.New()
	r.POST("/api/pets", func(c *gin.Context) {
		c.Set("userID", uuid.New().String())
		h.CreatePet(c)
	})

	body, _ := json.Marshal(map[string]interface{}{
		"name":   "Callejero",
		"type":   "perro",
		"status": "stray",
		"initial_report": map[string]interface{}{
			"latitude":  200.0, // out of range
			"longitude": -56.1645,
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/pets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `go test ./internal/handler/... -run TestCreatePetHandler_InvalidInitialReportLatitude -v`
Expected: FAIL — handler currently calls `h.petService.CreatePet` directly without bounds validation, so `mockSvc.CreatePet` returns `nil, nil` and the handler responds 500 (`ErrInternal` for `errors.Is(err, ...)` falls through) — actually returns 201 because `err == nil`. Either way, not 400.

- [ ] **Step 3: Add validation in `CreatePet` handler**

In `backend/internal/handler/pet_handler.go`, in `CreatePet`, after the `ShouldBindJSON` check:

```go
	var req dto.CreatePetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if req.InitialReport != nil {
		lat, lng := req.InitialReport.Latitude, req.InitialReport.Longitude
		if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
			return
		}
	}
```

Also extend the error handling for the service call to surface the new domain errors with the correct status codes:

```go
	pet, err := h.petService.CreatePet(ownerID, req)
	if err != nil {
		if errors.Is(err, domain.ErrInitialReportRequired) || errors.Is(err, domain.ErrInitialReportNotAllowed) || errors.Is(err, domain.ErrInvalidStatusTransition) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/handler/... -run TestCreatePetHandler_InvalidInitialReportLatitude -v`
Expected: PASS

- [ ] **Step 5: Add coverage for `initial_report_required` and `initial_report_not_allowed` returning 400**

Append to `backend/internal/handler/pet_handler_test.go`:

```go
func TestCreatePetHandler_InitialReportRequired_Returns400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockPetServiceForPublish{}
	mockSvc.createPetErr = domain.ErrInitialReportRequired // requires adding this field — see note below
	h := handler.NewPetHandler(mockSvc, nil)

	r := gin.New()
	r.POST("/api/pets", func(c *gin.Context) {
		c.Set("userID", uuid.New().String())
		h.CreatePet(c)
	})

	body, _ := json.Marshal(map[string]interface{}{"name": "Callejero", "type": "perro", "status": "stray"})
	req := httptest.NewRequest(http.MethodPost, "/api/pets", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
```

Add a `createPetErr error` field to `mockPetServiceForPublish` and return it from `CreatePet`:

```go
type mockPetServiceForPublish struct {
	publishLostPet *domain.Pet
	publishLostErr error
	createPetErr   error
}

func (m *mockPetServiceForPublish) CreatePet(_ string, _ dto.CreatePetRequest) (*domain.Pet, error) {
	if m.createPetErr != nil {
		return nil, m.createPetErr
	}
	return &domain.Pet{}, nil
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `go test ./internal/handler/... -run TestCreatePetHandler -v`
Expected: PASS

- [ ] **Step 7: Run full backend suite**

Run: `go test ./... 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/internal/handler/pet_handler.go backend/internal/handler/pet_handler_test.go
git commit -m "feat(backend): validate initial_report coordinates and surface 400 codes on POST /api/pets"
```

---

### Task 7: E2E flow test — publish-lost end to end

**Files:**
- Create: `backend/tests/e2e/publish_flow_test.go`

- [ ] **Step 1: Read an existing flow test for the harness pattern**

Run: `head -30 backend/tests/e2e/report_flow_test.go` to confirm `startTestServer`/`registerAndLogin` helper signatures (already confirmed in `pet_flow_test.go`: `startTestServer(t) (baseURL string, cleanup func())` and `registerAndLogin(t, baseURL) (token string, userID string)`).

- [ ] **Step 2: Write the E2E test**

Create `backend/tests/e2e/publish_flow_test.go`:

```go
//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestPublishFlow_RegisterPetThenPublishLost(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// ── Step 1: register a pet (status omitted → "registered") ─────
	createBody, _ := json.Marshal(map[string]interface{}{
		"name": "Rex",
		"type": "perro",
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create pet: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create pet: want 201, got %d", resp.StatusCode)
	}

	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("create pet: decode failed: %v", err)
	}
	if created.Status != "registered" {
		t.Fatalf("expected status 'registered', got %q", created.Status)
	}

	// ── Step 2: publish-lost ─────────────────────────────────────
	publishBody, _ := json.Marshal(map[string]interface{}{
		"latitude":  -34.9011,
		"longitude": -56.1645,
		"note":      "Se escapó por el portón",
	})
	req2, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets/"+created.ID+"/publish-lost", bytes.NewReader(publishBody))
	req2.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req2.Header.Set("Content-Type", "application/json")

	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("publish-lost: request failed: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("publish-lost: want 200, got %d", resp2.StatusCode)
	}

	var published struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&published); err != nil {
		t.Fatalf("publish-lost: decode failed: %v", err)
	}
	if published.Status != "lost" {
		t.Fatalf("expected status 'lost', got %q", published.Status)
	}

	// ── Step 3: GET /api/reports/nearby returns the new report ────
	resp3, err := http.Get(fmt.Sprintf("%s/api/reports/nearby?lat=-34.9011&lng=-56.1645&radius=5000", baseURL))
	if err != nil {
		t.Fatalf("nearby: request failed: %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK {
		t.Fatalf("nearby: want 200, got %d", resp3.StatusCode)
	}

	var nearby struct {
		Data []struct {
			PetID  string `json:"pet_id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp3.Body).Decode(&nearby); err != nil {
		t.Fatalf("nearby: decode failed: %v", err)
	}
	found := false
	for _, r := range nearby.Data {
		if r.PetID == created.ID && r.Status == "lost" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected nearby reports to include pet %s with status 'lost'", created.ID)
	}
}

func TestPublishFlow_CreateStrayWithInitialReport(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	createBody, _ := json.Marshal(map[string]interface{}{
		"name":   "",
		"type":   "gato",
		"status": "stray",
		"initial_report": map[string]interface{}{
			"latitude":  -34.9011,
			"longitude": -56.1645,
			"note":      "Gato gris visto en la plaza",
		},
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create stray: request failed: %v", err)
	}
	defer resp.Body.Close()

	// "name" is required by binding:"required" — expect 400 here.
	// Re-send with a name to verify the happy path.
	if resp.StatusCode == http.StatusBadRequest {
		createBody2, _ := json.Marshal(map[string]interface{}{
			"name":   "Sin nombre",
			"type":   "gato",
			"status": "stray",
			"initial_report": map[string]interface{}{
				"latitude":  -34.9011,
				"longitude": -56.1645,
				"note":      "Gato gris visto en la plaza",
			},
		})
		req3, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody2))
		req3.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
		req3.Header.Set("Content-Type", "application/json")
		resp3, err := http.DefaultClient.Do(req3)
		if err != nil {
			t.Fatalf("create stray (retry): request failed: %v", err)
		}
		defer resp3.Body.Close()
		if resp3.StatusCode != http.StatusCreated {
			t.Fatalf("create stray: want 201, got %d", resp3.StatusCode)
		}

		var created struct {
			ID       string  `json:"id"`
			Status   string  `json:"status"`
			OwnerID  *string `json:"owner_id"`
		}
		if err := json.NewDecoder(resp3.Body).Decode(&created); err != nil {
			t.Fatalf("create stray: decode failed: %v", err)
		}
		if created.Status != "stray" {
			t.Fatalf("expected status 'stray', got %q", created.Status)
		}
		if created.OwnerID != nil {
			t.Errorf("expected owner_id to be nil for stray pets, got %v", *created.OwnerID)
		}

		resp4, err := http.Get(baseURL + "/api/reports/pet/" + created.ID)
		if err != nil {
			t.Fatalf("reports/pet: request failed: %v", err)
		}
		defer resp4.Body.Close()
		if resp4.StatusCode != http.StatusOK {
			t.Fatalf("reports/pet: want 200, got %d", resp4.StatusCode)
		}
		var reports []struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(resp4.Body).Decode(&reports); err != nil {
			t.Fatalf("reports/pet: decode failed: %v", err)
		}
		if len(reports) != 1 || reports[0].Status != "sighting" {
			t.Fatalf("expected 1 'sighting' report, got %+v", reports)
		}
	} else if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create stray: want 201 or 400 (empty name), got %d", resp.StatusCode)
	}
}
```

- [ ] **Step 3: Run the E2E suite**

Run (from `backend/`): `go test -tags=e2e ./tests/e2e/... -run TestPublishFlow -v`
Expected: PASS — both new flow tests pass alongside the 3 existing flows.

- [ ] **Step 4: Run the full E2E suite to check no regression**

Run: `go test -tags=e2e ./tests/e2e/... -v 2>&1 | tail -40`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tests/e2e/publish_flow_test.go
git commit -m "test(backend): add E2E flow tests for publish-lost and stray initial_report"
```

---
