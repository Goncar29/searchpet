# Admin Moderation Actions — Backend (#13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin moderation endpoints — delete a reported location report, and ban/unban a reported user — plus expose `is_banned` on the abuse-report user ref.

**Architecture:** Clean Architecture (Handler → Service → Repository). Report deletion extends the existing `ReportService`/`ReportRepository`. User ban/unban lives in a new `ModerationService` (depends on `UserRepository`). All three endpoints hang off the existing `RequireAdmin` route group. Errors use `writeError(c, status, err)` → `{code, message}`.

**Tech Stack:** Go 1.25 + Gin + GORM. Tests: Go `testing`; repo tests use the `lostpets_test` Postgres DB.

## Test DB note (repo tests only)

Repo-layer tests use `testdb.SetupTestDB(t)`, which **SKIPS** without `DATABASE_URL` and **TRUNCATES all tables** — only ever point it at `lostpets_test`. Service/handler/DTO tests use mocks and need no DB. Run repo tests with:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./...
```

This is PR1 of 2. PR2 (#14, frontend confirmation modals) is planned separately after this merges. Branch: `feat/admin-moderation-actions` (off `main`, already created with the design doc committed).

## File Structure

- `backend/internal/repository/interfaces.go` — add `Delete` to `ReportRepository`.
- `backend/internal/repository/report_repository.go` — implement `Delete`.
- `backend/tests/report_repository_test.go` — repo `Delete` tests.
- `backend/internal/service/report_service.go` — add `Delete` to the interface + impl.
- `backend/internal/service/report_service_test.go` — service `Delete` test (mock repo).
- `backend/internal/domain/errors.go` — add `ErrCannotModerateAdmin`.
- `backend/internal/dto/moderation_dto.go` — NEW: `BanUserRequest`.
- `backend/internal/service/moderation_service.go` — NEW: `ModerationService` (BanUser/UnbanUser).
- `backend/internal/service/moderation_service_test.go` — NEW: ban/unban unit tests (mock `UserRepository`).
- `backend/internal/handler/report_handler.go` — add admin `DeleteReport`.
- `backend/tests/report_handler_test.go` — `DeleteReport` handler tests.
- `backend/internal/handler/moderation_handler.go` — NEW: `BanUser`/`UnbanUser` handlers.
- `backend/tests/moderation_handler_test.go` — NEW: handler tests.
- `backend/internal/dto/abuse_report_dto.go` — add `IsBanned` to `AbuseUserRef` + mapping.
- `backend/tests/abuse_report_dto_test.go` — assert `is_banned` mapping.
- `backend/internal/app/router.go` — wire the three endpoints + construct `ModerationService`/handler.

---

### Task 1: ReportRepository.Delete (repository layer)

**Files:**
- Modify: `backend/internal/repository/interfaces.go`
- Modify: `backend/internal/repository/report_repository.go`
- Test: `backend/tests/report_repository_test.go`

- [ ] **Step 1: Write the failing repo test.** Append to `backend/tests/report_repository_test.go`:

```go
func TestReportRepository_Delete_RemovesRow(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Toby", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	rep := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID, Status: "lost", Latitude: -34.9, Longitude: -56.16}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	if err := reportRepo.Delete(ctx, rep.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	if _, err := reportRepo.FindByID(rep.ID.String()); !errors.Is(err, domain.ErrReportNotFound) {
		t.Errorf("want ErrReportNotFound after delete, got %v", err)
	}
}

func TestReportRepository_Delete_MissingReturnsNotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	reportRepo := repository.NewReportRepository(gormDB)

	err := reportRepo.Delete(context.Background(), uuid.New())
	if !errors.Is(err, domain.ErrReportNotFound) {
		t.Errorf("want ErrReportNotFound for missing report, got %v", err)
	}
}
```

Confirm the file already imports `context`, `errors`, `github.com/google/uuid`, `lost-pets/internal/domain`, `lost-pets/internal/repository`, and `lost-pets/tests/testdb`. Add any missing ones.

- [ ] **Step 2: Run to verify it FAILS.**

Run: `DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestReportRepository_Delete -v`
Expected: COMPILE FAIL — `reportRepo.Delete undefined`.

- [ ] **Step 3: Add `Delete` to the interface.** In `backend/internal/repository/interfaces.go`, inside `ReportRepository`, after the `UpdateVerified` line, add:

```go
	// Delete removes a report by id (admin moderation). Returns ErrReportNotFound if absent.
	Delete(ctx context.Context, id uuid.UUID) error
```

- [ ] **Step 4: Implement `Delete`.** In `backend/internal/repository/report_repository.go`, after `UpdateVerified`, add:

```go
// Delete elimina un reporte por id (acción de moderación admin).
// Hard delete: el report es una fila casi-hoja (las fotos cuelgan del Pet y
// Message.ReportID es un puntero nullable sin FK que bloquee).
func (r *PostgresReportRepository) Delete(ctx context.Context, id uuid.UUID) error {
	result := r.db.WithContext(ctx).Where("id = ?", id).Delete(&domain.Report{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrReportNotFound
	}
	return nil
}
```

- [ ] **Step 5: Run to verify it PASSES.**

Run: `DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestReportRepository_Delete -v`
Expected: PASS (both subtests).

- [ ] **Step 6: Commit.**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/report_repository.go backend/tests/report_repository_test.go
git commit -m "feat(api): add ReportRepository.Delete (#13)"
```

---

### Task 2: ReportService.Delete (service layer)

**Files:**
- Modify: `backend/internal/service/report_service.go`
- Test: `backend/internal/service/report_service_test.go`

- [ ] **Step 1: Write the failing service test.** Append to `backend/internal/service/report_service_test.go` (this package's mock `ReportRepository` must gain a `Delete` method — see Step 3). Add:

```go
func TestReportService_Delete_DelegatesToRepo(t *testing.T) {
	var deletedID uuid.UUID
	repo := &mockReportRepo{
		deleteFn: func(_ context.Context, id uuid.UUID) error { deletedID = id; return nil },
	}
	svc := NewReportService(repo, nil, nil)

	id := uuid.New()
	if err := svc.Delete(context.Background(), id); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if deletedID != id {
		t.Errorf("want repo.Delete called with %s, got %s", id, deletedID)
	}
}

func TestReportService_Delete_PropagatesNotFound(t *testing.T) {
	repo := &mockReportRepo{
		deleteFn: func(_ context.Context, _ uuid.UUID) error { return domain.ErrReportNotFound },
	}
	svc := NewReportService(repo, nil, nil)

	err := svc.Delete(context.Background(), uuid.New())
	if !errors.Is(err, domain.ErrReportNotFound) {
		t.Errorf("want ErrReportNotFound, got %v", err)
	}
}
```

NOTE: this assumes a `mockReportRepo` with a `deleteFn` field exists in this test file. If the existing mock in `report_service_test.go` has a different name, use that name and add a `deleteFn` field + `Delete` method to it. If no mock exists yet, add this minimal one (implementing the full `repository.ReportRepository` interface — `Create`, `FindByID`, `FindByPetID`, `FindNearby`, `UpdateVerified`, `Delete`):

```go
type mockReportRepo struct {
	deleteFn func(ctx context.Context, id uuid.UUID) error
}

func (m *mockReportRepo) Create(*domain.Report) error                              { return nil }
func (m *mockReportRepo) FindByID(string) (*domain.Report, error)                  { return nil, nil }
func (m *mockReportRepo) FindByPetID(string) ([]domain.Report, error)              { return nil, nil }
func (m *mockReportRepo) FindNearby(float64, float64, float64) ([]domain.Report, error) { return nil, nil }
func (m *mockReportRepo) UpdateVerified(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (m *mockReportRepo) Delete(ctx context.Context, id uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id)
	}
	return nil
}

var _ repository.ReportRepository = (*mockReportRepo)(nil)
```

- [ ] **Step 2: Run to verify it FAILS.**

Run: `go test ./internal/service/ -run TestReportService_Delete -v`
Expected: COMPILE FAIL — `svc.Delete undefined` (and/or mock missing `Delete`).

- [ ] **Step 3: Add `Delete` to the interface + impl.** In `backend/internal/service/report_service.go`, add to the `ReportService` interface after `VerifyReport`:

```go
	// Delete removes a report (admin moderation; admin enforcement is in the handler).
	Delete(ctx context.Context, id uuid.UUID) error
```

Then add the impl after `VerifyReport`:

```go
// Delete elimina un reporte (acción de moderación admin).
// Admin-only enforcement se hace en el handler mediante RequireAdmin.
func (s *reportService) Delete(ctx context.Context, id uuid.UUID) error {
	return s.repo.Delete(ctx, id)
}
```

- [ ] **Step 4: Run to verify it PASSES.**

Run: `go test ./internal/service/ -run TestReportService_Delete -v`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/internal/service/report_service.go backend/internal/service/report_service_test.go
git commit -m "feat(api): add ReportService.Delete (#13)"
```

---

### Task 3: DeleteReport handler + route

**Files:**
- Modify: `backend/internal/handler/report_handler.go`
- Modify: `backend/internal/app/router.go`
- Test: `backend/tests/report_handler_test.go`

- [ ] **Step 1: Write the failing handler test.** Append to `backend/tests/report_handler_test.go`, following the existing handler-test setup in that file (reuse its router/gin helper and mock service if present). The handler under test:
- returns 200 with `{"message": ...}` on success,
- returns 404 `{code:"report_not_found"}` when the service returns `ErrReportNotFound`,
- returns 400 `{code:"invalid_input"}` on a non-UUID id.

```go
func TestReportHandler_DeleteReport_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockReportService{deleteFn: func(_ context.Context, _ uuid.UUID) error { return nil }}
	h := handler.NewReportHandler(svc, nil)

	r := gin.New()
	r.DELETE("/api/admin/reports/:id", h.DeleteReport)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/reports/"+uuid.New().String(), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestReportHandler_DeleteReport_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockReportService{deleteFn: func(_ context.Context, _ uuid.UUID) error { return domain.ErrReportNotFound }}
	h := handler.NewReportHandler(svc, nil)

	r := gin.New()
	r.DELETE("/api/admin/reports/:id", h.DeleteReport)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/reports/"+uuid.New().String(), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "report_not_found") {
		t.Errorf("want report_not_found code, got %s", w.Body.String())
	}
}

func TestReportHandler_DeleteReport_BadID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewReportHandler(&mockReportService{}, nil)

	r := gin.New()
	r.DELETE("/api/admin/reports/:id", h.DeleteReport)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/reports/not-a-uuid", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}
```

NOTE: reuse the file's existing `mockReportService`. Add a `deleteFn func(context.Context, uuid.UUID) error` field to it and a `Delete` method:

```go
func (m *mockReportService) Delete(ctx context.Context, id uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id)
	}
	return nil
}
```

Ensure imports include `net/http`, `net/http/httptest`, `strings`, `github.com/gin-gonic/gin`, `github.com/google/uuid`, `lost-pets/internal/domain`, `lost-pets/internal/handler`.

- [ ] **Step 2: Run to verify it FAILS.**

Run: `go test ./tests/ -run TestReportHandler_DeleteReport -v`
Expected: COMPILE FAIL — `h.DeleteReport undefined` (and mock missing `Delete`).

- [ ] **Step 3: Implement the handler.** In `backend/internal/handler/report_handler.go`, add (mirror the `Resolve` handler in `abuse_report_handler.go`):

```go
// DeleteReport godoc
// DELETE /api/admin/reports/:id  (admin only — gated by RequireAdmin)
// Deletes the reported location report as a moderation action.
func (h *ReportHandler) DeleteReport(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.reportService.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, domain.ErrReportNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "report deleted"})
}
```

Confirm `report_handler.go` imports `errors`, `net/http`, `github.com/gin-gonic/gin`, `github.com/google/uuid`, `lost-pets/internal/domain`. Add any missing. Confirm the handler struct field for the service is named `reportService` (it is constructed via `NewReportHandler(reportService, userRepo)`); if the field has a different name, use it.

- [ ] **Step 4: Wire the route.** In `backend/internal/app/router.go`, inside the `admin` group block (after `admin.PATCH("/admin/reports/:id/verify", reportHandler.VerifyReport)`), add:

```go
		admin.DELETE("/admin/reports/:id", reportHandler.DeleteReport)
```

- [ ] **Step 5: Run to verify it PASSES + build.**

Run: `go test ./tests/ -run TestReportHandler_DeleteReport -v && go build ./...`
Expected: PASS + clean build.

- [ ] **Step 6: Commit.**

```bash
git add backend/internal/handler/report_handler.go backend/internal/app/router.go backend/tests/report_handler_test.go
git commit -m "feat(api): admin DELETE /admin/reports/:id (#13)"
```

---

### Task 4: ModerationService — ban/unban (service layer)

**Files:**
- Modify: `backend/internal/domain/errors.go`
- Create: `backend/internal/dto/moderation_dto.go`
- Create: `backend/internal/service/moderation_service.go`
- Create: `backend/internal/service/moderation_service_test.go`

- [ ] **Step 1: Add the domain error.** In `backend/internal/domain/errors.go`, add to the `var (...)` error block (near `ErrUserNotFound`):

```go
	ErrCannotModerateAdmin = errors.New("no se puede moderar a un administrador")
```

And add to the `CodeFor` map (near the `ErrUserNotFound` entry):

```go
	ErrCannotModerateAdmin: "cannot_moderate_admin",
```

- [ ] **Step 2: Add the request DTO.** Create `backend/internal/dto/moderation_dto.go`:

```go
package dto

// BanUserRequest is the optional body for banning a user.
type BanUserRequest struct {
	Reason string `json:"reason" binding:"max=500"`
}
```

- [ ] **Step 3: Write the failing service test.** Create `backend/internal/service/moderation_service_test.go`:

```go
package service

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

type mockUserRepoForMod struct {
	getByIDFn func(ctx context.Context, id uuid.UUID) (*domain.User, error)
	updateFn  func(ctx context.Context, u *domain.User) error
}

func (m *mockUserRepoForMod) Create(context.Context, *domain.User) error { return nil }
func (m *mockUserRepoForMod) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return m.getByIDFn(ctx, id)
}
func (m *mockUserRepoForMod) GetByEmail(context.Context, string) (*domain.User, error) {
	return nil, nil
}
func (m *mockUserRepoForMod) Update(ctx context.Context, u *domain.User) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, u)
	}
	return nil
}
func (m *mockUserRepoForMod) Delete(context.Context, uuid.UUID) error { return nil }

var _ repository.UserRepository = (*mockUserRepoForMod)(nil)

func TestModerationService_BanUser_SetsBannedAndReason(t *testing.T) {
	id := uuid.New()
	var saved *domain.User
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsAdmin: false}, nil
		},
		updateFn: func(_ context.Context, u *domain.User) error { saved = u; return nil },
	}
	svc := NewModerationService(repo)

	if err := svc.BanUser(context.Background(), id, "spam"); err != nil {
		t.Fatalf("BanUser: %v", err)
	}
	if saved == nil || !saved.IsBanned || saved.BanReason != "spam" {
		t.Errorf("want banned with reason 'spam', got %+v", saved)
	}
}

func TestModerationService_BanUser_RejectsAdmin(t *testing.T) {
	id := uuid.New()
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsAdmin: true}, nil
		},
	}
	svc := NewModerationService(repo)

	err := svc.BanUser(context.Background(), id, "x")
	if !errors.Is(err, domain.ErrCannotModerateAdmin) {
		t.Errorf("want ErrCannotModerateAdmin, got %v", err)
	}
}

func TestModerationService_BanUser_PropagatesNotFound(t *testing.T) {
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	svc := NewModerationService(repo)

	err := svc.BanUser(context.Background(), uuid.New(), "x")
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestModerationService_UnbanUser_ClearsBan(t *testing.T) {
	id := uuid.New()
	var saved *domain.User
	repo := &mockUserRepoForMod{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
			return &domain.User{ID: id, IsBanned: true, BanReason: "spam"}, nil
		},
		updateFn: func(_ context.Context, u *domain.User) error { saved = u; return nil },
	}
	svc := NewModerationService(repo)

	if err := svc.UnbanUser(context.Background(), id); err != nil {
		t.Fatalf("UnbanUser: %v", err)
	}
	if saved == nil || saved.IsBanned || saved.BanReason != "" {
		t.Errorf("want unbanned with cleared reason, got %+v", saved)
	}
}
```

- [ ] **Step 4: Run to verify it FAILS.**

Run: `go test ./internal/service/ -run TestModerationService -v`
Expected: COMPILE FAIL — `NewModerationService undefined`.

- [ ] **Step 5: Implement the service.** Create `backend/internal/service/moderation_service.go`:

```go
package service

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// ModerationService owns admin user-moderation actions (ban/unban).
// Admin-only enforcement is done in the handler via RequireAdmin.
type ModerationService interface {
	BanUser(ctx context.Context, targetID uuid.UUID, reason string) error
	UnbanUser(ctx context.Context, targetID uuid.UUID) error
}

type moderationService struct {
	userRepo repository.UserRepository
}

// NewModerationService construye el ModerationService.
func NewModerationService(userRepo repository.UserRepository) ModerationService {
	return &moderationService{userRepo: userRepo}
}

// BanUser marca al usuario como baneado (IsBanned + BanReason).
// Rechaza banear a un admin (cubre también el auto-ban de un admin).
func (s *moderationService) BanUser(ctx context.Context, targetID uuid.UUID, reason string) error {
	user, err := s.userRepo.GetByID(ctx, targetID)
	if err != nil {
		return err // ErrUserNotFound se propaga
	}
	if user.IsAdmin {
		return domain.ErrCannotModerateAdmin
	}
	user.IsBanned = true
	user.BanReason = reason
	return s.userRepo.Update(ctx, user)
}

// UnbanUser limpia el baneo. Idempotente: desbanear a uno no baneado es no-op success.
func (s *moderationService) UnbanUser(ctx context.Context, targetID uuid.UUID) error {
	user, err := s.userRepo.GetByID(ctx, targetID)
	if err != nil {
		return err
	}
	user.IsBanned = false
	user.BanReason = ""
	return s.userRepo.Update(ctx, user)
}
```

- [ ] **Step 6: Run to verify it PASSES.**

Run: `go test ./internal/service/ -run TestModerationService -v`
Expected: PASS (all subtests).

- [ ] **Step 7: Commit.**

```bash
git add backend/internal/domain/errors.go backend/internal/dto/moderation_dto.go backend/internal/service/moderation_service.go backend/internal/service/moderation_service_test.go
git commit -m "feat(api): add ModerationService ban/unban (#13)"
```

---

### Task 5: Moderation handler + routes

**Files:**
- Create: `backend/internal/handler/moderation_handler.go`
- Modify: `backend/internal/app/router.go`
- Test: `backend/tests/moderation_handler_test.go`

- [ ] **Step 1: Write the failing handler test.** Create `backend/tests/moderation_handler_test.go`:

```go
package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

type mockModerationService struct {
	banFn   func(ctx context.Context, id uuid.UUID, reason string) error
	unbanFn func(ctx context.Context, id uuid.UUID) error
}

func (m *mockModerationService) BanUser(ctx context.Context, id uuid.UUID, reason string) error {
	return m.banFn(ctx, id, reason)
}
func (m *mockModerationService) UnbanUser(ctx context.Context, id uuid.UUID) error {
	return m.unbanFn(ctx, id)
}

var _ service.ModerationService = (*mockModerationService)(nil)

func TestModerationHandler_BanUser_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotReason string
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, reason string) error {
		gotReason = reason
		return nil
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(`{"reason":"spam"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if gotReason != "spam" {
		t.Errorf("want reason 'spam', got %q", gotReason)
	}
}

func TestModerationHandler_BanUser_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, _ string) error {
		return domain.ErrUserNotFound
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "user_not_found") {
		t.Fatalf("want 404 user_not_found, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_BanUser_RejectsAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, _ string) error {
		return domain.ErrCannotModerateAdmin
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "cannot_moderate_admin") {
		t.Fatalf("want 400 cannot_moderate_admin, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_UnbanUser_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockModerationService{unbanFn: func(_ context.Context, _ uuid.UUID) error { return nil }}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/unban", h.UnbanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/unban", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_BanUser_BadID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewModerationHandler(&mockModerationService{})

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/not-a-uuid/ban",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Run to verify it FAILS.**

Run: `go test ./tests/ -run TestModerationHandler -v`
Expected: COMPILE FAIL — `handler.NewModerationHandler undefined`.

- [ ] **Step 3: Implement the handler.** Create `backend/internal/handler/moderation_handler.go`:

```go
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ModerationHandler handles admin user-moderation actions.
type ModerationHandler struct {
	moderationService service.ModerationService
}

// NewModerationHandler crea una instancia del ModerationHandler.
func NewModerationHandler(moderationService service.ModerationService) *ModerationHandler {
	return &ModerationHandler{moderationService: moderationService}
}

// BanUser godoc
// PATCH /api/admin/users/:id/ban  (admin only — gated by RequireAdmin)
func (h *ModerationHandler) BanUser(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	var req dto.BanUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	if err := h.moderationService.BanUser(c.Request.Context(), id, req.Reason); err != nil {
		switch {
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrCannotModerateAdmin):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user banned"})
}

// UnbanUser godoc
// PATCH /api/admin/users/:id/unban  (admin only — gated by RequireAdmin)
func (h *ModerationHandler) UnbanUser(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	if err := h.moderationService.UnbanUser(c.Request.Context(), id); err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "user unbanned"})
}
```

NOTE: an empty/absent JSON body must still bind. `ShouldBindJSON` on an empty body returns an error; the unban endpoint sends no body and does not bind (correct). For ban, the test always sends `{}` or a body, so binding succeeds. If a future caller sends ban with no body, that is a 400 — acceptable (the body is optional only in content, but the endpoint expects a JSON object; callers send `{}`). The frontend (PR2) always sends a JSON object.

- [ ] **Step 4: Construct + wire in the router.** In `backend/internal/app/router.go`:

Construct the service near the other service constructions (after `reportService := ...`, around line 107):

```go
	moderationService := service.NewModerationService(userRepo)
```

Construct the handler near the other handler constructions (after `reportHandler := ...`, around line 184):

```go
	moderationHandler := handler.NewModerationHandler(moderationService)
```

Add the routes inside the `admin` group block (after the `admin.DELETE("/admin/reports/:id", ...)` line from Task 3):

```go
		admin.PATCH("/admin/users/:id/ban", moderationHandler.BanUser)
		admin.PATCH("/admin/users/:id/unban", moderationHandler.UnbanUser)
```

- [ ] **Step 5: Run to verify it PASSES + build.**

Run: `go test ./tests/ -run TestModerationHandler -v && go build ./...`
Expected: PASS + clean build.

- [ ] **Step 6: Commit.**

```bash
git add backend/internal/handler/moderation_handler.go backend/internal/app/router.go backend/tests/moderation_handler_test.go
git commit -m "feat(api): admin ban/unban user endpoints (#13)"
```

---

### Task 6: Expose is_banned on AbuseUserRef

**Files:**
- Modify: `backend/internal/dto/abuse_report_dto.go`
- Test: `backend/tests/abuse_report_dto_test.go`

- [ ] **Step 1: Write the failing DTO test.** Append to `backend/tests/abuse_report_dto_test.go`:

```go
func TestToAbuseReportResponse_TargetUserIsBanned(t *testing.T) {
	targetUserID := uuid.New()
	r := &domain.ReportAbuse{
		ID:           uuid.New(),
		ReporterID:   uuid.New(),
		TargetUserID: &targetUserID,
		Reason:       "spam",
		Status:       "pending",
		TargetUser:   &domain.User{ID: targetUserID, Name: "Bob", IsBanned: true},
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.TargetUser == nil || !resp.TargetUser.IsBanned {
		t.Errorf("want target_user.is_banned=true, got %+v", resp.TargetUser)
	}
}
```

- [ ] **Step 2: Run to verify it FAILS.**

Run: `go test ./tests/ -run TestToAbuseReportResponse_TargetUserIsBanned -v`
Expected: COMPILE FAIL — `resp.TargetUser.IsBanned undefined`.

- [ ] **Step 3: Add the field + map it.** In `backend/internal/dto/abuse_report_dto.go`, change `AbuseUserRef` to:

```go
// AbuseUserRef is a minimal user reference for admin enrichment.
type AbuseUserRef struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	IsBanned bool      `json:"is_banned"`
}
```

Then in `ToAbuseReportResponse`, update both ref assignments to populate `IsBanned`:

```go
	if r.Reporter.ID != (uuid.UUID{}) {
		resp.Reporter = &AbuseUserRef{ID: r.Reporter.ID, Name: r.Reporter.Name, IsBanned: r.Reporter.IsBanned}
	}
	if r.TargetUser != nil && r.TargetUser.ID != (uuid.UUID{}) {
		resp.TargetUser = &AbuseUserRef{ID: r.TargetUser.ID, Name: r.TargetUser.Name, IsBanned: r.TargetUser.IsBanned}
	}
```

- [ ] **Step 4: Run to verify it PASSES.**

Run: `go test ./tests/ -run TestToAbuseReportResponse -v`
Expected: PASS (the new test + the existing enrichment tests).

- [ ] **Step 5: Commit.**

```bash
git add backend/internal/dto/abuse_report_dto.go backend/tests/abuse_report_dto_test.go
git commit -m "feat(api): expose is_banned on abuse report user ref (#13)"
```

---

### Task 7: Full verification + PR

- [ ] **Step 1: Full backend suite (with DB).**

Run: `cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./...`
Expected: all PASS.

- [ ] **Step 2: Build + vet.**

Run: `cd backend && go build ./... && go vet ./...`
Expected: clean.

- [ ] **Step 3: Open the PR.** Follow the `searchpet-pr` skill conventions. Branch `feat/admin-moderation-actions` off `main`. Conventional commits, NO Co-Authored-By. Push and open the PR; the user controls the merge. PR title:

```
feat(api): admin moderation endpoints — delete report, ban/unban user (#13)
```

PR body should note: 3 new admin endpoints (DELETE /admin/reports/:id, PATCH /admin/users/:id/ban, /unban) + `is_banned` on the abuse-report user ref; the known limitation that ban is enforced at login only (active token sessions persist up to 72h); and that the frontend (#14) follows in a separate PR.

---

## Self-Review

**Spec coverage:**
- Delete reported content → Tasks 1–3 (repo/service/handler + route). ✓
- Ban/unban user → Tasks 4–5 (ModerationService + handler + routes). ✓
- Ban rejects admin (400) → Task 4 (`ErrCannotModerateAdmin`) + Task 5 handler mapping. ✓
- 404 on missing report/user → Tasks 1/3 (report) + 4/5 (user). ✓
- `is_banned` on `AbuseUserRef` → Task 6. ✓
- `{code,message}` errors via `writeError` → all handlers (Tasks 3, 5). ✓
- Admin gating → routes added under the existing `RequireAdmin` group (Tasks 3, 5); not re-implemented. ✓
- Known limitation (login-only ban) → documented in spec + PR body (Task 7). Not code. ✓
- Out of scope (hard delete, kill active session, i18n, auto-resolve) → not implemented. ✓

**Placeholder scan:** Every code step shows complete code. No TBD/TODO.

**Type consistency:** `ReportRepository.Delete(ctx, uuid)` / `ReportService.Delete(ctx, uuid)` / `ReportHandler.DeleteReport` consistent. `ModerationService.BanUser(ctx, uuid, string)` / `UnbanUser(ctx, uuid)` match the mock, the impl, and the handler calls. `AbuseUserRef.IsBanned` (`json:"is_banned"`) matches Task 6 mapping. `ErrCannotModerateAdmin` → code `cannot_moderate_admin` consistent across Task 4 (errors.go) and Task 5 (handler test assertion). `dto.BanUserRequest.Reason` (`json:"reason"`) matches the handler bind and the test bodies.
