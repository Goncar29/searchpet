# Admin Role Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an existing admin grant/revoke another user's admin role from inside the web app, by exact email, with anti-lockout guards and a persistent audit trail.

**Architecture:** New `AdminRepository` owns the atomic flag-flip + audit-insert transaction and the admin count. A new HTTP-only `AdminService` holds the business guards (no self-revoke, no last-admin revoke, idempotency) and is wired into the existing `RequireAdmin` route group. The CLI (`admintool.SetAdmin`) stays unguarded as the recovery path. The web admin panel gets a new "Administradores" page.

**Tech Stack:** Go 1.25 + Gin + GORM (backend), React + Vite + React Query + i18next (web). Test DB via `tests/testdb`.

**Spec:** `docs/superpowers/specs/2026-06-27-admin-role-management-design.md`

**Design refinement vs spec:** `CountAdmins` and the same-tx write live on a new `AdminRepository`, NOT on `UserRepository`. Adding a method to `UserRepository` would break its mocks (`mockUserRepoForMod`, `mockUserRepo`, `mockUserRepository`). A dedicated repo keeps the transaction in the data layer and avoids that blast radius.

---

## File Structure

**Backend — create:**
- `backend/internal/repository/admin_repository.go` — `AdminRepository` interface + GORM impl (tx flip+audit, count, list)
- `backend/internal/service/admin_service.go` — `AdminService` with guards
- `backend/internal/service/admin_service_test.go` — unit tests (mocks)
- `backend/internal/handler/admin_handler.go` — HTTP handlers
- `backend/internal/dto/admin_dto.go` — request/response DTOs + mappers
- `backend/tests/admin_repository_test.go` — integration tests (real test DB)

**Backend — modify:**
- `backend/internal/domain/models.go` — add `AdminAuditLog` struct
- `backend/internal/domain/errors.go` — add `ErrCannotRevokeSelf`, `ErrCannotRevokeLastAdmin` + codes
- `backend/pkg/database/postgres.go` — register `AdminAuditLog` in AutoMigrate
- `backend/internal/app/router.go` — wire repo/service/handler + 2 routes

**Frontend — create:**
- `frontend/packages/web/src/pages/admin/AdminsPage.tsx`

**Frontend — modify:**
- `frontend/packages/shared/types/index.ts` — `AdminAuditEntry` type
- `frontend/packages/shared/api/client.ts` — `setUserAdmin`, `getRoleChanges`
- `frontend/packages/shared/i18n/locales/{es,en,pt}.json` — 2 new error keys
- `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — `admin.admins.*` + `admin.nav.admins`
- `frontend/packages/web/src/pages/admin/AdminLayout.tsx` — add nav link
- `frontend/packages/web/src/App.tsx` — add route

**Docs — modify:**
- `CLAUDE.md` — rewrite rule #20

---

## Task 1: Domain model + error codes + AutoMigrate

**Files:**
- Modify: `backend/internal/domain/models.go`
- Modify: `backend/internal/domain/errors.go`
- Modify: `backend/pkg/database/postgres.go:114-134`

- [ ] **Step 1: Add the `AdminAuditLog` model**

Append to `backend/internal/domain/models.go` (after the `UserReview` struct):

```go
// AdminAuditLog records every admin-role change made through the app (not the CLI).
// Actor/target emails are snapshotted so the log stays readable even if a user is
// later deleted.
type AdminAuditLog struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ActorID     uuid.UUID `gorm:"type:uuid;not null;index" json:"actor_id"`
	TargetID    uuid.UUID `gorm:"type:uuid;not null;index" json:"target_id"`
	ActorEmail  string    `gorm:"size:255" json:"actor_email"`
	TargetEmail string    `gorm:"size:255" json:"target_email"`
	Action      string    `gorm:"size:20;not null" json:"action"` // "grant" | "revoke"
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}
```

- [ ] **Step 2: Add the two domain errors**

In `backend/internal/domain/errors.go`, add to the `User` group of the `var (...)` block (after `ErrCannotModerateAdmin`):

```go
	ErrCannotRevokeSelf     = errors.New("no puedes quitarte el admin a ti mismo")
	ErrCannotRevokeLastAdmin = errors.New("no se puede revocar al último administrador")
```

And in the `ErrorCodes` map, under `// User`:

```go
	ErrCannotRevokeSelf:      "cannot_revoke_self",
	ErrCannotRevokeLastAdmin: "cannot_revoke_last_admin",
```

- [ ] **Step 3: Register the model in AutoMigrate**

In `backend/pkg/database/postgres.go`, add to the `db.AutoMigrate(...)` list (after `&domain.Vet{},`):

```go
		&domain.AdminAuditLog{},
```

- [ ] **Step 4: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/models.go backend/internal/domain/errors.go backend/pkg/database/postgres.go
git commit -m "feat(admin): add AdminAuditLog model and role-change error codes"
```

---

## Task 2: AdminRepository (interface + impl) + integration tests

**Files:**
- Create: `backend/internal/repository/admin_repository.go`
- Modify: `backend/internal/repository/interfaces.go`
- Test: `backend/tests/admin_repository_test.go`

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/admin_repository_test.go`:

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

func TestAdminRepository_SetAdminWithAudit_FlipsFlagAndWritesAudit(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	adminRepo := repository.NewAdminRepository(db)

	actor := newTestUser(t, userRepo)
	target := newTestUser(t, userRepo)

	entry := &domain.AdminAuditLog{
		ActorID:     actor.ID,
		TargetID:    target.ID,
		ActorEmail:  actor.Email,
		TargetEmail: target.Email,
		Action:      "grant",
	}
	if err := adminRepo.SetAdminWithAudit(context.Background(), target.ID, true, entry); err != nil {
		t.Fatalf("SetAdminWithAudit: %v", err)
	}

	got, _ := userRepo.GetByID(context.Background(), target.ID)
	if !got.IsAdmin {
		t.Errorf("expected target IsAdmin=true after grant")
	}

	changes, err := adminRepo.ListRoleChanges(context.Background(), 10)
	if err != nil {
		t.Fatalf("ListRoleChanges: %v", err)
	}
	if len(changes) != 1 || changes[0].Action != "grant" || changes[0].TargetEmail != target.Email {
		t.Errorf("expected 1 grant audit row for target, got %+v", changes)
	}
}

func TestAdminRepository_CountAdmins(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	adminRepo := repository.NewAdminRepository(db)

	u := newTestUser(t, userRepo)
	if n, _ := adminRepo.CountAdmins(context.Background()); n != 0 {
		t.Fatalf("expected 0 admins initially, got %d", n)
	}

	u.IsAdmin = true
	if err := userRepo.Update(context.Background(), u); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if n, _ := adminRepo.CountAdmins(context.Background()); n != 1 {
		t.Errorf("expected 1 admin, got %d", n)
	}
	_ = uuid.Nil
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestAdminRepository -v`
Expected: compile failure — `undefined: repository.NewAdminRepository`.

- [ ] **Step 3: Add the interface**

Append to `backend/internal/repository/interfaces.go` (in the Style A section):

```go
// AdminRepository owns admin-role mutations that must be atomic with their audit
// trail, plus the admin count used for the last-admin guard. Style A.
type AdminRepository interface {
	// SetAdminWithAudit flips users.is_admin for targetID and inserts the audit
	// row in the same transaction. Either both happen or neither does.
	SetAdminWithAudit(ctx context.Context, targetID uuid.UUID, grant bool, entry *domain.AdminAuditLog) error
	// CountAdmins returns how many users currently have is_admin = true.
	CountAdmins(ctx context.Context) (int64, error)
	// ListRoleChanges returns the most recent audit rows, newest first.
	ListRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error)
}
```

- [ ] **Step 4: Write the implementation**

Create `backend/internal/repository/admin_repository.go`:

```go
package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresAdminRepository struct {
	db *gorm.DB
}

// NewAdminRepository crea el repositorio de operaciones de admin.
func NewAdminRepository(db *gorm.DB) AdminRepository {
	return &postgresAdminRepository{db: db}
}

func (r *postgresAdminRepository) SetAdminWithAudit(ctx context.Context, targetID uuid.UUID, grant bool, entry *domain.AdminAuditLog) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&domain.User{}).Where("id = ?", targetID).Update("is_admin", grant).Error; err != nil {
			return err
		}
		return tx.Create(entry).Error
	})
}

func (r *postgresAdminRepository) CountAdmins(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.User{}).Where("is_admin = ?", true).Count(&n).Error
	return n, err
}

func (r *postgresAdminRepository) ListRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var entries []domain.AdminAuditLog
	err := r.db.WithContext(ctx).Order("created_at DESC").Limit(limit).Find(&entries).Error
	return entries, err
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestAdminRepository -v`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/admin_repository.go backend/internal/repository/interfaces.go backend/tests/admin_repository_test.go
git commit -m "feat(admin): AdminRepository with atomic role-flip + audit, count, list"
```

---

## Task 3: AdminService with guards + unit tests

**Files:**
- Create: `backend/internal/service/admin_service.go`
- Test: `backend/internal/service/admin_service_test.go`

- [ ] **Step 1: Write the failing unit test**

Create `backend/internal/service/admin_service_test.go`:

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

// --- mocks ---

type mockUserRepoForAdmin struct {
	getByEmailFn func(ctx context.Context, email string) (*domain.User, error)
	getByIDFn    func(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

func (m *mockUserRepoForAdmin) Create(context.Context, *domain.User) error { return nil }
func (m *mockUserRepoForAdmin) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	return m.getByIDFn(ctx, id)
}
func (m *mockUserRepoForAdmin) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return m.getByEmailFn(ctx, email)
}
func (m *mockUserRepoForAdmin) Update(context.Context, *domain.User) error  { return nil }
func (m *mockUserRepoForAdmin) Delete(context.Context, uuid.UUID) error     { return nil }

var _ repository.UserRepository = (*mockUserRepoForAdmin)(nil)

type mockAdminRepo struct {
	count       int64
	setCalled   bool
	lastEntry   *domain.AdminAuditLog
	setErr      error
}

func (m *mockAdminRepo) SetAdminWithAudit(_ context.Context, _ uuid.UUID, _ bool, entry *domain.AdminAuditLog) error {
	m.setCalled = true
	m.lastEntry = entry
	return m.setErr
}
func (m *mockAdminRepo) CountAdmins(context.Context) (int64, error) { return m.count, nil }
func (m *mockAdminRepo) ListRoleChanges(context.Context, int) ([]domain.AdminAuditLog, error) {
	return nil, nil
}

var _ repository.AdminRepository = (*mockAdminRepo)(nil)

func adminUsers(target *domain.User, actor *domain.User) *mockUserRepoForAdmin {
	return &mockUserRepoForAdmin{
		getByEmailFn: func(context.Context, string) (*domain.User, error) { return target, nil },
		getByIDFn:    func(context.Context, uuid.UUID) (*domain.User, error) { return actor, nil },
	}
}

// --- tests ---

func TestAdminService_Grant_WritesAuditAndFlips(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test"}
	target := &domain.User{ID: uuid.New(), Email: "target@x.test", IsAdmin: false}
	adminRepo := &mockAdminRepo{count: 1}
	svc := NewAdminService(adminUsers(target, actor), adminRepo)

	res, err := svc.SetUserAdmin(context.Background(), actor.ID, "target@x.test", true)
	if err != nil {
		t.Fatalf("SetUserAdmin: %v", err)
	}
	if res.NoChange {
		t.Errorf("expected a change")
	}
	if !adminRepo.setCalled || adminRepo.lastEntry.Action != "grant" {
		t.Errorf("expected a grant audit write, got %+v", adminRepo.lastEntry)
	}
	if adminRepo.lastEntry.ActorEmail != actor.Email || adminRepo.lastEntry.TargetEmail != target.Email {
		t.Errorf("audit snapshot emails wrong: %+v", adminRepo.lastEntry)
	}
}

func TestAdminService_RevokeSelf_Rejected(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test", IsAdmin: true}
	adminRepo := &mockAdminRepo{count: 5}
	// target == actor
	users := &mockUserRepoForAdmin{
		getByEmailFn: func(context.Context, string) (*domain.User, error) { return actor, nil },
		getByIDFn:    func(context.Context, uuid.UUID) (*domain.User, error) { return actor, nil },
	}
	svc := NewAdminService(users, adminRepo)

	_, err := svc.SetUserAdmin(context.Background(), actor.ID, "actor@x.test", false)
	if !errors.Is(err, domain.ErrCannotRevokeSelf) {
		t.Errorf("want ErrCannotRevokeSelf, got %v", err)
	}
	if adminRepo.setCalled {
		t.Errorf("no write should happen on rejected self-revoke")
	}
}

func TestAdminService_RevokeLastAdmin_Rejected(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test", IsAdmin: true}
	target := &domain.User{ID: uuid.New(), Email: "target@x.test", IsAdmin: true}
	adminRepo := &mockAdminRepo{count: 1} // target is the last admin
	svc := NewAdminService(adminUsers(target, actor), adminRepo)

	_, err := svc.SetUserAdmin(context.Background(), actor.ID, "target@x.test", false)
	if !errors.Is(err, domain.ErrCannotRevokeLastAdmin) {
		t.Errorf("want ErrCannotRevokeLastAdmin, got %v", err)
	}
	if adminRepo.setCalled {
		t.Errorf("no write should happen on rejected last-admin revoke")
	}
}

func TestAdminService_NoOpWhenAlreadyInState(t *testing.T) {
	actor := &domain.User{ID: uuid.New(), Email: "actor@x.test"}
	target := &domain.User{ID: uuid.New(), Email: "target@x.test", IsAdmin: true}
	adminRepo := &mockAdminRepo{count: 2}
	svc := NewAdminService(adminUsers(target, actor), adminRepo)

	res, err := svc.SetUserAdmin(context.Background(), actor.ID, "target@x.test", true)
	if err != nil {
		t.Fatalf("SetUserAdmin: %v", err)
	}
	if !res.NoChange {
		t.Errorf("expected NoChange=true when already admin")
	}
	if adminRepo.setCalled {
		t.Errorf("no audit row on no-op")
	}
}

func TestAdminService_UnknownEmail_NotFound(t *testing.T) {
	users := &mockUserRepoForAdmin{
		getByEmailFn: func(context.Context, string) (*domain.User, error) { return nil, domain.ErrUserNotFound },
		getByIDFn:    func(context.Context, uuid.UUID) (*domain.User, error) { return nil, nil },
	}
	svc := NewAdminService(users, &mockAdminRepo{count: 2})

	_, err := svc.SetUserAdmin(context.Background(), uuid.New(), "nobody@x.test", true)
	if !errors.Is(err, domain.ErrUserNotFound) {
		t.Errorf("want ErrUserNotFound, got %v", err)
	}
}

func TestAdminService_EmptyEmail_InvalidInput(t *testing.T) {
	svc := NewAdminService(&mockUserRepoForAdmin{}, &mockAdminRepo{})
	_, err := svc.SetUserAdmin(context.Background(), uuid.New(), "   ", true)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestAdminService -v`
Expected: compile failure — `undefined: NewAdminService`.

- [ ] **Step 3: Write the implementation**

Create `backend/internal/service/admin_service.go`:

```go
package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// AdminRoleResult describes the outcome of a SetUserAdmin call.
type AdminRoleResult struct {
	TargetID    uuid.UUID
	TargetEmail string
	TargetName  string
	IsAdmin     bool
	// NoChange is true when the target was already in the requested state, so no
	// write (and no audit row) happened.
	NoChange bool
}

// AdminService owns in-app admin-role changes with their safety guards.
// Admin-only enforcement is done at the route level via RequireAdmin.
type AdminService interface {
	SetUserAdmin(ctx context.Context, actorID uuid.UUID, email string, grant bool) (AdminRoleResult, error)
	RecentRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error)
}

type adminService struct {
	userRepo  repository.UserRepository
	adminRepo repository.AdminRepository
}

// NewAdminService construye el AdminService.
func NewAdminService(userRepo repository.UserRepository, adminRepo repository.AdminRepository) AdminService {
	return &adminService{userRepo: userRepo, adminRepo: adminRepo}
}

func (s *adminService) SetUserAdmin(ctx context.Context, actorID uuid.UUID, email string, grant bool) (AdminRoleResult, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return AdminRoleResult{}, domain.ErrInvalidInput
	}

	target, err := s.userRepo.GetByEmail(ctx, email)
	if err != nil {
		return AdminRoleResult{}, err // ErrUserNotFound propagates
	}

	// Idempotent: already in the requested state → no write, no audit.
	if target.IsAdmin == grant {
		return AdminRoleResult{
			TargetID: target.ID, TargetEmail: target.Email, TargetName: target.Name,
			IsAdmin: target.IsAdmin, NoChange: true,
		}, nil
	}

	// Guards apply only to revokes.
	if !grant {
		if target.ID == actorID {
			return AdminRoleResult{}, domain.ErrCannotRevokeSelf
		}
		count, err := s.adminRepo.CountAdmins(ctx)
		if err != nil {
			return AdminRoleResult{}, err
		}
		if count <= 1 {
			return AdminRoleResult{}, domain.ErrCannotRevokeLastAdmin
		}
	}

	actor, err := s.userRepo.GetByID(ctx, actorID)
	if err != nil {
		return AdminRoleResult{}, err
	}

	action := "revoke"
	if grant {
		action = "grant"
	}
	entry := &domain.AdminAuditLog{
		ActorID:     actorID,
		TargetID:    target.ID,
		ActorEmail:  actor.Email,
		TargetEmail: target.Email,
		Action:      action,
	}
	if err := s.adminRepo.SetAdminWithAudit(ctx, target.ID, grant, entry); err != nil {
		return AdminRoleResult{}, err
	}

	return AdminRoleResult{
		TargetID: target.ID, TargetEmail: target.Email, TargetName: target.Name,
		IsAdmin: grant, NoChange: false,
	}, nil
}

func (s *adminService) RecentRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error) {
	return s.adminRepo.ListRoleChanges(ctx, limit)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/service/ -run TestAdminService -v`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/admin_service.go backend/internal/service/admin_service_test.go
git commit -m "feat(admin): AdminService with self-revoke + last-admin guards and audit"
```

---

## Task 4: DTOs + mappers

**Files:**
- Create: `backend/internal/dto/admin_dto.go`

- [ ] **Step 1: Write the DTOs and mappers**

Create `backend/internal/dto/admin_dto.go`:

```go
package dto

import (
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

// AdminRoleRequest is the body for granting/revoking admin by email.
// Grant is a pointer so an absent field fails `required` (a plain bool defaults
// to false, which would silently mean "revoke").
type AdminRoleRequest struct {
	Email string `json:"email" binding:"required,email"`
	Grant *bool  `json:"grant" binding:"required"`
}

// AdminRoleResponse reports the result of a role change.
type AdminRoleResponse struct {
	TargetID string `json:"target_id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	IsAdmin  bool   `json:"is_admin"`
	NoChange bool   `json:"no_change"`
}

// AdminAuditLogResponse is a single audit-trail entry for the UI.
type AdminAuditLogResponse struct {
	ActorEmail  string `json:"actor_email"`
	TargetEmail string `json:"target_email"`
	Action      string `json:"action"`
	CreatedAt   string `json:"created_at"`
}

// ToAdminRoleResponse maps a service result to its HTTP DTO.
func ToAdminRoleResponse(res service.AdminRoleResult) AdminRoleResponse {
	return AdminRoleResponse{
		TargetID: res.TargetID.String(),
		Email:    res.TargetEmail,
		Name:     res.TargetName,
		IsAdmin:  res.IsAdmin,
		NoChange: res.NoChange,
	}
}

// ToAdminAuditLogResponses maps audit rows to their HTTP DTOs.
func ToAdminAuditLogResponses(entries []domain.AdminAuditLog) []AdminAuditLogResponse {
	out := make([]AdminAuditLogResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, AdminAuditLogResponse{
			ActorEmail:  e.ActorEmail,
			TargetEmail: e.TargetEmail,
			Action:      e.Action,
			CreatedAt:   e.CreatedAt.Format(time.RFC3339),
		})
	}
	return out
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/dto/admin_dto.go
git commit -m "feat(admin): role-change request/response DTOs and mappers"
```

---

## Task 5: Handler + router wiring

**Files:**
- Create: `backend/internal/handler/admin_handler.go`
- Modify: `backend/internal/app/router.go` (DI ~line 119/198, routes ~line 379)

- [ ] **Step 1: Write the handler**

Create `backend/internal/handler/admin_handler.go`:

```go
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// AdminHandler handles in-app admin-role management (admin only — RequireAdmin).
type AdminHandler struct {
	adminService service.AdminService
}

// NewAdminHandler crea una instancia del AdminHandler.
func NewAdminHandler(adminService service.AdminService) *AdminHandler {
	return &AdminHandler{adminService: adminService}
}

// SetUserAdmin godoc
// POST /api/admin/users/admin-role  (admin only)
func (h *AdminHandler) SetUserAdmin(c *gin.Context) {
	var req dto.AdminRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	res, err := h.adminService.SetUserAdmin(c.Request.Context(), getUserUUID(c), req.Email, *req.Grant)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrCannotRevokeSelf),
			errors.Is(err, domain.ErrCannotRevokeLastAdmin),
			errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusOK, dto.ToAdminRoleResponse(res))
}

// RecentRoleChanges godoc
// GET /api/admin/role-changes  (admin only)
func (h *AdminHandler) RecentRoleChanges(c *gin.Context) {
	entries, err := h.adminService.RecentRoleChanges(c.Request.Context(), 50)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminAuditLogResponses(entries))
}
```

- [ ] **Step 2: Wire the repository + service**

In `backend/internal/app/router.go`, after the `moderationService := service.NewModerationService(userRepo)` line (~119):

```go
	adminRepo := repository.NewAdminRepository(db)
	adminService := service.NewAdminService(userRepo, adminRepo)
```

- [ ] **Step 3: Wire the handler**

After the `moderationHandler := handler.NewModerationHandler(moderationService)` line (~198):

```go
	adminHandler := handler.NewAdminHandler(adminService)
```

- [ ] **Step 4: Register the routes**

In the `admin := router.Group("/api")` block (after the `admin.PATCH("/admin/users/:id/unban", ...)` line ~380):

```go
		admin.POST("/admin/users/admin-role", adminHandler.SetUserAdmin)
		admin.GET("/admin/role-changes", adminHandler.RecentRoleChanges)
```

- [ ] **Step 5: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: no errors.

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && go test ./...`
Expected: PASS (all packages, including the new admin tests).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/handler/admin_handler.go backend/internal/app/router.go
git commit -m "feat(admin): admin-role endpoints wired into the RequireAdmin group"
```

---

## Task 6: Shared types + API client methods

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`
- Modify: `frontend/packages/shared/api/client.ts:838` (before the closing `}` of the class, after `createGroup`)

- [ ] **Step 1: Add the audit-entry type**

Append to `frontend/packages/shared/types/index.ts`:

```ts
export interface AdminAuditEntry {
  actor_email: string;
  target_email: string;
  action: 'grant' | 'revoke';
  created_at: string;
}

export interface AdminRoleResult {
  target_id: string;
  email: string;
  name: string;
  is_admin: boolean;
  no_change: boolean;
}
```

- [ ] **Step 2: Add the API client methods**

In `frontend/packages/shared/api/client.ts`, add inside the `APIClient` class, right after the `createGroup` method (before the class's closing `}` at line ~842). First ensure `AdminAuditEntry` and `AdminRoleResult` are imported at the top of the file (add them to the existing `import type { ... } from '../types'` / `'@shared/types'` list used in this file):

```ts
  async setUserAdmin(email: string, grant: boolean): Promise<AdminRoleResult> {
    return this.request<AdminRoleResult>('POST', '/api/admin/users/admin-role', { email, grant });
  }

  async getRoleChanges(): Promise<AdminAuditEntry[]> {
    return this.request<AdminAuditEntry[]>('GET', '/api/admin/role-changes');
  }
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend/packages/web && pnpm exec tsc --noEmit`
Expected: no errors. (If the shared types are checked via the web project's tsconfig, this catches them.)

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts
git commit -m "feat(admin): shared types + API client for admin-role management"
```

---

## Task 7: i18n — error keys + admin namespace keys

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/{es,en,pt}.json` (the `errors` object)
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` (the `admin` object)

- [ ] **Step 1: Add the two error keys (shared)**

In `frontend/packages/shared/i18n/locales/es.json`, inside the `"errors"` object, add:

```json
    "cannot_revoke_self": "No podés quitarte el admin a vos mismo",
    "cannot_revoke_last_admin": "No se puede revocar al último administrador",
```

In `en.json` `errors`:

```json
    "cannot_revoke_self": "You can't remove your own admin role",
    "cannot_revoke_last_admin": "You can't revoke the last administrator",
```

In `pt.json` `errors`:

```json
    "cannot_revoke_self": "Você não pode remover seu próprio admin",
    "cannot_revoke_last_admin": "Não é possível revogar o último administrador",
```

- [ ] **Step 2: Add the admin page keys + nav link (web)**

In `frontend/packages/web/src/i18n/locales/es.json`, inside the `"admin"` object, add a `nav.admins` key (alongside the existing nav keys) and an `admins` block:

```json
    "admins": {
      "navLabel": "Administradores",
      "title": "Administradores",
      "emailLabel": "Email del usuario",
      "emailPlaceholder": "usuario@ejemplo.com",
      "grant": "Otorgar admin",
      "revoke": "Revocar admin",
      "granted": "Se otorgó admin a {{email}}",
      "revoked": "Se revocó admin a {{email}}",
      "noChange": "{{email}} ya estaba en ese estado",
      "recentTitle": "Cambios recientes",
      "recentEmpty": "Sin cambios todavía",
      "colActor": "Quién",
      "colTarget": "Usuario",
      "colAction": "Acción",
      "colDate": "Fecha",
      "actionGrant": "Otorgó",
      "actionRevoke": "Revocó"
    }
```

And add the nav label key the `AdminLayout` will reference. In the same `admin` object, under the existing `nav` block, add:

```json
      "admins": "Administradores"
```

Mirror both additions in `en.json`:

```json
    "admins": {
      "navLabel": "Administrators",
      "title": "Administrators",
      "emailLabel": "User email",
      "emailPlaceholder": "user@example.com",
      "grant": "Grant admin",
      "revoke": "Revoke admin",
      "granted": "Granted admin to {{email}}",
      "revoked": "Revoked admin from {{email}}",
      "noChange": "{{email}} was already in that state",
      "recentTitle": "Recent changes",
      "recentEmpty": "No changes yet",
      "colActor": "By",
      "colTarget": "User",
      "colAction": "Action",
      "colDate": "Date",
      "actionGrant": "Granted",
      "actionRevoke": "Revoked"
    }
```
and `nav.admins`: `"admins": "Administrators"`.

And `pt.json`:

```json
    "admins": {
      "navLabel": "Administradores",
      "title": "Administradores",
      "emailLabel": "Email do usuário",
      "emailPlaceholder": "usuario@exemplo.com",
      "grant": "Conceder admin",
      "revoke": "Revogar admin",
      "granted": "Admin concedido a {{email}}",
      "revoked": "Admin revogado de {{email}}",
      "noChange": "{{email}} já estava nesse estado",
      "recentTitle": "Mudanças recentes",
      "recentEmpty": "Nenhuma mudança ainda",
      "colActor": "Por",
      "colTarget": "Usuário",
      "colAction": "Ação",
      "colDate": "Data",
      "actionGrant": "Concedeu",
      "actionRevoke": "Revogou"
    }
```
and `nav.admins`: `"admins": "Administradores"`.

> NOTE: `admin` is already registered in `web/src/i18n/index.ts` (PR #50), so no config change is needed (rule #21). Verify the JSON stays valid (commas).

- [ ] **Step 3: Verify JSON is valid**

Run: `cd frontend/packages/web && node -e "['es','en','pt'].forEach(l=>{require('./src/i18n/locales/'+l+'.json');require('../../shared/i18n/locales/'+l+'.json')});console.log('json ok')"`
Expected: `json ok`.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json
git commit -m "feat(admin): i18n for role-management page and new error codes"
```

---

## Task 8: AdminsPage component

**Files:**
- Create: `frontend/packages/web/src/pages/admin/AdminsPage.tsx`

- [ ] **Step 1: Write the page**

Create `frontend/packages/web/src/pages/admin/AdminsPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import { getErrorMessage } from '@shared/utils/apiErrors';
import type { AdminAuditEntry, AdminRoleResult } from '@shared/types';

export function AdminsPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: changes } = useQuery({
    queryKey: ['admin-role-changes'],
    queryFn: () => apiClient.getRoleChanges(),
  });

  const mutation = useMutation({
    mutationFn: ({ targetEmail, grant }: { targetEmail: string; grant: boolean }) =>
      apiClient.setUserAdmin(targetEmail, grant),
    onSuccess: (res: AdminRoleResult, vars) => {
      setError(null);
      if (res.no_change) {
        setNotice(t('admins.noChange', { email: res.email }));
      } else {
        setNotice(t(vars.grant ? 'admins.granted' : 'admins.revoked', { email: res.email }));
      }
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['admin-role-changes'] });
    },
    onError: (err: unknown) => {
      setNotice(null);
      setError(getErrorMessage(err, t));
    },
  });

  const submit = (grant: boolean) => {
    const trimmed = email.trim();
    if (!trimmed) return;
    mutation.mutate({ targetEmail: trimmed, grant });
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('admins.title')}</h2>

      <div className="max-w-md space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('admins.emailLabel')}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('admins.emailPlaceholder')}
          className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <div className="flex gap-2">
          <button
            onClick={() => submit(true)}
            disabled={mutation.isPending || !email.trim()}
            className="text-sm font-medium px-3 py-2 rounded bg-primary text-white hover:opacity-90 transition disabled:opacity-50"
          >
            {t('admins.grant')}
          </button>
          <button
            onClick={() => submit(false)}
            disabled={mutation.isPending || !email.trim()}
            className="text-sm font-medium px-3 py-2 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 transition disabled:opacity-50"
          >
            {t('admins.revoke')}
          </button>
        </div>
        {notice && <p className="text-sm text-green-600 dark:text-green-400">{notice}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-10 mb-4">
        {t('admins.recentTitle')}
      </h3>
      {changes && changes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colDate')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colActor')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colAction')}</th>
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">{t('admins.colTarget')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c: AdminAuditEntry, i: number) => (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400">
                    {new Date(c.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-gray-600 dark:text-gray-400">{c.actor_email}</td>
                  <td className="py-2 px-3 text-gray-900 dark:text-gray-100">
                    {t(c.action === 'grant' ? 'admins.actionGrant' : 'admins.actionRevoke')}
                  </td>
                  <td className="py-2 px-3 text-gray-900 dark:text-gray-100">{c.target_email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-400 dark:text-gray-500">{t('admins.recentEmpty')}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend/packages/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/web/src/pages/admin/AdminsPage.tsx
git commit -m "feat(admin): Administradores page (grant/revoke by email + recent changes)"
```

---

## Task 9: Nav link + route registration

**Files:**
- Modify: `frontend/packages/web/src/pages/admin/AdminLayout.tsx:4-8`
- Modify: `frontend/packages/web/src/App.tsx:8` (import) and `:77` (route)

- [ ] **Step 1: Add the nav link**

In `frontend/packages/web/src/pages/admin/AdminLayout.tsx`, extend the `navLinks` array:

```tsx
const navLinks = [
  { to: '/admin/abuse-reports', labelKey: 'nav.abuseReports' },
  { to: '/admin/stories', labelKey: 'nav.stories' },
  { to: '/admin/groups', labelKey: 'nav.groups' },
  { to: '/admin/admins', labelKey: 'nav.admins' },
];
```

- [ ] **Step 2: Import the page**

In `frontend/packages/web/src/App.tsx`, after the `GroupsAdminPage` import (line ~8):

```tsx
import { AdminsPage } from './pages/admin/AdminsPage';
```

- [ ] **Step 3: Register the route**

In `App.tsx`, inside the `<Route path="/admin" element={<AdminLayout />}>` block, after the `groups` route (line ~77):

```tsx
              <Route path="admins" element={<AdminsPage />} />
```

- [ ] **Step 4: Build the web app**

Run: `cd frontend/packages/web && pnpm build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/admin/AdminLayout.tsx frontend/packages/web/src/App.tsx
git commit -m "feat(admin): register Administradores nav link and route"
```

---

## Task 10: Manual verification (web + backend)

**Files:** none (verification only)

- [ ] **Step 1: Start the stack**

Run (separate terminals, from repo root): `make dev` (DB), `make backend`, `make web`.

- [ ] **Step 2: Log in as the seeded admin**

Log in with `admin@searchpet.local` / `admin1234` (local seed). Navigate to `/admin/admins`.

- [ ] **Step 3: Exercise the flows and confirm each result**

- Grant admin to a known non-admin email → green notice "Se otorgó admin…"; the user appears in "Cambios recientes".
- Repeat the same grant → notice "ya estaba en ese estado" (no new audit row).
- Try to revoke your own email → red error "No podés quitarte el admin a vos mismo".
- With only one admin total, try to revoke that admin → red error "último administrador".
- Enter a non-existent email → red error "Usuario no encontrado".

- [ ] **Step 4: Confirm the audit rows in the DB**

Run: `make db-shell` then `SELECT actor_email, target_email, action, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 5;`
Expected: one row per actual change (no rows for the no-op grant or rejected attempts).

---

## Task 11: Update CLAUDE.md rule #20

**Files:**
- Modify: `CLAUDE.md` (rule #20 in "Reglas Importantes")

- [ ] **Step 1: Rewrite rule #20**

Replace the current rule #20 text with:

```markdown
20. **Admin = flag `is_admin`. Promoción in-app SOLO con auth admin** — Ser admin es el bool `users.is_admin` (default `false`), chequeado por `middleware.RequireAdmin` (403 si no). Un admin puede otorgar/revocar admin a OTRO usuario por email desde el panel web (`POST /api/admin/users/admin-role`, página "Administradores"), con dos guardrails anti-lockout en el endpoint: no podés auto-revocarte (`cannot_revoke_self`) ni revocar al último admin (`cannot_revoke_last_admin`). Cada cambio se audita en la tabla `admin_audit_logs` (actor/target + snapshots de email + acción). **NO existe** endpoint de registro de admin ni de creación del PRIMER admin desde afuera (eso sí sería el agujero: una ruta sin auth). El bootstrap del primer admin y la recuperación si te lockeás siguen siendo el comando CLI auditado `cmd/promote-admin` (`make promote-admin EMAIL=...`, `ARGS=-revoke`), que corre `admintool.SetAdmin` **sin guardrails** a propósito (es la vía de recuperación). El seed (`cmd/seed`) crea `admin@searchpet.local`/`admin1234` SOLO en local. NUNCA tocar `is_admin` a mano en la DB.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update rule #20 for in-app admin role management"
```

---

## Self-Review

**Spec coverage:**
- Endpoint by email behind RequireAdmin → Tasks 1,4,5 ✓
- Web admin UI → Tasks 8,9 ✓
- Anti-lockout (self-revoke + last-admin) → Task 3 (guards) + Task 1 (errors) ✓
- Persistent audit table → Tasks 1,2 ✓
- CLI stays unguarded recovery path → unchanged (`admintool.SetAdmin` untouched), documented Task 11 ✓
- GET role-changes for UI → Tasks 2,5,8 ✓
- Web-only (no mobile) → no mobile tasks ✓
- Error i18n via getErrorMessage → Task 7 ✓
- Rule #20 rewrite → Task 11 ✓

**Type consistency:** `AdminRepository` (3 methods) consistent across interface (T2), impl (T2), mocks (T3), service (T3), router (T5). `AdminRoleResult` fields match between service (T3), DTO mapper (T4), and shared TS type (T6). `setUserAdmin(email, grant)` / `getRoleChanges()` consistent between client (T6) and page (T8). i18n keys used in T8 (`admins.*`) all defined in T7. `getUserUUID` (existing helper) used in handler (T5).

**Placeholder scan:** none — every code step has full content.
```
