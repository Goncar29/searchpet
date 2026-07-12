# Shelter Self-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user register their shelter in-app, route it through an admin approval queue before it appears in the public directory, and let the owner manage their listing afterwards (with re-approval for donation/website link changes).

**Architecture:** The existing `Shelter` model gains `owner_user_id` (partial unique index — one shelter per account), a `pending|approved|rejected` status, a rejection reason, and staged `Pending*` link columns. New owner endpoints (`POST /api/shelters`, `GET/PUT /api/shelters/mine`) and admin queue endpoints (`GET /api/admin/shelters/pending` + approve/reject + links approve/reject) follow Handler→Service→Repository. `shelter.submitted/approved/rejected` events flow through the EventBus; NotificationService pushes approval/rejection to the owner. Web gets a register page (how-it-works step 0 → form → confirmation), a my-shelter page (status stepper, resubmit, staged-link edit), a CTA swap on the shelters page, and a new admin "Shelters" queue page.

**Tech Stack:** Go 1.25 + Gin + GORM + golang-migrate (backend), React + Vite + React Query + Tailwind (web), shared types/client/hooks in `frontend/packages/shared`.

**Spec:** `docs/superpowers/specs/2026-07-12-shelter-self-registration-design.md`

**Branch:** `feat/shelter-self-registration` (already created; spec committed).

**Environment notes:**
- Backend integration tests use `testdb.SetupTestDB(t)` and SKIP silently without `DATABASE_URL`. Run them from `backend/` with: `DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -run <Name> -v`. A bare `ok` WITHOUT `DATABASE_URL` means the integration tests silently skipped — that does NOT count as a TDD red/green cycle. GOTCHA: pointing `DATABASE_URL` at the dev DB (`lostpets`, host port 5433) wipes the seed — re-seed afterwards if you do.
- Web unit tests: run from `frontend/packages/web/`: `pnpm vitest run <file>`. Full suite: `pnpm test:run` (chains web + shared vitest configs). NEVER `pnpm test` in mobile (watch mode) — mobile is out of scope anyway.
- The key facts below were verified against the code on 2026-07-12 (HEAD 8b2b64d). If a snippet does not match the file when you open it, STOP and re-verify before editing.

**Verified key facts (do not re-derive):**
- `domain.Shelter` (backend/internal/domain/models.go:370-383) has NO owner/status/pending fields and only `CreatedAt` — no `UpdatedAt`.
- Migration order differs by environment: **prod** runs SQL migrations BEFORE AutoMigrate (`Connect → RunMigrations → RunAutoMigrate`); **testdb** runs AutoMigrate FIRST, then SQL migrations. New migrations must be order-agnostic (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- Next free migration number is **000016** (000015 = search_episodes).
- `ShelterRepository` (interfaces.go:116-121) is Style A (`context.Context` + `uuid.UUID`): `Create`, `GetByID`, `GetAll(ctx, city, isVerified *bool)`, `Update`.
- `NewShelterService(repo)` currently takes ONE arg; wired in `backend/internal/app/router.go:115`. Services in this codebase DO import `internal/dto` (message, pet, verification services), so passing a DTO into the service is consistent.
- `User.EmailVerified bool` (models.go:49). `UserRepository.GetByID(ctx, uuid.UUID)`.
- Handler helpers: `getUserID(c) string`, `writeError(c, status, err)` → `{code,message}` via `domain.CodeFor`. `domain.ErrBindingFailed` → `binding_failed` exists for bind errors.
- `domain.ErrShelterNotFound` → `shelter_not_found` already exists (errors.go:42, map line 146) and already has `errors:` i18n keys in the 3 shared locales.
- Route groups in router.go: `public` (GET /shelters, GET /shelters/:id at lines 277-278), `protected` (JWT), `admin` (JWT + RequireAdmin; POST/PUT /admin/shelters at 403-404). Gin prioritizes static segments over params, so `GET /api/shelters/mine` (protected) coexists with `GET /api/shelters/:id` (public) — same pattern as `/messages/unread-count` vs `/messages/:userId`.
- EventBus: `bus.Publish(name, payload)`, async `Subscribe`. Payload structs live in `backend/internal/event/event_bus.go`. NotificationService (`internal/service/notification_service.go`) subscribes in `RegisterListeners` and its `onPetFound` is the pattern to mirror (FindByUserID tokens → goroutine fan-out → `isStaleTokenError` cleanup).
- NotificationService tests live in `backend/internal/service/notification_service_test.go` (package `service_test`) with `newMockDeviceTokenRepo()` and `newMockFCMClient(bufSize)` + `waitCalls(n, timeout)` helpers — same package, reusable.
- Backend test mocks in `backend/tests/` are all in one package: `mockUserRepository` already exists (review_service_test.go:92, `getByIDFn` override, default returns `&domain.User{ID: id, Name: "Test User"}` — NOTE: `EmailVerified` defaults to false). `newTestUser(t, userRepo)` helper exists (pet_repository_test.go:16).
- `testdb.SetupTestDB` truncation list already contains `"shelters"` — no testdb change needed (no new tables).
- `cmd/seed` does NOT create shelters; they are seeded by migrations 000006/000007, which run BEFORE 000016 — the backfill in 000016 grandfathers them to `approved` in every environment.
- Shared frontend: `Shelter` type (shared/types/index.ts:149-162), `apiClient.getShelters/getShelterByID` (client.ts:635-643, `this.request<T>(method, path, body?, params?)`), `useShelters`/`useShelterByID` hooks (hooks/index.ts:561-575). `useVerificationStatus`, `useGetMe` exist.
- i18n: `shelters` is a **WEB-ONLY** namespace (`frontend/packages/web/src/i18n/locales/{es,en,pt}.json`), ALREADY registered in `web/src/i18n/index.ts` (rule #21 satisfied — no registration change). `admin` namespace ditto. `errors` namespace lives in the SHARED locales (`frontend/packages/shared/i18n/locales/*.json`).
- Web admin: routes in `App.tsx` under `<AdminRoute>` → `<AdminLayout>` (navLinks array at `pages/admin/AdminLayout.tsx:4-9`); `AbuseReportsPage` is the pattern (inline `useQuery`/`useMutation` with `apiClient`, `useTranslation('admin')`).
- Web page tests mock `react-i18next` with `t: (key) => key` and `vi.mock('@shared/hooks', ...)`, wrapped in `QueryClientProvider` (see `SheltersPage.test.tsx`); pages using `Link`/`Navigate` also need `MemoryRouter`.
- Backend JSON gotcha for the frontend: `*string` with `omitempty` omits only `nil` — a staged CLEAR (`&""`) serializes as `"pending_donation_url": ""`. Frontend must check `!== undefined`, never truthiness.

**Spec ambiguities resolved during planning:**
- The spec says "shared `shelters` namespace"; in reality `shelters` is a web-only namespace already registered in `web/src/i18n/index.ts`. Since the feature is web-only, the new UI keys go in the existing web-only `shelters` namespace; only the new **error codes** go in the shared `errors` namespace (they are backend-code-driven and shared by contract).
- "Location optional" on the form: latitude/longitude stay API-supported (DTO passes them through) but the web form does not include a map picker — out of the spec's UI field list, YAGNI.

---

### Task 1: Domain model fields + status constants + new error codes

**Files:**
- Modify: `backend/internal/domain/models.go` (Shelter struct, lines 370-383)
- Modify: `backend/internal/domain/errors.go` (Shelter block: sentinel errors ~line 41 and `ErrorCodes` map ~line 145)
- Test: `backend/tests/shelter_errors_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/shelter_errors_test.go`:

```go
package tests

import (
	"testing"

	"lost-pets/internal/domain"
)

func TestShelterErrorCodes(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{domain.ErrShelterAlreadyOwned, "shelter_already_owned"},
		{domain.ErrEmailNotVerified, "email_not_verified"},
		{domain.ErrInvalidShelterStatus, "invalid_shelter_status"},
		{domain.ErrRejectionReasonRequired, "rejection_reason_required"},
		{domain.ErrShelterNotFound, "shelter_not_found"},
	}
	for _, tc := range cases {
		if got := domain.CodeFor(tc.err); got != tc.code {
			t.Errorf("CodeFor(%v) = %q, want %q", tc.err, got, tc.code)
		}
	}
}

func TestShelterStatusConstants(t *testing.T) {
	if domain.ShelterStatusPending != "pending" ||
		domain.ShelterStatusApproved != "approved" ||
		domain.ShelterStatusRejected != "rejected" {
		t.Errorf("unexpected shelter status constants: %q %q %q",
			domain.ShelterStatusPending, domain.ShelterStatusApproved, domain.ShelterStatusRejected)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run 'TestShelterErrorCodes|TestShelterStatusConstants' -v`
Expected: FAIL (compile error: `ErrShelterAlreadyOwned` undefined).

- [ ] **Step 3: Extend the Shelter struct and add status constants**

In `backend/internal/domain/models.go`, replace the `Shelter` struct with:

```go
// Estados del flujo de auto-registro de refugios.
// pending → en cola de aprobación admin; approved → visible en el directorio
// público; rejected → devuelto al dueño con motivo (editable + reenviable).
const (
	ShelterStatusPending  = "pending"
	ShelterStatusApproved = "approved"
	ShelterStatusRejected = "rejected"
)

type Shelter struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OwnerUserID *uuid.UUID `gorm:"type:uuid" json:"owner_user_id,omitempty"`
	Name        string     `gorm:"not null;size:255" json:"name"`
	City        string     `gorm:"not null;size:100;index" json:"city"`
	Latitude    *float64   `gorm:"type:decimal(10,8)" json:"latitude,omitempty"`
	Longitude   *float64   `gorm:"type:decimal(11,8)" json:"longitude,omitempty"`
	Phone       string     `gorm:"size:20" json:"phone,omitempty"`
	Email       string     `gorm:"size:255" json:"email,omitempty"`
	WebsiteURL  string     `gorm:"size:500" json:"website_url,omitempty"`
	DonationURL string     `gorm:"size:500" json:"donation_url,omitempty"`
	Description string     `gorm:"type:text" json:"description,omitempty"`
	IsVerified  bool       `gorm:"default:false;index" json:"is_verified"`
	// Status del flujo de aprobación. El índice único parcial sobre
	// owner_user_id y el backfill de filas viejas viven en la migración 000016
	// (AutoMigrate no puede crear índices únicos parciales).
	Status          string `gorm:"size:20;not null;default:'pending';index" json:"status"`
	RejectionReason string `gorm:"type:text" json:"rejection_reason,omitempty"`
	// Cambios de links staged (regla #22): nil = sin cambio pendiente,
	// &"" = borrado pendiente, &"https://..." = reemplazo pendiente.
	PendingDonationURL *string   `gorm:"size:500" json:"pending_donation_url,omitempty"`
	PendingWebsiteURL  *string   `gorm:"size:500" json:"pending_website_url,omitempty"`
	CreatedAt          time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt          time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}
```

- [ ] **Step 4: Add the error sentinels and codes**

In `backend/internal/domain/errors.go`, replace the `// Shelter` sentinel block with:

```go
	// Shelter
	ErrShelterNotFound         = errors.New("refugio no encontrado")
	ErrShelterAlreadyOwned     = errors.New("shelter_already_owned")
	ErrEmailNotVerified        = errors.New("email_not_verified")
	ErrInvalidShelterStatus    = errors.New("invalid_shelter_status")
	ErrRejectionReasonRequired = errors.New("rejection_reason_required")
```

and the `// Shelter` block inside `ErrorCodes` with:

```go
	// Shelter
	ErrShelterNotFound:         "shelter_not_found",
	ErrShelterAlreadyOwned:     "shelter_already_owned",
	ErrEmailNotVerified:        "email_not_verified",
	ErrInvalidShelterStatus:    "invalid_shelter_status",
	ErrRejectionReasonRequired: "rejection_reason_required",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go build ./... && go test ./tests/ -run 'TestShelterErrorCodes|TestShelterStatusConstants' -v`
Expected: PASS (these two are pure unit tests — they run without `DATABASE_URL`).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/domain/models.go backend/internal/domain/errors.go backend/tests/shelter_errors_test.go
git commit -m "feat(shelters): owner, status and staged-link fields with error codes"
```

---

### Task 2: SQL migration 000016 — partial unique owner index + grandfather backfill

**Files:**
- Create: `backend/migrations/000016_shelter_self_registration.up.sql`
- Create: `backend/migrations/000016_shelter_self_registration.down.sql`
- Test: `backend/tests/shelter_repository_test.go` (create — first shelter repo integration test file)

AutoMigrate cannot create partial unique indexes, and prod runs SQL migrations BEFORE AutoMigrate while testdb runs them AFTER — so the migration must both add the columns idempotently (for prod, where AutoMigrate has not run yet) and tolerate the columns already existing (for testdb).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/shelter_repository_test.go`:

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

// newShelterWithOwner builds an unsaved shelter owned by ownerID.
func newShelterWithOwner(ownerID *uuid.UUID, name, status string) *domain.Shelter {
	return &domain.Shelter{
		OwnerUserID: ownerID,
		Name:        name,
		City:        "Montevideo",
		Status:      status,
	}
}

func TestShelterMigration_OwnerPartialUniqueIndex(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)

	// First shelter for the owner persists fine.
	first := newShelterWithOwner(&owner.ID, "Refugio Uno", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, first); err != nil {
		t.Fatalf("first Create: %v", err)
	}

	// Second shelter for the SAME owner violates the partial unique index.
	second := newShelterWithOwner(&owner.ID, "Refugio Dos", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, second); err == nil {
		t.Fatal("want unique violation for second shelter with same owner, got nil")
	}

	// Multiple ownerless shelters (admin/seed-created) are allowed — the index is partial.
	if err := shelterRepo.Create(ctx, newShelterWithOwner(nil, "Sin Dueño A", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("ownerless A: %v", err)
	}
	if err := shelterRepo.Create(ctx, newShelterWithOwner(nil, "Sin Dueño B", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("ownerless B: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -run TestShelterMigration -v`
Expected: FAIL at "want unique violation for second shelter with same owner, got nil" (no unique index yet). If the output says SKIP, the DB is not reachable — fix that first; a skip is not a red.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/000016_shelter_self_registration.up.sql`:

```sql
-- Migration 000016: shelter self-registration (UP)
-- Order-agnostic on purpose: prod runs SQL migrations BEFORE AutoMigrate
-- (columns must be added here), testdb runs AutoMigrate FIRST (the ADD COLUMN
-- IF NOT EXISTS calls become no-ops). Idempotent either way.

ALTER TABLE shelters ADD COLUMN IF NOT EXISTS owner_user_id UUID;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS pending_donation_url VARCHAR(500);
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS pending_website_url VARCHAR(500);
ALTER TABLE shelters ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Grandfather: every pre-existing shelter was hand-vetted by an admin.
UPDATE shelters SET status = 'approved' WHERE owner_user_id IS NULL AND status = 'pending';
UPDATE shelters SET updated_at = created_at WHERE updated_at IS NULL;

-- Same name GORM would generate for the `index` tag, so AutoMigrate never duplicates it.
CREATE INDEX IF NOT EXISTS idx_shelters_status ON shelters(status);

-- One shelter per account. Partial: seed/admin shelters (owner NULL) are unlimited.
-- AutoMigrate cannot express partial unique indexes — this is why the migration exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shelters_owner_unique
	ON shelters(owner_user_id) WHERE owner_user_id IS NOT NULL;
```

Create `backend/migrations/000016_shelter_self_registration.down.sql`:

```sql
-- Migration 000016: shelter self-registration (DOWN)

DROP INDEX IF EXISTS idx_shelters_owner_unique;
DROP INDEX IF EXISTS idx_shelters_status;
ALTER TABLE shelters DROP COLUMN IF EXISTS updated_at;
ALTER TABLE shelters DROP COLUMN IF EXISTS pending_website_url;
ALTER TABLE shelters DROP COLUMN IF EXISTS pending_donation_url;
ALTER TABLE shelters DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE shelters DROP COLUMN IF EXISTS status;
ALTER TABLE shelters DROP COLUMN IF EXISTS owner_user_id;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -run TestShelterMigration -v`
Expected: PASS (testdb applies new migrations on setup).

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/000016_shelter_self_registration.up.sql backend/migrations/000016_shelter_self_registration.down.sql backend/tests/shelter_repository_test.go
git commit -m "feat(shelters): migration for owner unique index, status backfill and staged links"
```

---

### Task 3: Repository — approved-only public listing, `GetByOwner`, `GetPendingQueue`

**Files:**
- Modify: `backend/internal/repository/interfaces.go` (`ShelterRepository`, lines 116-121)
- Modify: `backend/internal/repository/shelter_repository.go` (`GetAll` + two new methods)
- Modify: `backend/tests/shelter_service_test.go` (extend `mockShelterRepository` — compile requirement)
- Test: `backend/tests/shelter_repository_test.go` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/shelter_repository_test.go`:

```go
func TestShelterRepository_GetAll_OnlyApproved(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)

	if err := shelterRepo.Create(ctx, newShelterWithOwner(&owner.ID, "Pendiente", domain.ShelterStatusPending)); err != nil {
		t.Fatalf("create pending: %v", err)
	}
	if err := shelterRepo.Create(ctx, newShelterWithOwner(nil, "Aprobado", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("create approved: %v", err)
	}
	rejected := newShelterWithOwner(nil, "Rechazado", domain.ShelterStatusRejected)
	if err := shelterRepo.Create(ctx, rejected); err != nil {
		t.Fatalf("create rejected: %v", err)
	}

	shelters, err := shelterRepo.GetAll(ctx, "", nil)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if len(shelters) != 1 {
		t.Fatalf("want only the approved shelter, got %d", len(shelters))
	}
	if shelters[0].Name != "Aprobado" {
		t.Errorf("want 'Aprobado', got %q", shelters[0].Name)
	}
}

func TestShelterRepository_GetByOwner(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	stranger := newTestUser(t, userRepo)

	created := newShelterWithOwner(&owner.ID, "Mi Refugio", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, created); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := shelterRepo.GetByOwner(ctx, owner.ID)
	if err != nil {
		t.Fatalf("GetByOwner: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("want shelter %s, got %s", created.ID, got.ID)
	}

	if _, err := shelterRepo.GetByOwner(ctx, stranger.ID); err != domain.ErrShelterNotFound {
		t.Errorf("want ErrShelterNotFound for user without shelter, got %v", err)
	}
}

func TestShelterRepository_GetPendingQueue(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	ownerA := newTestUser(t, userRepo)
	ownerB := newTestUser(t, userRepo)

	// In the queue: a pending registration...
	pending := newShelterWithOwner(&ownerA.ID, "Pendiente", domain.ShelterStatusPending)
	if err := shelterRepo.Create(ctx, pending); err != nil {
		t.Fatalf("create pending: %v", err)
	}
	// ...and an approved shelter with a staged link change.
	staged := newShelterWithOwner(&ownerB.ID, "Con Cambio", domain.ShelterStatusApproved)
	newURL := "https://nuevo.example.org/donar"
	staged.PendingDonationURL = &newURL
	if err := shelterRepo.Create(ctx, staged); err != nil {
		t.Fatalf("create staged: %v", err)
	}
	// NOT in the queue: a plain approved shelter and a rejected one.
	if err := shelterRepo.Create(ctx, newShelterWithOwner(nil, "Tranquilo", domain.ShelterStatusApproved)); err != nil {
		t.Fatalf("create approved: %v", err)
	}
	if err := shelterRepo.Create(ctx, newShelterWithOwner(nil, "Rechazado", domain.ShelterStatusRejected)); err != nil {
		t.Fatalf("create rejected: %v", err)
	}

	queue, err := shelterRepo.GetPendingQueue(ctx)
	if err != nil {
		t.Fatalf("GetPendingQueue: %v", err)
	}
	if len(queue) != 2 {
		t.Fatalf("want 2 shelters in queue, got %d", len(queue))
	}
	names := map[string]bool{queue[0].Name: true, queue[1].Name: true}
	if !names["Pendiente"] || !names["Con Cambio"] {
		t.Errorf("want {Pendiente, Con Cambio} in queue, got %v", names)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -run TestShelterRepository -v`
Expected: FAIL (compile error: `GetByOwner` undefined).

- [ ] **Step 3: Extend the interface**

In `backend/internal/repository/interfaces.go`, replace the `ShelterRepository` interface with:

```go
// ShelterRepository define el contrato para acceder a datos de refugios.
type ShelterRepository interface {
	Create(ctx context.Context, shelter *domain.Shelter) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Shelter, error)
	// GetAll retorna SOLO refugios approved — es el listado del directorio público.
	GetAll(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error)
	// GetByOwner retorna el refugio del usuario. ErrShelterNotFound si no tiene.
	GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error)
	// GetPendingQueue retorna la cola de revisión admin: registros pending +
	// approved con cambios de links staged. Más viejos primero (FIFO).
	GetPendingQueue(ctx context.Context) ([]domain.Shelter, error)
	Update(ctx context.Context, shelter *domain.Shelter) error
}
```

- [ ] **Step 4: Implement in the repository**

In `backend/internal/repository/shelter_repository.go`, add the approved filter inside `GetAll` (first line of the query build):

```go
	query := r.db.WithContext(ctx).Model(&domain.Shelter{}).
		Where("status = ?", domain.ShelterStatusApproved)
```

(the `city` / `isVerified` filters and `Order("name ASC")` stay identical), and append after `Update`:

```go
// GetByOwner busca el refugio cuyo owner_user_id es ownerID.
// Retorna ErrShelterNotFound si el usuario no tiene refugio.
func (r *postgresShelterRepository) GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error) {
	var shelter domain.Shelter
	result := r.db.WithContext(ctx).First(&shelter, "owner_user_id = ?", ownerID)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return nil, domain.ErrShelterNotFound
	}
	if result.Error != nil {
		return nil, result.Error
	}
	return &shelter, nil
}

// GetPendingQueue retorna los refugios que requieren revisión admin:
// registros nuevos (pending) y approved con Pending* staged. FIFO por created_at.
func (r *postgresShelterRepository) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	var shelters []domain.Shelter
	err := r.db.WithContext(ctx).
		Where("status = ? OR (status = ? AND (pending_donation_url IS NOT NULL OR pending_website_url IS NOT NULL))",
			domain.ShelterStatusPending, domain.ShelterStatusApproved).
		Order("created_at ASC").
		Find(&shelters).Error
	return shelters, err
}
```

- [ ] **Step 5: Extend the service-test mock (compile requirement)**

In `backend/tests/shelter_service_test.go`, add to the `mockShelterRepository` struct (after `updateFn`):

```go
	getByOwnerFn      func(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error)
	getPendingQueueFn func(ctx context.Context) ([]domain.Shelter, error)
```

and the methods (after `Update`):

```go
func (m *mockShelterRepository) GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error) {
	if m.getByOwnerFn != nil {
		return m.getByOwnerFn(ctx, ownerID)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterRepository) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	if m.getPendingQueueFn != nil {
		return m.getPendingQueueFn(ctx)
	}
	return []domain.Shelter{}, nil
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && go build ./... && DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -run 'TestShelterRepository|TestShelterService' -v`
Expected: PASS (new repo tests + pre-existing service tests).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/shelter_repository.go backend/tests/shelter_repository_test.go backend/tests/shelter_service_test.go
git commit -m "feat(shelters): approved-only listing, owner lookup and admin queue queries"
```

---

### Task 4: DTOs — register/update/reject requests, owner/admin responses, https validation

**Files:**
- Modify: `backend/internal/dto/shelter_dto.go`
- Test: `backend/tests/shelter_dto_test.go` (create)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/shelter_dto_test.go`:

```go
package tests

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

func TestRegisterShelterRequest_Validate(t *testing.T) {
	base := dto.RegisterShelterRequest{Name: "Refugio", City: "Montevideo"}

	valid := base
	valid.WebsiteURL = "https://refugio.org"
	valid.DonationURL = "https://refugio.org/donar"
	if err := valid.Validate(); err != nil {
		t.Errorf("valid https URLs: want nil, got %v", err)
	}

	empty := base // empty URLs are valid (optional fields)
	if err := empty.Validate(); err != nil {
		t.Errorf("empty URLs: want nil, got %v", err)
	}

	httpURL := base
	httpURL.WebsiteURL = "http://refugio.org"
	if err := httpURL.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("http URL: want ErrInvalidInput, got %v", err)
	}

	garbage := base
	garbage.DonationURL = "no-es-una-url"
	if err := garbage.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("garbage URL: want ErrInvalidInput, got %v", err)
	}
}

func TestUpdateMyShelterRequest_Validate(t *testing.T) {
	https := "https://refugio.org/donar"
	http := "http://refugio.org/donar"
	emptyStr := ""

	ok := dto.UpdateMyShelterRequest{DonationURL: &https, WebsiteURL: &emptyStr}
	if err := ok.Validate(); err != nil {
		t.Errorf("https + explicit clear: want nil, got %v", err)
	}

	bad := dto.UpdateMyShelterRequest{WebsiteURL: &http}
	if err := bad.Validate(); err != domain.ErrInvalidInput {
		t.Errorf("http URL: want ErrInvalidInput, got %v", err)
	}
}

func TestToMyShelterResponse_IncludesReviewState(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://nuevo.org/donar"
	shelter := &domain.Shelter{
		ID:                 uuid.New(),
		OwnerUserID:        &ownerID,
		Name:               "Mi Refugio",
		City:               "Montevideo",
		Status:             domain.ShelterStatusRejected,
		RejectionReason:    "link de donación roto",
		PendingDonationURL: &pendingURL,
	}

	resp := dto.ToMyShelterResponse(shelter)
	if resp.Status != domain.ShelterStatusRejected {
		t.Errorf("Status: want rejected, got %q", resp.Status)
	}
	if resp.RejectionReason != "link de donación roto" {
		t.Errorf("RejectionReason: want the admin reason, got %q", resp.RejectionReason)
	}
	if resp.PendingDonationURL == nil || *resp.PendingDonationURL != pendingURL {
		t.Errorf("PendingDonationURL: want %q, got %v", pendingURL, resp.PendingDonationURL)
	}
}

func TestToShelterResponse_NeverLeaksReviewFields(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://nuevo.org/donar"
	shelter := &domain.Shelter{
		ID:                 uuid.New(),
		OwnerUserID:        &ownerID,
		Name:               "Refugio Público",
		City:               "Montevideo",
		Status:             domain.ShelterStatusApproved,
		RejectionReason:    "dato interno",
		PendingDonationURL: &pendingURL,
	}

	raw, err := json.Marshal(dto.ToShelterResponse(shelter))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(raw)
	for _, leaked := range []string{"owner_user_id", "rejection_reason", "pending_donation_url", "pending_website_url", "status"} {
		if strings.Contains(body, leaked) {
			t.Errorf("public ShelterResponse leaks %q: %s", leaked, body)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run 'TestRegisterShelterRequest|TestUpdateMyShelterRequest|TestToMyShelterResponse|TestToShelterResponse' -v`
Expected: FAIL (compile error: `RegisterShelterRequest` undefined).

- [ ] **Step 3: Implement the DTOs**

In `backend/internal/dto/shelter_dto.go`, add `"net/url"` to the imports and append at the end of the file:

```go
// ============================================================
// SELF-REGISTRATION (owner) — V2.1
// ============================================================

// validOptionalHTTPSURL acepta "" (campo opcional/limpiado) o una URL https:// bien formada.
func validOptionalHTTPSURL(s string) bool {
	if s == "" {
		return true
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}

// RegisterShelterRequest son los campos del auto-registro (POST /api/shelters).
type RegisterShelterRequest struct {
	Name        string   `json:"name" binding:"required"`
	City        string   `json:"city" binding:"required"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	WebsiteURL  string   `json:"website_url"`
	DonationURL string   `json:"donation_url"`
	Description string   `json:"description"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
}

// Validate exige https:// en los links (la validación inline del form es la
// primera línea; esto es el contrato del backend — spec: invalid_input).
func (r *RegisterShelterRequest) Validate() error {
	if !validOptionalHTTPSURL(r.WebsiteURL) || !validOptionalHTTPSURL(r.DonationURL) {
		return domain.ErrInvalidInput
	}
	return nil
}

// ToRegisterShelterDomain convierte el request en un domain.Shelter sin owner ni
// status — el service setea ambos (RegisterOwn es quien conoce la regla).
func ToRegisterShelterDomain(req *RegisterShelterRequest) *domain.Shelter {
	return &domain.Shelter{
		Name:        req.Name,
		City:        req.City,
		Phone:       req.Phone,
		Email:       req.Email,
		WebsiteURL:  req.WebsiteURL,
		DonationURL: req.DonationURL,
		Description: req.Description,
		Latitude:    req.Latitude,
		Longitude:   req.Longitude,
	}
}

// UpdateMyShelterRequest — PUT /api/shelters/mine. Punteros (regla #22):
// nil = no tocar, &"" = vaciar. El service decide si un cambio de link
// aplica directo (pending/rejected) o queda staged (approved).
type UpdateMyShelterRequest struct {
	Name        *string  `json:"name"`
	City        *string  `json:"city"`
	Phone       *string  `json:"phone"`
	Email       *string  `json:"email"`
	Description *string  `json:"description"`
	WebsiteURL  *string  `json:"website_url"`
	DonationURL *string  `json:"donation_url"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
}

// Validate exige https:// en los links presentes ("" explícito = limpiar, válido).
func (r *UpdateMyShelterRequest) Validate() error {
	if r.WebsiteURL != nil && !validOptionalHTTPSURL(*r.WebsiteURL) {
		return domain.ErrInvalidInput
	}
	if r.DonationURL != nil && !validOptionalHTTPSURL(*r.DonationURL) {
		return domain.ErrInvalidInput
	}
	return nil
}

// RejectShelterRequest — POST /api/admin/shelters/:id/reject.
type RejectShelterRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// MyShelterResponse es la vista del DUEÑO: campos públicos + estado de revisión.
// NUNCA usar para el directorio público (regla #7 — ToShelterResponse es el público).
type MyShelterResponse struct {
	ShelterResponse
	Status             string  `json:"status"`
	RejectionReason    string  `json:"rejection_reason,omitempty"`
	PendingDonationURL *string `json:"pending_donation_url,omitempty"`
	PendingWebsiteURL  *string `json:"pending_website_url,omitempty"`
}

// ToMyShelterResponse arma la vista del dueño.
func ToMyShelterResponse(shelter *domain.Shelter) MyShelterResponse {
	return MyShelterResponse{
		ShelterResponse:    ToShelterResponse(shelter),
		Status:             shelter.Status,
		RejectionReason:    shelter.RejectionReason,
		PendingDonationURL: shelter.PendingDonationURL,
		PendingWebsiteURL:  shelter.PendingWebsiteURL,
	}
}

// AdminShelterResponse es la vista ADMIN: vista del dueño + owner_user_id.
type AdminShelterResponse struct {
	MyShelterResponse
	OwnerUserID *uuid.UUID `json:"owner_user_id,omitempty"`
}

// ToAdminShelterResponse arma la vista admin de un refugio.
func ToAdminShelterResponse(shelter *domain.Shelter) AdminShelterResponse {
	return AdminShelterResponse{
		MyShelterResponse: ToMyShelterResponse(shelter),
		OwnerUserID:       shelter.OwnerUserID,
	}
}

// ToAdminShelterListResponse siempre retorna slice inicializado (JSON [] y no null).
func ToAdminShelterListResponse(shelters []domain.Shelter) []AdminShelterResponse {
	result := make([]AdminShelterResponse, len(shelters))
	for i, s := range shelters {
		result[i] = ToAdminShelterResponse(&s)
	}
	return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./tests/ -run 'TestRegisterShelterRequest|TestUpdateMyShelterRequest|TestToMyShelterResponse|TestToShelterResponse' -v`
Expected: PASS (pure unit tests, no DB needed).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dto/shelter_dto.go backend/tests/shelter_dto_test.go
git commit -m "feat(shelters): self-registration DTOs with https validation and owner/admin views"
```

---

### Task 5: Service — `RegisterOwn` + `GetMine`, admin `Create` born approved, event payloads

**Files:**
- Modify: `backend/internal/event/event_bus.go` (append the three payload structs)
- Modify: `backend/internal/service/shelter_service.go` (interface + struct + constructor + methods)
- Modify: `backend/internal/app/router.go` (constructor call, line 115 — move it below `bus` which is already declared at line 73)
- Modify: `backend/tests/shelter_handler_test.go` (extend `mockShelterService` — compile requirement)
- Modify: `backend/tests/shelter_service_test.go` (helper signature + new tests)

- [ ] **Step 1: Write the failing tests**

In `backend/tests/shelter_service_test.go`, replace the `newTestShelterService` helper with:

```go
func newTestShelterService(repo *mockShelterRepository) service.ShelterService {
	return newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())
}

func newTestShelterServiceFull(repo *mockShelterRepository, userRepo *mockUserRepository, bus *event.EventBus) service.ShelterService {
	return service.NewShelterService(repo, userRepo, bus)
}
```

add `"lost-pets/internal/event"` to that file's imports, and append the new tests:

```go
// ============================================================
// RegisterOwn tests
// ============================================================

func verifiedUser(id uuid.UUID) *domain.User {
	return &domain.User{ID: id, Name: "Verified User", EmailVerified: true}
}

func TestShelterService_RegisterOwn_HappyPath(t *testing.T) {
	ownerID := uuid.New()
	var created *domain.Shelter
	repo := &mockShelterRepository{
		createFn: func(_ context.Context, shelter *domain.Shelter) error {
			shelter.ID = uuid.New()
			created = shelter
			return nil
		},
	}
	userRepo := &mockUserRepository{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return verifiedUser(id), nil
		},
	}
	svc := newTestShelterServiceFull(repo, userRepo, event.NewEventBus())

	shelter := &domain.Shelter{Name: "Mi Refugio", City: "Montevideo"}
	if err := svc.RegisterOwn(context.Background(), ownerID.String(), shelter); err != nil {
		t.Fatalf("RegisterOwn: %v", err)
	}
	if created == nil {
		t.Fatal("want repo.Create called")
	}
	if created.Status != domain.ShelterStatusPending {
		t.Errorf("Status: want pending, got %q", created.Status)
	}
	if created.OwnerUserID == nil || *created.OwnerUserID != ownerID {
		t.Errorf("OwnerUserID: want %s, got %v", ownerID, created.OwnerUserID)
	}
}

func TestShelterService_RegisterOwn_PublishesSubmittedEvent(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockShelterRepository{}
	userRepo := &mockUserRepository{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
			return verifiedUser(id), nil
		},
	}
	bus := event.NewEventBus()
	received := make(chan event.ShelterSubmittedEvent, 1)
	bus.Subscribe("shelter.submitted", func(payload interface{}) {
		if ev, ok := payload.(event.ShelterSubmittedEvent); ok {
			received <- ev
		}
	})
	svc := newTestShelterServiceFull(repo, userRepo, bus)

	if err := svc.RegisterOwn(context.Background(), ownerID.String(), &domain.Shelter{Name: "Refugio", City: "Montevideo"}); err != nil {
		t.Fatalf("RegisterOwn: %v", err)
	}
	select {
	case ev := <-received:
		if ev.OwnerUserID != ownerID {
			t.Errorf("event OwnerUserID: want %s, got %s", ownerID, ev.OwnerUserID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout: shelter.submitted not published")
	}
}

func TestShelterService_RegisterOwn_Guards(t *testing.T) {
	ownerID := uuid.New()

	t.Run("unverified email → ErrEmailNotVerified", func(t *testing.T) {
		userRepo := &mockUserRepository{
			getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
				return &domain.User{ID: id, EmailVerified: false}, nil
			},
		}
		svc := newTestShelterServiceFull(&mockShelterRepository{}, userRepo, event.NewEventBus())
		err := svc.RegisterOwn(context.Background(), ownerID.String(), &domain.Shelter{Name: "R", City: "M"})
		if !errors.Is(err, domain.ErrEmailNotVerified) {
			t.Errorf("want ErrEmailNotVerified, got %v", err)
		}
	})

	t.Run("already owns a shelter → ErrShelterAlreadyOwned", func(t *testing.T) {
		repo := &mockShelterRepository{
			getByOwnerFn: func(_ context.Context, _ uuid.UUID) (*domain.Shelter, error) {
				return &domain.Shelter{ID: uuid.New()}, nil
			},
		}
		userRepo := &mockUserRepository{
			getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
				return verifiedUser(id), nil
			},
		}
		svc := newTestShelterServiceFull(repo, userRepo, event.NewEventBus())
		err := svc.RegisterOwn(context.Background(), ownerID.String(), &domain.Shelter{Name: "R", City: "M"})
		if !errors.Is(err, domain.ErrShelterAlreadyOwned) {
			t.Errorf("want ErrShelterAlreadyOwned, got %v", err)
		}
	})

	t.Run("invalid userID → ErrInvalidInput", func(t *testing.T) {
		svc := newTestShelterService(&mockShelterRepository{})
		err := svc.RegisterOwn(context.Background(), "not-a-uuid", &domain.Shelter{Name: "R", City: "M"})
		if !errors.Is(err, domain.ErrInvalidInput) {
			t.Errorf("want ErrInvalidInput, got %v", err)
		}
	})
}

// ============================================================
// GetMine tests
// ============================================================

func TestShelterService_GetMine(t *testing.T) {
	ownerID := uuid.New()
	mine := makeShelter(uuid.New(), "Mi Refugio", "Montevideo")
	mine.OwnerUserID = &ownerID

	repo := &mockShelterRepository{
		getByOwnerFn: func(_ context.Context, id uuid.UUID) (*domain.Shelter, error) {
			if id == ownerID {
				return &mine, nil
			}
			return nil, domain.ErrShelterNotFound
		},
	}
	svc := newTestShelterService(repo)

	got, err := svc.GetMine(context.Background(), ownerID.String())
	if err != nil {
		t.Fatalf("GetMine: %v", err)
	}
	if got.ID != mine.ID {
		t.Errorf("want shelter %s, got %s", mine.ID, got.ID)
	}

	if _, err := svc.GetMine(context.Background(), uuid.New().String()); !errors.Is(err, domain.ErrShelterNotFound) {
		t.Errorf("want ErrShelterNotFound, got %v", err)
	}
	if _, err := svc.GetMine(context.Background(), "nope"); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

// ============================================================
// Admin Create born approved
// ============================================================

func TestShelterService_Create_AdminShelterBornApproved(t *testing.T) {
	var created *domain.Shelter
	repo := &mockShelterRepository{
		createFn: func(_ context.Context, shelter *domain.Shelter) error {
			shelter.ID = uuid.New()
			created = shelter
			return nil
		},
	}
	svc := newTestShelterService(repo)

	if err := svc.Create(context.Background(), &domain.Shelter{Name: "Admin Refugio", City: "Montevideo"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.Status != domain.ShelterStatusApproved {
		t.Errorf("admin-created shelter: want approved, got %q", created.Status)
	}
	if created.OwnerUserID != nil {
		t.Errorf("admin-created shelter: want no owner, got %v", created.OwnerUserID)
	}
}
```

Also add `"time"` to the file's imports (used by the event test).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run TestShelterService -v`
Expected: FAIL (compile error: `NewShelterService` arg count / `RegisterOwn` undefined).

- [ ] **Step 3: Add the event payload structs**

Append to `backend/internal/event/event_bus.go`:

```go
// ShelterSubmittedEvent is published when a user submits a shelter registration
// (first submit AND resubmit after rejection). No listener yet — reserved for
// future admin alerting/analytics.
type ShelterSubmittedEvent struct {
	ShelterID   uuid.UUID
	OwnerUserID uuid.UUID
	ShelterName string
}

// ShelterApprovedEvent is published when an admin approves a pending shelter.
// NotificationService pushes to the owner (same pattern as pet.found).
type ShelterApprovedEvent struct {
	ShelterID   uuid.UUID
	OwnerUserID uuid.UUID
	ShelterName string
}

// ShelterRejectedEvent is published when an admin rejects a pending shelter.
type ShelterRejectedEvent struct {
	ShelterID   uuid.UUID
	OwnerUserID uuid.UUID
	ShelterName string
	Reason      string
}
```

- [ ] **Step 4: Implement in the service**

Replace `backend/internal/service/shelter_service.go` contents from the interface down to `Update` (keep the package clause) with:

```go
import (
	"context"
	"errors"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
)

// ShelterService define el CONTRATO de la capa de negocio para refugios.
type ShelterService interface {
	GetAll(ctx context.Context, city string) ([]domain.Shelter, error)
	GetByID(ctx context.Context, id string) (*domain.Shelter, error)
	// Create es la vía ADMIN: refugio sin dueño, nace approved.
	Create(ctx context.Context, shelter *domain.Shelter) error
	Update(ctx context.Context, shelter *domain.Shelter) error
	// RegisterOwn es el auto-registro: exige email verificado y máximo un
	// refugio por cuenta; el refugio nace pending y publica shelter.submitted.
	RegisterOwn(ctx context.Context, userID string, shelter *domain.Shelter) error
	// GetMine retorna el refugio del usuario. ErrShelterNotFound si no tiene.
	GetMine(ctx context.Context, userID string) (*domain.Shelter, error)
	// UpdateMine aplica la edición del dueño según el estado (staging de links
	// en approved; edición libre + resubmit en pending/rejected).
	UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error)
	// GetPendingQueue retorna la cola de revisión admin.
	GetPendingQueue(ctx context.Context) ([]domain.Shelter, error)
	// Approve pasa pending → approved y publica shelter.approved.
	Approve(ctx context.Context, id string) (*domain.Shelter, error)
	// Reject pasa pending → rejected con motivo y publica shelter.rejected.
	Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error)
	// ApproveLinks copia Pending* a los campos vivos y los limpia.
	ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error)
	// RejectLinks descarta Pending* sin tocar los campos vivos.
	RejectLinks(ctx context.Context, id string) (*domain.Shelter, error)
}

// shelterService es la implementación concreta del ShelterService.
type shelterService struct {
	repo     repository.ShelterRepository
	userRepo repository.UserRepository
	bus      *event.EventBus
}

// NewShelterService construye el ShelterService con sus dependencias.
// bus puede ser nil (los eventos simplemente no se publican).
func NewShelterService(repo repository.ShelterRepository, userRepo repository.UserRepository, bus *event.EventBus) ShelterService {
	return &shelterService{repo: repo, userRepo: userRepo, bus: bus}
}

// GetAll retorna refugios del directorio público (el repo filtra approved).
// city == "" → sin filtro por ciudad.
func (s *shelterService) GetAll(ctx context.Context, city string) ([]domain.Shelter, error) {
	return s.repo.GetAll(ctx, city, nil)
}

// GetByID busca un refugio por su ID string.
func (s *shelterService) GetByID(ctx context.Context, id string) (*domain.Shelter, error) {
	shelterUUID, err := uuid.Parse(id)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByID(ctx, shelterUUID)
}

// Create persiste un refugio creado por un admin: sin dueño y nace approved
// (los admins ya vetaron los datos — no pasan por la cola).
func (s *shelterService) Create(ctx context.Context, shelter *domain.Shelter) error {
	shelter.Status = domain.ShelterStatusApproved
	return s.repo.Create(ctx, shelter)
}

// Update aplica los cambios de un refugio existente (vía admin).
func (s *shelterService) Update(ctx context.Context, shelter *domain.Shelter) error {
	return s.repo.Update(ctx, shelter)
}

// RegisterOwn registra el refugio del usuario autenticado.
func (s *shelterService) RegisterOwn(ctx context.Context, userID string, shelter *domain.Shelter) error {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return domain.ErrInvalidInput
	}

	user, err := s.userRepo.GetByID(ctx, ownerUUID)
	if err != nil {
		return err
	}
	if !user.EmailVerified {
		return domain.ErrEmailNotVerified
	}

	// Pre-check amable (409 con code claro); el índice único parcial de la
	// migración 000016 es la garantía real contra la carrera.
	if _, err := s.repo.GetByOwner(ctx, ownerUUID); err == nil {
		return domain.ErrShelterAlreadyOwned
	} else if !errors.Is(err, domain.ErrShelterNotFound) {
		return err
	}

	shelter.OwnerUserID = &ownerUUID
	shelter.Status = domain.ShelterStatusPending
	if err := s.repo.Create(ctx, shelter); err != nil {
		return err
	}

	if s.bus != nil {
		s.bus.Publish("shelter.submitted", event.ShelterSubmittedEvent{
			ShelterID:   shelter.ID,
			OwnerUserID: ownerUUID,
			ShelterName: shelter.Name,
		})
	}
	return nil
}

// GetMine retorna el refugio del usuario autenticado.
func (s *shelterService) GetMine(ctx context.Context, userID string) (*domain.Shelter, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	return s.repo.GetByOwner(ctx, ownerUUID)
}
```

(`GetPendingQueue` delegates to the repository and is final here. `UpdateMine`, `Approve`, `Reject`, `ApproveLinks`, `RejectLinks` get their real logic in Tasks 6 and 7 — to keep this task compiling, add these compile stubs NOW; Tasks 6/7 replace them with the full implementations and tests:)

```go
// UpdateMine — lógica real en la siguiente iteración del plan (Task 6).
func (s *shelterService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// GetPendingQueue delega al repositorio.
func (s *shelterService) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	return s.repo.GetPendingQueue(ctx)
}

// Approve — lógica real en Task 7.
func (s *shelterService) Approve(ctx context.Context, id string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// Reject — lógica real en Task 7.
func (s *shelterService) Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// ApproveLinks — lógica real en Task 7.
func (s *shelterService) ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}

// RejectLinks — lógica real en Task 7.
func (s *shelterService) RejectLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	return nil, domain.ErrInternal
}
```

- [ ] **Step 5: Extend the handler-test mock (compile requirement)**

In `backend/tests/shelter_handler_test.go`, add to the `mockShelterService` struct:

```go
	registerOwnFn     func(ctx context.Context, userID string, shelter *domain.Shelter) error
	getMineFn         func(ctx context.Context, userID string) (*domain.Shelter, error)
	updateMineFn      func(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error)
	getPendingQueueFn func(ctx context.Context) ([]domain.Shelter, error)
	approveFn         func(ctx context.Context, id string) (*domain.Shelter, error)
	rejectFn          func(ctx context.Context, id string, reason string) (*domain.Shelter, error)
	approveLinksFn    func(ctx context.Context, id string) (*domain.Shelter, error)
	rejectLinksFn     func(ctx context.Context, id string) (*domain.Shelter, error)
```

and the methods (after `Update`):

```go
func (m *mockShelterService) RegisterOwn(ctx context.Context, userID string, shelter *domain.Shelter) error {
	if m.registerOwnFn != nil {
		return m.registerOwnFn(ctx, userID, shelter)
	}
	return nil
}

func (m *mockShelterService) GetMine(ctx context.Context, userID string) (*domain.Shelter, error) {
	if m.getMineFn != nil {
		return m.getMineFn(ctx, userID)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
	if m.updateMineFn != nil {
		return m.updateMineFn(ctx, userID, req)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	if m.getPendingQueueFn != nil {
		return m.getPendingQueueFn(ctx)
	}
	return []domain.Shelter{}, nil
}

func (m *mockShelterService) Approve(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.approveFn != nil {
		return m.approveFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error) {
	if m.rejectFn != nil {
		return m.rejectFn(ctx, id, reason)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.approveLinksFn != nil {
		return m.approveLinksFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) RejectLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.rejectLinksFn != nil {
		return m.rejectLinksFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}
```

- [ ] **Step 6: Wire the new dependencies in `router.go`**

In `backend/internal/app/router.go` line 115, change:

```go
	shelterService := service.NewShelterService(shelterRepo, userRepo, bus)
```

(`userRepo` is declared at line 86 and `bus` at line 73 — both are already in scope.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && go build ./... && go test ./tests/ -run TestShelterService -v`
Expected: PASS (new + pre-existing service tests; unit-only, no DB needed).

- [ ] **Step 8: Commit**

```bash
git add backend/internal/event/event_bus.go backend/internal/service/shelter_service.go backend/internal/app/router.go backend/tests/shelter_service_test.go backend/tests/shelter_handler_test.go
git commit -m "feat(shelters): self-registration and owner lookup service with submitted event"
```

---
### Task 6: Service — `UpdateMine` (free edit, resubmit, staged links)

**Files:**
- Modify: `backend/internal/service/shelter_service.go` (replace the Task 5 compile stub of `UpdateMine`)
- Modify: `backend/tests/shelter_service_test.go` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/shelter_service_test.go`:

```go
// ============================================================
// UpdateMine tests
// ============================================================

// ownedShelter builds a persisted-looking shelter owned by ownerID, and a mock
// repo that returns it from GetByOwner and captures Update calls.
func ownedShelter(ownerID uuid.UUID, status string) (*domain.Shelter, *mockShelterRepository) {
	shelter := &domain.Shelter{
		ID:          uuid.New(),
		OwnerUserID: &ownerID,
		Name:        "Refugio Original",
		City:        "Montevideo",
		WebsiteURL:  "https://original.org",
		DonationURL: "https://original.org/donar",
		Status:      status,
	}
	repo := &mockShelterRepository{
		getByOwnerFn: func(_ context.Context, id uuid.UUID) (*domain.Shelter, error) {
			if id == ownerID {
				return shelter, nil
			}
			return nil, domain.ErrShelterNotFound
		},
	}
	return shelter, repo
}

func strPtr(s string) *string { return &s }

func TestShelterService_UpdateMine_ApprovedStagesLinkChanges(t *testing.T) {
	ownerID := uuid.New()
	shelter, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	var saved *domain.Shelter
	repo.updateFn = func(_ context.Context, s *domain.Shelter) error {
		saved = s
		return nil
	}
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		Name:        strPtr("Refugio Renombrado"),
		DonationURL: strPtr("https://nuevo.org/donar"),
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if saved == nil {
		t.Fatal("want repo.Update called")
	}
	// Normal field applies immediately.
	if got.Name != "Refugio Renombrado" {
		t.Errorf("Name: want applied, got %q", got.Name)
	}
	// Link change is STAGED: live value untouched, pending set.
	if got.DonationURL != "https://original.org/donar" {
		t.Errorf("DonationURL: want live value untouched, got %q", got.DonationURL)
	}
	if got.PendingDonationURL == nil || *got.PendingDonationURL != "https://nuevo.org/donar" {
		t.Errorf("PendingDonationURL: want staged, got %v", got.PendingDonationURL)
	}
	// Untouched link stays unstaged.
	if got.PendingWebsiteURL != nil {
		t.Errorf("PendingWebsiteURL: want nil, got %v", got.PendingWebsiteURL)
	}
	if got.Status != domain.ShelterStatusApproved {
		t.Errorf("Status: want approved unchanged, got %q", got.Status)
	}
	_ = shelter
}

func TestShelterService_UpdateMine_ApprovedStagesLinkClear(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		WebsiteURL: strPtr(""), // regla #22: "" explícito = vaciar → staged clear
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.WebsiteURL != "https://original.org" {
		t.Errorf("WebsiteURL: want live value untouched, got %q", got.WebsiteURL)
	}
	if got.PendingWebsiteURL == nil || *got.PendingWebsiteURL != "" {
		t.Errorf("PendingWebsiteURL: want staged clear (&\"\"), got %v", got.PendingWebsiteURL)
	}
}

func TestShelterService_UpdateMine_ApprovedSameValueNotStaged(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusApproved)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		DonationURL: strPtr("https://original.org/donar"), // same as live → no-op
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.PendingDonationURL != nil {
		t.Errorf("PendingDonationURL: want nil for unchanged value, got %v", got.PendingDonationURL)
	}
}

func TestShelterService_UpdateMine_RejectedResubmits(t *testing.T) {
	ownerID := uuid.New()
	shelter, repo := ownedShelter(ownerID, domain.ShelterStatusRejected)
	shelter.RejectionReason = "link roto"
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, buildBusExpecting(t, "shelter.submitted"))

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		DonationURL: strPtr("https://arreglado.org/donar"),
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	// rejected edits apply DIRECTLY (no staging) and resubmit.
	if got.DonationURL != "https://arreglado.org/donar" {
		t.Errorf("DonationURL: want applied directly, got %q", got.DonationURL)
	}
	if got.PendingDonationURL != nil {
		t.Errorf("PendingDonationURL: want nil in rejected, got %v", got.PendingDonationURL)
	}
	if got.Status != domain.ShelterStatusPending {
		t.Errorf("Status: want pending (resubmitted), got %q", got.Status)
	}
	if got.RejectionReason != "" {
		t.Errorf("RejectionReason: want cleared, got %q", got.RejectionReason)
	}
}

func TestShelterService_UpdateMine_PendingEditsFreely(t *testing.T) {
	ownerID := uuid.New()
	_, repo := ownedShelter(ownerID, domain.ShelterStatusPending)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, event.NewEventBus())

	got, err := svc.UpdateMine(context.Background(), ownerID.String(), &dto.UpdateMyShelterRequest{
		WebsiteURL: strPtr("https://cambiada.org"),
	})
	if err != nil {
		t.Fatalf("UpdateMine: %v", err)
	}
	if got.WebsiteURL != "https://cambiada.org" {
		t.Errorf("WebsiteURL: want applied directly, got %q", got.WebsiteURL)
	}
	if got.Status != domain.ShelterStatusPending {
		t.Errorf("Status: want pending unchanged, got %q", got.Status)
	}
}

func TestShelterService_UpdateMine_NoShelter(t *testing.T) {
	svc := newTestShelterService(&mockShelterRepository{})
	if _, err := svc.UpdateMine(context.Background(), uuid.New().String(), &dto.UpdateMyShelterRequest{}); !errors.Is(err, domain.ErrShelterNotFound) {
		t.Errorf("want ErrShelterNotFound, got %v", err)
	}
	if _, err := svc.UpdateMine(context.Background(), "nope", &dto.UpdateMyShelterRequest{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

// buildBusExpecting returns a bus that FAILS the test if eventName is NOT
// published within 2s. Cleanup asserts on test end.
func buildBusExpecting(t *testing.T, eventName string) *event.EventBus {
	t.Helper()
	bus := event.NewEventBus()
	received := make(chan struct{}, 1)
	bus.Subscribe(eventName, func(_ interface{}) {
		received <- struct{}{}
	})
	t.Cleanup(func() {
		select {
		case <-received:
		case <-time.After(2 * time.Second):
			t.Errorf("timeout: %s not published", eventName)
		}
	})
	return bus
}
```

Add `"lost-pets/internal/dto"` to the file's imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run TestShelterService_UpdateMine -v`
Expected: FAIL — every subtest gets `ErrInternal` from the Task 5 compile stub.

- [ ] **Step 3: Implement `UpdateMine`**

In `backend/internal/service/shelter_service.go`, replace the `UpdateMine` stub with:

```go
// UpdateMine aplica la edición del dueño según el estado del refugio:
//   - approved: los campos normales aplican al instante; un cambio de
//     website/donation queda STAGED en Pending* (revisión admin) y el listado
//     público sigue sirviendo el valor vivo mientras tanto.
//   - pending: todo edita libre, sigue pending.
//   - rejected: todo edita libre y el guardado REENVÍA (→ pending, limpia el
//     motivo, publica shelter.submitted).
func (s *shelterService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
	ownerUUID, err := uuid.Parse(userID)
	if err != nil {
		return nil, domain.ErrInvalidInput
	}
	shelter, err := s.repo.GetByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, err
	}

	// Campos "normales": aplican en cualquier estado.
	if req.Name != nil {
		shelter.Name = *req.Name
	}
	if req.City != nil {
		shelter.City = *req.City
	}
	if req.Phone != nil {
		shelter.Phone = *req.Phone
	}
	if req.Email != nil {
		shelter.Email = *req.Email
	}
	if req.Description != nil {
		shelter.Description = *req.Description
	}
	if req.Latitude != nil {
		shelter.Latitude = req.Latitude
	}
	if req.Longitude != nil {
		shelter.Longitude = req.Longitude
	}

	resubmitted := false
	if shelter.Status == domain.ShelterStatusApproved {
		// Links sensibles → staging. Solo si el valor realmente cambia.
		if req.WebsiteURL != nil && *req.WebsiteURL != shelter.WebsiteURL {
			shelter.PendingWebsiteURL = req.WebsiteURL
		}
		if req.DonationURL != nil && *req.DonationURL != shelter.DonationURL {
			shelter.PendingDonationURL = req.DonationURL
		}
	} else {
		// pending/rejected: los links editan libre (todavía no hay nada publicado).
		if req.WebsiteURL != nil {
			shelter.WebsiteURL = *req.WebsiteURL
		}
		if req.DonationURL != nil {
			shelter.DonationURL = *req.DonationURL
		}
		if shelter.Status == domain.ShelterStatusRejected {
			shelter.Status = domain.ShelterStatusPending
			shelter.RejectionReason = ""
			resubmitted = true
		}
	}

	if err := s.repo.Update(ctx, shelter); err != nil {
		return nil, err
	}

	if resubmitted && s.bus != nil && shelter.OwnerUserID != nil {
		s.bus.Publish("shelter.submitted", event.ShelterSubmittedEvent{
			ShelterID:   shelter.ID,
			OwnerUserID: *shelter.OwnerUserID,
			ShelterName: shelter.Name,
		})
	}
	return shelter, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./tests/ -run TestShelterService_UpdateMine -v`
Expected: PASS (all subtests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/shelter_service.go backend/tests/shelter_service_test.go
git commit -m "feat(shelters): owner edits with staged links and rejected resubmit"
```

---

### Task 7: Service — admin transitions (`Approve`, `Reject`, `ApproveLinks`, `RejectLinks`)

**Files:**
- Modify: `backend/internal/service/shelter_service.go` (replace the Task 5 compile stubs; add `"strings"` import)
- Modify: `backend/tests/shelter_service_test.go` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/shelter_service_test.go`:

```go
// ============================================================
// Admin transition tests
// ============================================================

// shelterByIDRepo returns a repo whose GetByID serves the given shelter and
// whose Update captures the saved value.
func shelterByIDRepo(shelter *domain.Shelter) (*mockShelterRepository, **domain.Shelter) {
	var saved *domain.Shelter
	repo := &mockShelterRepository{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.Shelter, error) {
			if id == shelter.ID {
				return shelter, nil
			}
			return nil, domain.ErrShelterNotFound
		},
		updateFn: func(_ context.Context, s *domain.Shelter) error {
			saved = s
			return nil
		},
	}
	return repo, &saved
}

func TestShelterService_Approve(t *testing.T) {
	ownerID := uuid.New()
	shelter := &domain.Shelter{ID: uuid.New(), OwnerUserID: &ownerID, Name: "Refugio", City: "Montevideo", Status: domain.ShelterStatusPending}
	repo, saved := shelterByIDRepo(shelter)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, buildBusExpecting(t, "shelter.approved"))

	got, err := svc.Approve(context.Background(), shelter.ID.String())
	if err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if got.Status != domain.ShelterStatusApproved {
		t.Errorf("Status: want approved, got %q", got.Status)
	}
	if *saved == nil {
		t.Fatal("want repo.Update called")
	}
}

func TestShelterService_Approve_InvalidTransition(t *testing.T) {
	shelter := &domain.Shelter{ID: uuid.New(), Name: "R", City: "M", Status: domain.ShelterStatusApproved}
	repo, _ := shelterByIDRepo(shelter)
	svc := newTestShelterService(repo)

	if _, err := svc.Approve(context.Background(), shelter.ID.String()); !errors.Is(err, domain.ErrInvalidShelterStatus) {
		t.Errorf("approve on approved: want ErrInvalidShelterStatus, got %v", err)
	}
}

func TestShelterService_Reject(t *testing.T) {
	ownerID := uuid.New()
	shelter := &domain.Shelter{ID: uuid.New(), OwnerUserID: &ownerID, Name: "Refugio", City: "Montevideo", Status: domain.ShelterStatusPending}
	repo, _ := shelterByIDRepo(shelter)
	svc := newTestShelterServiceFull(repo, &mockUserRepository{}, buildBusExpecting(t, "shelter.rejected"))

	got, err := svc.Reject(context.Background(), shelter.ID.String(), "  link de donación sospechoso  ")
	if err != nil {
		t.Fatalf("Reject: %v", err)
	}
	if got.Status != domain.ShelterStatusRejected {
		t.Errorf("Status: want rejected, got %q", got.Status)
	}
	if got.RejectionReason != "link de donación sospechoso" {
		t.Errorf("RejectionReason: want trimmed reason, got %q", got.RejectionReason)
	}
}

func TestShelterService_Reject_Guards(t *testing.T) {
	shelter := &domain.Shelter{ID: uuid.New(), Name: "R", City: "M", Status: domain.ShelterStatusPending}
	repo, _ := shelterByIDRepo(shelter)
	svc := newTestShelterService(repo)

	if _, err := svc.Reject(context.Background(), shelter.ID.String(), "   "); !errors.Is(err, domain.ErrRejectionReasonRequired) {
		t.Errorf("blank reason: want ErrRejectionReasonRequired, got %v", err)
	}

	approved := &domain.Shelter{ID: uuid.New(), Name: "R", City: "M", Status: domain.ShelterStatusApproved}
	repoB, _ := shelterByIDRepo(approved)
	svcB := newTestShelterService(repoB)
	if _, err := svcB.Reject(context.Background(), approved.ID.String(), "motivo"); !errors.Is(err, domain.ErrInvalidShelterStatus) {
		t.Errorf("reject on approved: want ErrInvalidShelterStatus, got %v", err)
	}
}

func TestShelterService_ApproveLinks(t *testing.T) {
	shelter := &domain.Shelter{
		ID:                 uuid.New(),
		Name:               "Refugio",
		City:               "Montevideo",
		Status:             domain.ShelterStatusApproved,
		WebsiteURL:         "https://vieja.org",
		DonationURL:        "https://vieja.org/donar",
		PendingWebsiteURL:  strPtr(""), // staged CLEAR
		PendingDonationURL: strPtr("https://nueva.org/donar"),
	}
	repo, _ := shelterByIDRepo(shelter)
	svc := newTestShelterService(repo)

	got, err := svc.ApproveLinks(context.Background(), shelter.ID.String())
	if err != nil {
		t.Fatalf("ApproveLinks: %v", err)
	}
	if got.DonationURL != "https://nueva.org/donar" {
		t.Errorf("DonationURL: want pending applied, got %q", got.DonationURL)
	}
	if got.WebsiteURL != "" {
		t.Errorf("WebsiteURL: want cleared (staged \"\"), got %q", got.WebsiteURL)
	}
	if got.PendingDonationURL != nil || got.PendingWebsiteURL != nil {
		t.Errorf("Pending*: want both nil after apply, got %v / %v", got.PendingDonationURL, got.PendingWebsiteURL)
	}
}

func TestShelterService_RejectLinks(t *testing.T) {
	shelter := &domain.Shelter{
		ID:                 uuid.New(),
		Name:               "Refugio",
		City:               "Montevideo",
		Status:             domain.ShelterStatusApproved,
		DonationURL:        "https://vieja.org/donar",
		PendingDonationURL: strPtr("https://scam.org/donar"),
	}
	repo, _ := shelterByIDRepo(shelter)
	svc := newTestShelterService(repo)

	got, err := svc.RejectLinks(context.Background(), shelter.ID.String())
	if err != nil {
		t.Fatalf("RejectLinks: %v", err)
	}
	if got.DonationURL != "https://vieja.org/donar" {
		t.Errorf("DonationURL: want live value untouched, got %q", got.DonationURL)
	}
	if got.PendingDonationURL != nil {
		t.Errorf("PendingDonationURL: want discarded, got %v", got.PendingDonationURL)
	}
}

func TestShelterService_Links_NothingStaged(t *testing.T) {
	shelter := &domain.Shelter{ID: uuid.New(), Name: "R", City: "M", Status: domain.ShelterStatusApproved}
	repo, _ := shelterByIDRepo(shelter)
	svc := newTestShelterService(repo)

	if _, err := svc.ApproveLinks(context.Background(), shelter.ID.String()); !errors.Is(err, domain.ErrInvalidShelterStatus) {
		t.Errorf("approve links with nothing staged: want ErrInvalidShelterStatus, got %v", err)
	}
	if _, err := svc.RejectLinks(context.Background(), shelter.ID.String()); !errors.Is(err, domain.ErrInvalidShelterStatus) {
		t.Errorf("reject links with nothing staged: want ErrInvalidShelterStatus, got %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run 'TestShelterService_Approve|TestShelterService_Reject|TestShelterService_ApproveLinks|TestShelterService_RejectLinks|TestShelterService_Links' -v`
Expected: FAIL — every subtest gets `ErrInternal` from the Task 5 compile stubs.

- [ ] **Step 3: Implement the transitions**

In `backend/internal/service/shelter_service.go`, add `"strings"` to the imports and replace the four stubs with:

```go
// Approve pasa un refugio pending → approved y notifica al dueño.
func (s *shelterService) Approve(ctx context.Context, id string) (*domain.Shelter, error) {
	shelter, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if shelter.Status != domain.ShelterStatusPending {
		return nil, domain.ErrInvalidShelterStatus
	}
	shelter.Status = domain.ShelterStatusApproved
	shelter.RejectionReason = ""
	if err := s.repo.Update(ctx, shelter); err != nil {
		return nil, err
	}
	if s.bus != nil && shelter.OwnerUserID != nil {
		s.bus.Publish("shelter.approved", event.ShelterApprovedEvent{
			ShelterID:   shelter.ID,
			OwnerUserID: *shelter.OwnerUserID,
			ShelterName: shelter.Name,
		})
	}
	return shelter, nil
}

// Reject pasa un refugio pending → rejected con motivo obligatorio.
// rejected NO es terminal: el dueño edita y reenvía (UpdateMine).
func (s *shelterService) Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, domain.ErrRejectionReasonRequired
	}
	shelter, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if shelter.Status != domain.ShelterStatusPending {
		return nil, domain.ErrInvalidShelterStatus
	}
	shelter.Status = domain.ShelterStatusRejected
	shelter.RejectionReason = reason
	if err := s.repo.Update(ctx, shelter); err != nil {
		return nil, err
	}
	if s.bus != nil && shelter.OwnerUserID != nil {
		s.bus.Publish("shelter.rejected", event.ShelterRejectedEvent{
			ShelterID:   shelter.ID,
			OwnerUserID: *shelter.OwnerUserID,
			ShelterName: shelter.Name,
			Reason:      reason,
		})
	}
	return shelter, nil
}

// getWithStagedLinks carga el refugio y valida que esté approved con al menos
// un cambio de link staged — guard compartido de ApproveLinks/RejectLinks.
func (s *shelterService) getWithStagedLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	shelter, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if shelter.Status != domain.ShelterStatusApproved ||
		(shelter.PendingDonationURL == nil && shelter.PendingWebsiteURL == nil) {
		return nil, domain.ErrInvalidShelterStatus
	}
	return shelter, nil
}

// ApproveLinks copia los Pending* a los campos vivos y los limpia.
// Un staged clear (&"") deja el campo vivo vacío — el link desaparece del listado.
func (s *shelterService) ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	shelter, err := s.getWithStagedLinks(ctx, id)
	if err != nil {
		return nil, err
	}
	if shelter.PendingDonationURL != nil {
		shelter.DonationURL = *shelter.PendingDonationURL
		shelter.PendingDonationURL = nil
	}
	if shelter.PendingWebsiteURL != nil {
		shelter.WebsiteURL = *shelter.PendingWebsiteURL
		shelter.PendingWebsiteURL = nil
	}
	if err := s.repo.Update(ctx, shelter); err != nil {
		return nil, err
	}
	return shelter, nil
}

// RejectLinks descarta los Pending* sin tocar los campos vivos.
func (s *shelterService) RejectLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	shelter, err := s.getWithStagedLinks(ctx, id)
	if err != nil {
		return nil, err
	}
	shelter.PendingDonationURL = nil
	shelter.PendingWebsiteURL = nil
	if err := s.repo.Update(ctx, shelter); err != nil {
		return nil, err
	}
	return shelter, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go build ./... && go test ./tests/ -run TestShelterService -v`
Expected: PASS (all shelter service tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/shelter_service.go backend/tests/shelter_service_test.go
git commit -m "feat(shelters): admin approve/reject transitions and staged link resolution"
```

---

### Task 8: NotificationService — push to owner on `shelter.approved` / `shelter.rejected`

**Files:**
- Modify: `backend/internal/service/notification_service.go` (`RegisterListeners` + two handlers)
- Modify: `backend/internal/service/notification_service_test.go` (append tests — same `service_test` package, reuses `newMockDeviceTokenRepo` and `newMockFCMClient`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/service/notification_service_test.go`:

```go
func TestNotificationService_ShelterApproved_PushesOwner(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()
	ownerID := uuid.New()
	repo.tokens[ownerID] = []domain.DeviceToken{
		{UserID: ownerID, Token: "owner-token", Platform: "android"},
	}
	fcm := newMockFCMClient(1)

	ns := service.NewNotificationService(fcm, repo)
	ns.RegisterListeners(bus)

	shelterID := uuid.New()
	bus.Publish("shelter.approved", event.ShelterApprovedEvent{
		ShelterID:   shelterID,
		OwnerUserID: ownerID,
		ShelterName: "Refugio Test",
	})

	if !fcm.waitCalls(1, 2*time.Second) {
		t.Fatal("timeout: SendPush not called after shelter.approved")
	}
	fcm.mu.Lock()
	defer fcm.mu.Unlock()
	call := fcm.calls[0]
	if call.token != "owner-token" {
		t.Errorf("token: want owner-token, got %q", call.token)
	}
	if call.data["type"] != "shelter.approved" {
		t.Errorf("data.type: want shelter.approved, got %q", call.data["type"])
	}
	if call.data["shelter_id"] != shelterID.String() {
		t.Errorf("data.shelter_id: want %s, got %q", shelterID, call.data["shelter_id"])
	}
}

func TestNotificationService_ShelterRejected_PushesOwnerWithReason(t *testing.T) {
	bus := event.NewEventBus()
	repo := newMockDeviceTokenRepo()
	ownerID := uuid.New()
	repo.tokens[ownerID] = []domain.DeviceToken{
		{UserID: ownerID, Token: "owner-token", Platform: "android"},
	}
	fcm := newMockFCMClient(1)

	ns := service.NewNotificationService(fcm, repo)
	ns.RegisterListeners(bus)

	bus.Publish("shelter.rejected", event.ShelterRejectedEvent{
		ShelterID:   uuid.New(),
		OwnerUserID: ownerID,
		ShelterName: "Refugio Test",
		Reason:      "link de donación roto",
	})

	if !fcm.waitCalls(1, 2*time.Second) {
		t.Fatal("timeout: SendPush not called after shelter.rejected")
	}
	fcm.mu.Lock()
	defer fcm.mu.Unlock()
	call := fcm.calls[0]
	if call.data["type"] != "shelter.rejected" {
		t.Errorf("data.type: want shelter.rejected, got %q", call.data["type"])
	}
	if !strings.Contains(call.body, "link de donación roto") {
		t.Errorf("body should include the rejection reason, got %q", call.body)
	}
}
```

Add `"strings"` to that file's imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/service/ -run 'TestNotificationService_Shelter' -v`
Expected: FAIL with "timeout: SendPush not called" (no subscription yet).

- [ ] **Step 3: Implement the listeners**

In `backend/internal/service/notification_service.go`, extend `RegisterListeners`:

```go
// RegisterListeners suscribe los handlers al EventBus.
// Debe llamarse una vez durante el arranque del servidor, después de crear el EventBus.
func (ns *NotificationService) RegisterListeners(bus *event.EventBus) {
	bus.Subscribe("report.created", ns.onReportCreated)
	bus.Subscribe("message.sent", ns.onMessageSent)
	bus.Subscribe("alert.triggered", ns.onAlertTriggered)
	bus.Subscribe("pet.found", ns.onPetFound)
	bus.Subscribe("shelter.approved", ns.onShelterApproved)
	bus.Subscribe("shelter.rejected", ns.onShelterRejected)
}
```

and append after `onPetFound`:

```go
// onShelterApproved maneja "shelter.approved": push al dueño del refugio.
// Mismo patrón fan-out que onPetFound (goroutine por token + limpieza de stale).
func (ns *NotificationService) onShelterApproved(payload interface{}) {
	ev, ok := payload.(event.ShelterApprovedEvent)
	if !ok {
		log.Printf("[NotificationService] onShelterApproved: tipo de payload inesperado: %T", payload)
		return
	}
	title := "¡Tu refugio fue aprobado! 🎉"
	body := fmt.Sprintf("%s ya aparece en el directorio de refugios", ev.ShelterName)
	ns.pushToUser(ev.OwnerUserID, title, body, map[string]string{
		"type":       "shelter.approved",
		"shelter_id": ev.ShelterID.String(),
		"entityId":   ev.ShelterID.String(),
	})
}

// onShelterRejected maneja "shelter.rejected": push al dueño con el motivo.
func (ns *NotificationService) onShelterRejected(payload interface{}) {
	ev, ok := payload.(event.ShelterRejectedEvent)
	if !ok {
		log.Printf("[NotificationService] onShelterRejected: tipo de payload inesperado: %T", payload)
		return
	}
	title := fmt.Sprintf("Tu refugio %s necesita cambios", ev.ShelterName)
	body := fmt.Sprintf("Motivo: %s. Corregí los datos y reenvialo desde la app.", ev.Reason)
	ns.pushToUser(ev.OwnerUserID, title, body, map[string]string{
		"type":       "shelter.rejected",
		"shelter_id": ev.ShelterID.String(),
		"entityId":   ev.ShelterID.String(),
	})
}

// pushToUser resuelve los tokens del usuario y hace el fan-out con limpieza de
// tokens inválidos — el cuerpo común de onPetFound/onShelter*.
func (ns *NotificationService) pushToUser(userID uuid.UUID, title, body string, data map[string]string) {
	ctx := context.Background()

	tokens, err := ns.deviceTokenRepo.FindByUserID(ctx, userID)
	if err != nil {
		log.Printf("[NotificationService] pushToUser: error obteniendo tokens para %s: %v", userID, err)
		return
	}
	if len(tokens) == 0 {
		return
	}

	for _, t := range tokens {
		t := t // captura
		go func() {
			err := ns.fcmClient.SendPush(ctx, t.Token, title, body, data)
			if err != nil {
				if isStaleTokenError(err) {
					if delErr := ns.deviceTokenRepo.DeleteByToken(ctx, t.Token); delErr != nil {
						log.Printf("[NotificationService] error eliminando token inválido %q: %v", t.Token, delErr)
					}
				} else {
					log.Printf("[NotificationService] pushToUser: error enviando push a %q: %v", t.Token, err)
				}
			}
		}()
	}
}
```

Add `"github.com/google/uuid"` to the file's imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/service/ -run TestNotificationService -v`
Expected: PASS (new shelter tests + all pre-existing notification tests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/notification_service.go backend/internal/service/notification_service_test.go
git commit -m "feat(shelters): owner push notifications on approval and rejection"
```

---

### Task 9: Owner HTTP handlers + routes (`POST /shelters`, `GET/PUT /shelters/mine`) + public-DTO leak test

**Files:**
- Modify: `backend/internal/handler/shelter_handler.go` (three handlers at the end)
- Modify: `backend/internal/app/router.go` (three routes in the `protected` group)
- Modify: `backend/tests/shelter_handler_test.go` (auth'd router helper + tests; add `"strings"` to its imports — `dto` is already imported)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/shelter_handler_test.go`:

```go
// setupOwnerShelterRouter registra las rutas owner+admin con un userID inyectado
// (imita middleware.Auth, igual que setupMessageRouter en message_handler_test.go).
func setupOwnerShelterRouter(h *handler.ShelterHandler, userID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("userID", userID)
		c.Next()
	})
	r.GET("/api/shelters", h.GetAll)
	r.POST("/api/shelters", h.RegisterOwn)
	r.GET("/api/shelters/mine", h.GetMine)
	r.PUT("/api/shelters/mine", h.UpdateMine)
	r.GET("/api/admin/shelters/pending", h.PendingQueue)
	r.POST("/api/admin/shelters/:id/approve", h.Approve)
	r.POST("/api/admin/shelters/:id/reject", h.Reject)
	r.POST("/api/admin/shelters/:id/links/approve", h.ApproveLinks)
	r.POST("/api/admin/shelters/:id/links/reject", h.RejectLinks)
	return r
}

func decodeErrorResponse(t *testing.T, w *httptest.ResponseRecorder) dto.ErrorResponse {
	t.Helper()
	var resp dto.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode error response: %v — body: %s", err, w.Body.String())
	}
	return resp
}

// ============================================================
// RegisterOwn tests
// ============================================================

func TestShelterHandler_RegisterOwn_Returns201(t *testing.T) {
	callerID := uuid.New()
	var gotUserID string
	svc := &mockShelterService{
		registerOwnFn: func(_ context.Context, userID string, shelter *domain.Shelter) error {
			gotUserID = userID
			shelter.ID = uuid.New()
			shelter.Status = domain.ShelterStatusPending
			return nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, callerID)

	body := `{"name":"Mi Refugio","city":"Montevideo","donation_url":"https://mi.org/donar"}`
	req := httptest.NewRequest(http.MethodPost, "/api/shelters", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", w.Code, w.Body.String())
	}
	if gotUserID != callerID.String() {
		t.Errorf("service called with userID %q, want %q", gotUserID, callerID)
	}
	var resp dto.MyShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != domain.ShelterStatusPending {
		t.Errorf("response status: want pending, got %q", resp.Status)
	}
}

func TestShelterHandler_RegisterOwn_ErrorCodes(t *testing.T) {
	cases := []struct {
		name       string
		svcErr     error
		wantStatus int
		wantCode   string
	}{
		{"unverified email", domain.ErrEmailNotVerified, http.StatusForbidden, "email_not_verified"},
		{"already owned", domain.ErrShelterAlreadyOwned, http.StatusConflict, "shelter_already_owned"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockShelterService{
				registerOwnFn: func(_ context.Context, _ string, _ *domain.Shelter) error {
					return tc.svcErr
				},
			}
			h := handler.NewShelterHandler(svc)
			r := setupOwnerShelterRouter(h, uuid.New())

			body := `{"name":"Mi Refugio","city":"Montevideo"}`
			req := httptest.NewRequest(http.MethodPost, "/api/shelters", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("want %d, got %d — body: %s", tc.wantStatus, w.Code, w.Body.String())
			}
			if resp := decodeErrorResponse(t, w); resp.Code != tc.wantCode {
				t.Errorf("code: want %q, got %q", tc.wantCode, resp.Code)
			}
		})
	}
}

func TestShelterHandler_RegisterOwn_InvalidURL_Returns400(t *testing.T) {
	svc := &mockShelterService{}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	body := `{"name":"Mi Refugio","city":"Montevideo","donation_url":"http://sin-tls.org"}`
	req := httptest.NewRequest(http.MethodPost, "/api/shelters", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d — body: %s", w.Code, w.Body.String())
	}
	if resp := decodeErrorResponse(t, w); resp.Code != "invalid_input" {
		t.Errorf("code: want invalid_input, got %q", resp.Code)
	}
}

// ============================================================
// GetMine / UpdateMine tests
// ============================================================

func TestShelterHandler_GetMine(t *testing.T) {
	callerID := uuid.New()
	mine := &domain.Shelter{
		ID: uuid.New(), OwnerUserID: &callerID, Name: "Mi Refugio", City: "Montevideo",
		Status: domain.ShelterStatusRejected, RejectionReason: "link roto",
	}
	svc := &mockShelterService{
		getMineFn: func(_ context.Context, userID string) (*domain.Shelter, error) {
			if userID == callerID.String() {
				return mine, nil
			}
			return nil, domain.ErrShelterNotFound
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters/mine", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp dto.MyShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.RejectionReason != "link roto" {
		t.Errorf("owner view must include rejection_reason, got %q", resp.RejectionReason)
	}
}

func TestShelterHandler_GetMine_NotFound(t *testing.T) {
	h := handler.NewShelterHandler(&mockShelterService{})
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/shelters/mine", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
	if resp := decodeErrorResponse(t, w); resp.Code != "shelter_not_found" {
		t.Errorf("code: want shelter_not_found, got %q", resp.Code)
	}
}

func TestShelterHandler_UpdateMine_Returns200(t *testing.T) {
	callerID := uuid.New()
	svc := &mockShelterService{
		updateMineFn: func(_ context.Context, _ string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
			return &domain.Shelter{
				ID: uuid.New(), Name: *req.Name, City: "Montevideo",
				Status: domain.ShelterStatusPending,
			}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, callerID)

	body := `{"name":"Renombrado"}`
	req := httptest.NewRequest(http.MethodPut, "/api/shelters/mine", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// SECURITY: the public directory must not leak review fields
// ============================================================

func TestShelterHandler_GetAll_NeverLeaksReviewFields(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://staged.org/donar"
	svc := &mockShelterService{
		getAllFn: func(_ context.Context, _ string) ([]domain.Shelter, error) {
			return []domain.Shelter{{
				ID:                 uuid.New(),
				OwnerUserID:        &ownerID,
				Name:               "Refugio Público",
				City:               "Montevideo",
				Status:             domain.ShelterStatusApproved,
				RejectionReason:    "dato interno viejo",
				PendingDonationURL: &pendingURL,
			}}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, leaked := range []string{"owner_user_id", "rejection_reason", "pending_donation_url", "pending_website_url", "status"} {
		if strings.Contains(body, leaked) {
			t.Errorf("public GET /api/shelters leaks %q: %s", leaked, body)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run TestShelterHandler -v`
Expected: FAIL (compile error: `RegisterOwn` undefined on `*handler.ShelterHandler`).

- [ ] **Step 3: Implement the handlers**

Append to `backend/internal/handler/shelter_handler.go`:

```go
// RegisterOwn godoc
// POST /api/shelters (JWT)
// Auto-registro del refugio del usuario autenticado. Nace pending.
// 201 | 400 invalid_input/binding_failed | 403 email_not_verified | 409 shelter_already_owned
func (h *ShelterHandler) RegisterOwn(c *gin.Context) {
	var req dto.RegisterShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	shelter := dto.ToRegisterShelterDomain(&req)
	if err := h.shelterService.RegisterOwn(c.Request.Context(), getUserID(c), shelter); err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailNotVerified):
			writeError(c, http.StatusForbidden, err)
		case errors.Is(err, domain.ErrShelterAlreadyOwned):
			writeError(c, http.StatusConflict, err)
		case errors.Is(err, domain.ErrUserNotFound):
			writeError(c, http.StatusNotFound, err)
		case errors.Is(err, domain.ErrInvalidInput):
			writeError(c, http.StatusBadRequest, err)
		default:
			writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		}
		return
	}

	c.JSON(http.StatusCreated, dto.ToMyShelterResponse(shelter))
}

// GetMine godoc
// GET /api/shelters/mine (JWT)
// Vista completa del dueño: status, rejection_reason y links staged incluidos.
func (h *ShelterHandler) GetMine(c *gin.Context) {
	shelter, err := h.shelterService.GetMine(c.Request.Context(), getUserID(c))
	if err != nil {
		if errors.Is(err, domain.ErrShelterNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyShelterResponse(shelter))
}

// UpdateMine godoc
// PUT /api/shelters/mine (JWT)
// Edición del dueño. El service decide staging vs aplicación directa según estado.
func (h *ShelterHandler) UpdateMine(c *gin.Context) {
	var req dto.UpdateMyShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrBindingFailed)
		return
	}
	if err := req.Validate(); err != nil {
		writeError(c, http.StatusBadRequest, err)
		return
	}

	shelter, err := h.shelterService.UpdateMine(c.Request.Context(), getUserID(c), &req)
	if err != nil {
		if errors.Is(err, domain.ErrShelterNotFound) {
			writeError(c, http.StatusNotFound, err)
			return
		}
		if errors.Is(err, domain.ErrInvalidInput) {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToMyShelterResponse(shelter))
}
```

- [ ] **Step 4: Register the routes**

In `backend/internal/app/router.go`, inside the `protected` group (after the `protected.POST("/share/generate/:petId", ...)` line):

```go
		// SHELTER SELF-REGISTRATION (owner). Estáticas /shelters/mine conviven
		// con la pública /shelters/:id — Gin prioriza segmentos estáticos.
		protected.POST("/shelters", shelterHandler.RegisterOwn)
		protected.GET("/shelters/mine", shelterHandler.GetMine)
		protected.PUT("/shelters/mine", shelterHandler.UpdateMine)
```

- [ ] **Step 5: Run tests + build**

Run: `cd backend && go build ./... && go test ./tests/ -run TestShelterHandler -v -count=1`
Expected: PASS (new + pre-existing handler tests, including the leak test).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/shelter_handler.go backend/internal/app/router.go backend/tests/shelter_handler_test.go
git commit -m "feat(shelters): owner registration and my-shelter endpoints"
```

---

### Task 10: Admin HTTP handlers + routes (queue, approve, reject, links)

**Files:**
- Modify: `backend/internal/handler/shelter_handler.go` (five handlers + shared error helper)
- Modify: `backend/internal/app/router.go` (five routes in the `admin` group)
- Modify: `backend/tests/shelter_handler_test.go` (append tests — routes already registered in `setupOwnerShelterRouter`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/shelter_handler_test.go`:

```go
// ============================================================
// Admin queue + transition tests
// ============================================================

func TestShelterHandler_PendingQueue_ReturnsAdminView(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://nuevo.org/donar"
	svc := &mockShelterService{
		getPendingQueueFn: func(_ context.Context) ([]domain.Shelter, error) {
			return []domain.Shelter{{
				ID: uuid.New(), OwnerUserID: &ownerID, Name: "En Cola", City: "Montevideo",
				Status: domain.ShelterStatusApproved, PendingDonationURL: &pendingURL,
			}}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/admin/shelters/pending", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp []dto.AdminShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp) != 1 {
		t.Fatalf("want 1 queue item, got %d", len(resp))
	}
	if resp[0].OwnerUserID == nil || *resp[0].OwnerUserID != ownerID {
		t.Errorf("admin view must include owner_user_id, got %v", resp[0].OwnerUserID)
	}
	if resp[0].PendingDonationURL == nil || *resp[0].PendingDonationURL != pendingURL {
		t.Errorf("admin view must include pending_donation_url, got %v", resp[0].PendingDonationURL)
	}
}

func TestShelterHandler_PendingQueue_EmptyIsArray(t *testing.T) {
	h := handler.NewShelterHandler(&mockShelterService{})
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/admin/shelters/pending", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if body := strings.TrimSpace(w.Body.String()); body != "[]" {
		t.Errorf("want [] for empty queue, got %s", body)
	}
}

func TestShelterHandler_Approve(t *testing.T) {
	shelterID := uuid.New()
	svc := &mockShelterService{
		approveFn: func(_ context.Context, id string) (*domain.Shelter, error) {
			return &domain.Shelter{ID: shelterID, Name: "R", City: "M", Status: domain.ShelterStatusApproved}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodPost, "/api/admin/shelters/"+shelterID.String()+"/approve", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestShelterHandler_Approve_InvalidTransition_Returns409(t *testing.T) {
	svc := &mockShelterService{
		approveFn: func(_ context.Context, _ string) (*domain.Shelter, error) {
			return nil, domain.ErrInvalidShelterStatus
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodPost, "/api/admin/shelters/"+uuid.New().String()+"/approve", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d", w.Code)
	}
	if resp := decodeErrorResponse(t, w); resp.Code != "invalid_shelter_status" {
		t.Errorf("code: want invalid_shelter_status, got %q", resp.Code)
	}
}

func TestShelterHandler_Reject_RequiresReason(t *testing.T) {
	h := handler.NewShelterHandler(&mockShelterService{})
	r := setupOwnerShelterRouter(h, uuid.New())

	// Body sin reason → binding required falla → 400 rejection_reason_required.
	req := httptest.NewRequest(http.MethodPost, "/api/admin/shelters/"+uuid.New().String()+"/reject", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d — body: %s", w.Code, w.Body.String())
	}
	if resp := decodeErrorResponse(t, w); resp.Code != "rejection_reason_required" {
		t.Errorf("code: want rejection_reason_required, got %q", resp.Code)
	}
}

func TestShelterHandler_Reject_PassesReason(t *testing.T) {
	var gotReason string
	svc := &mockShelterService{
		rejectFn: func(_ context.Context, _ string, reason string) (*domain.Shelter, error) {
			gotReason = reason
			return &domain.Shelter{ID: uuid.New(), Name: "R", City: "M", Status: domain.ShelterStatusRejected, RejectionReason: reason}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodPost, "/api/admin/shelters/"+uuid.New().String()+"/reject",
		strings.NewReader(`{"reason":"link de donación sospechoso"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
	if gotReason != "link de donación sospechoso" {
		t.Errorf("reason: want forwarded to service, got %q", gotReason)
	}
}

func TestShelterHandler_LinksEndpoints(t *testing.T) {
	shelterID := uuid.New()
	approveCalled := false
	rejectCalled := false
	svc := &mockShelterService{
		approveLinksFn: func(_ context.Context, id string) (*domain.Shelter, error) {
			approveCalled = true
			return &domain.Shelter{ID: shelterID, Name: "R", City: "M", Status: domain.ShelterStatusApproved}, nil
		},
		rejectLinksFn: func(_ context.Context, id string) (*domain.Shelter, error) {
			rejectCalled = true
			return &domain.Shelter{ID: shelterID, Name: "R", City: "M", Status: domain.ShelterStatusApproved}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	reqA := httptest.NewRequest(http.MethodPost, "/api/admin/shelters/"+shelterID.String()+"/links/approve", nil)
	wA := httptest.NewRecorder()
	r.ServeHTTP(wA, reqA)
	if wA.Code != http.StatusOK || !approveCalled {
		t.Errorf("links/approve: want 200 + service call, got %d (called=%v)", wA.Code, approveCalled)
	}

	reqR := httptest.NewRequest(http.MethodPost, "/api/admin/shelters/"+shelterID.String()+"/links/reject", nil)
	wR := httptest.NewRecorder()
	r.ServeHTTP(wR, reqR)
	if wR.Code != http.StatusOK || !rejectCalled {
		t.Errorf("links/reject: want 200 + service call, got %d (called=%v)", wR.Code, rejectCalled)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./tests/ -run 'TestShelterHandler_Pending|TestShelterHandler_Approve|TestShelterHandler_Reject|TestShelterHandler_Links' -v`
Expected: FAIL (compile error: `PendingQueue` undefined on `*handler.ShelterHandler`).

- [ ] **Step 3: Implement the handlers**

Append to `backend/internal/handler/shelter_handler.go`:

```go
// writeShelterTransitionError mapea los errores comunes de las transiciones admin.
func writeShelterTransitionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrShelterNotFound):
		writeError(c, http.StatusNotFound, err)
	case errors.Is(err, domain.ErrInvalidShelterStatus):
		writeError(c, http.StatusConflict, err)
	case errors.Is(err, domain.ErrRejectionReasonRequired):
		writeError(c, http.StatusBadRequest, err)
	case errors.Is(err, domain.ErrInvalidInput):
		writeError(c, http.StatusBadRequest, err)
	default:
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
	}
}

// PendingQueue godoc
// GET /api/admin/shelters/pending (JWT + RequireAdmin)
// Cola de revisión: registros pending + approved con cambios de links staged.
func (h *ShelterHandler) PendingQueue(c *gin.Context) {
	shelters, err := h.shelterService.GetPendingQueue(c.Request.Context())
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminShelterListResponse(shelters))
}

// Approve godoc
// POST /api/admin/shelters/:id/approve (JWT + RequireAdmin)
func (h *ShelterHandler) Approve(c *gin.Context) {
	shelter, err := h.shelterService.Approve(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeShelterTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminShelterResponse(shelter))
}

// Reject godoc
// POST /api/admin/shelters/:id/reject (JWT + RequireAdmin), body {"reason": "..."} requerido.
func (h *ShelterHandler) Reject(c *gin.Context) {
	var req dto.RejectShelterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.ErrRejectionReasonRequired)
		return
	}
	shelter, err := h.shelterService.Reject(c.Request.Context(), c.Param("id"), req.Reason)
	if err != nil {
		writeShelterTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminShelterResponse(shelter))
}

// ApproveLinks godoc
// POST /api/admin/shelters/:id/links/approve (JWT + RequireAdmin)
func (h *ShelterHandler) ApproveLinks(c *gin.Context) {
	shelter, err := h.shelterService.ApproveLinks(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeShelterTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminShelterResponse(shelter))
}

// RejectLinks godoc
// POST /api/admin/shelters/:id/links/reject (JWT + RequireAdmin)
func (h *ShelterHandler) RejectLinks(c *gin.Context) {
	shelter, err := h.shelterService.RejectLinks(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeShelterTransitionError(c, err)
		return
	}
	c.JSON(http.StatusOK, dto.ToAdminShelterResponse(shelter))
}
```

- [ ] **Step 4: Register the routes**

In `backend/internal/app/router.go`, inside the `admin` group (after `admin.PUT("/admin/shelters/:id", shelterHandler.Update)`):

```go
		// SHELTER APPROVAL QUEUE
		admin.GET("/admin/shelters/pending", shelterHandler.PendingQueue)
		admin.POST("/admin/shelters/:id/approve", shelterHandler.Approve)
		admin.POST("/admin/shelters/:id/reject", shelterHandler.Reject)
		admin.POST("/admin/shelters/:id/links/approve", shelterHandler.ApproveLinks)
		admin.POST("/admin/shelters/:id/links/reject", shelterHandler.RejectLinks)
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -count=1 2>&1 | tail -5 && go test ./internal/... -count=1 2>&1 | tail -5`
Expected: `ok  lost-pets/tests` and all internal packages `ok` — nothing else broke.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/shelter_handler.go backend/internal/app/router.go backend/tests/shelter_handler_test.go
git commit -m "feat(shelters): admin approval queue and transition endpoints"
```

---

### Task 11: Shared types, API client methods, hooks

**Files:**
- Modify: `frontend/packages/shared/types/index.ts` (after the `Shelter` interface, line 162)
- Modify: `frontend/packages/shared/api/client.ts` (SHELTERS section, after `getShelterByID` ~line 643; extend the type import list at the top)
- Modify: `frontend/packages/shared/hooks/index.ts` (after `useShelterByID` ~line 575; extend the type import list)

No unit tests here: the new hooks are useQuery/useMutation passthroughs with invalidation only, which this codebase deliberately does not test (CLAUDE.md testing notes). They get covered through the page tests in Tasks 14-16.

- [ ] **Step 1: Add the types**

In `frontend/packages/shared/types/index.ts`, right after the `Shelter` interface:

```ts
export type ShelterStatus = 'pending' | 'approved' | 'rejected';

// Owner view of their shelter (GET /api/shelters/mine).
// GOTCHA: pending_* use Go *string omitempty semantics — a staged CLEAR arrives
// as "" (present), no staged change arrives as undefined (absent). Check with
// `!== undefined`, never truthiness.
export interface MyShelter extends Shelter {
  status: ShelterStatus;
  rejection_reason?: string;
  pending_donation_url?: string;
  pending_website_url?: string;
}

// Admin queue view: owner view + who owns it.
export interface AdminShelter extends MyShelter {
  owner_user_id?: string;
}

export interface RegisterShelterRequest {
  name: string;
  city: string;
  phone?: string;
  email?: string;
  website_url?: string;
  donation_url?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
}

// PUT /api/shelters/mine — send "" to clear a field (backend *string pattern,
// rule #22); omit (undefined) to leave it untouched.
export interface UpdateMyShelterRequest {
  name?: string;
  city?: string;
  phone?: string;
  email?: string;
  description?: string;
  website_url?: string;
  donation_url?: string;
  latitude?: number;
  longitude?: number;
}
```

- [ ] **Step 2: Add the API client methods**

In `frontend/packages/shared/api/client.ts`, add `MyShelter`, `AdminShelter`, `RegisterShelterRequest`, `UpdateMyShelterRequest` to the type import list, then append inside the SHELTERS section after `getShelterByID`:

```ts
  async registerShelter(data: RegisterShelterRequest): Promise<MyShelter> {
    return this.request<MyShelter>('POST', '/api/shelters', data);
  }

  async getMyShelter(): Promise<MyShelter> {
    return this.request<MyShelter>('GET', '/api/shelters/mine');
  }

  async updateMyShelter(data: UpdateMyShelterRequest): Promise<MyShelter> {
    return this.request<MyShelter>('PUT', '/api/shelters/mine', data);
  }

  async getPendingShelters(): Promise<AdminShelter[]> {
    return this.request<AdminShelter[]>('GET', '/api/admin/shelters/pending');
  }

  async approveShelter(id: string): Promise<AdminShelter> {
    return this.request<AdminShelter>('POST', `/api/admin/shelters/${encodeURIComponent(id)}/approve`);
  }

  async rejectShelter(id: string, reason: string): Promise<AdminShelter> {
    return this.request<AdminShelter>('POST', `/api/admin/shelters/${encodeURIComponent(id)}/reject`, { reason });
  }

  async approveShelterLinks(id: string): Promise<AdminShelter> {
    return this.request<AdminShelter>('POST', `/api/admin/shelters/${encodeURIComponent(id)}/links/approve`);
  }

  async rejectShelterLinks(id: string): Promise<AdminShelter> {
    return this.request<AdminShelter>('POST', `/api/admin/shelters/${encodeURIComponent(id)}/links/reject`);
  }
```

- [ ] **Step 3: Add the hooks**

In `frontend/packages/shared/hooks/index.ts`, add `MyShelter`, `RegisterShelterRequest`, `UpdateMyShelterRequest` to the type import list, then append after `useShelterByID`:

```ts
// useMyShelter — GET /api/shelters/mine. A 404 (shelter_not_found) means the
// user has no shelter yet: surfaces as an error whose .code the pages check.
// retry:false so the expected 404 doesn't burn 3 retries before settling.
export const useMyShelter = () => {
  return useQuery<MyShelter, Error & { code?: string }>({
    queryKey: ['shelter', 'mine'],
    queryFn: () => apiClient.getMyShelter(),
    retry: false,
  });
};

// useRegisterShelter — POST /api/shelters. Invalidates the owner view; the
// public list is untouched on purpose (a pending shelter is not listed yet).
export const useRegisterShelter = () => {
  const queryClient = useQueryClient();
  return useMutation<MyShelter, Error, RegisterShelterRequest>({
    mutationFn: (data) => apiClient.registerShelter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelter', 'mine'] });
    },
  });
};

// useUpdateMyShelter — PUT /api/shelters/mine. Invalidates owner view AND the
// public directory (non-link fields apply immediately on approved shelters).
export const useUpdateMyShelter = () => {
  const queryClient = useQueryClient();
  return useMutation<MyShelter, Error, UpdateMyShelterRequest>({
    mutationFn: (data) => apiClient.updateMyShelter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelter', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['shelters'] });
    },
  });
};
```

(Admin queue actions intentionally have NO shared hooks — the admin page uses `useQuery`/`useMutation` inline with `apiClient`, matching `AbuseReportsPage`.)

- [ ] **Step 4: Typecheck + existing web tests still green**

Run: `cd frontend/packages/web && pnpm exec tsc --noEmit && pnpm vitest run src/pages/SheltersPage.test.tsx`
Expected: no type errors; existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts frontend/packages/shared/hooks/index.ts
git commit -m "feat(shared): shelter self-registration types, client methods and hooks"
```

---
### Task 12: i18n keys — shared `errors` + web `shelters` + web `admin` (es/en/pt)

**Files:**
- Modify: `frontend/packages/shared/i18n/locales/es.json` (`errors` namespace)
- Modify: `frontend/packages/shared/i18n/locales/en.json` (`errors` namespace)
- Modify: `frontend/packages/shared/i18n/locales/pt.json` (`errors` namespace)
- Modify: `frontend/packages/web/src/i18n/locales/es.json` (`shelters` + `admin` namespaces)
- Modify: `frontend/packages/web/src/i18n/locales/en.json`
- Modify: `frontend/packages/web/src/i18n/locales/pt.json`

`shelters` and `admin` are web-only namespaces ALREADY registered in `web/src/i18n/index.ts` — rule #21 satisfied, no registration change. `shelter_not_found` already exists in the shared `errors` namespace; only the 4 new codes are added.

- [ ] **Step 1: Add the shared error keys**

Inside the `"errors"` object of `frontend/packages/shared/i18n/locales/es.json` (merge, keep existing keys):

```json
"shelter_already_owned": "Ya tenés un refugio registrado con esta cuenta",
"email_not_verified": "Necesitás verificar tu email para hacer esto",
"invalid_shelter_status": "El refugio no está en un estado válido para esta acción",
"rejection_reason_required": "Tenés que indicar el motivo del rechazo"
```

`en.json`:

```json
"shelter_already_owned": "You already have a shelter registered with this account",
"email_not_verified": "You need to verify your email to do this",
"invalid_shelter_status": "The shelter is not in a valid state for this action",
"rejection_reason_required": "You must provide a rejection reason"
```

`pt.json`:

```json
"shelter_already_owned": "Você já tem um abrigo registrado com esta conta",
"email_not_verified": "Você precisa verificar seu e-mail para fazer isso",
"invalid_shelter_status": "O abrigo não está em um estado válido para esta ação",
"rejection_reason_required": "Você precisa informar o motivo da rejeição"
```

- [ ] **Step 2: Add the web `shelters` keys**

Inside the `"shelters"` object of `frontend/packages/web/src/i18n/locales/es.json`, REPLACE the `"contactCta"` key with these keys (merge with the existing ones):

```json
"registerCta": "¿Sos un refugio y querés aparecer acá?",
"registerButton": "Registrar mi refugio",
"register": {
  "title": "Registrá tu refugio",
  "step1Title": "Completá los datos",
  "step1Body": "Contanos sobre tu refugio: nombre, ciudad, contacto y links.",
  "step2Title": "El equipo lo revisa",
  "step2Body": "Verificamos los datos y te avisamos con una notificación.",
  "step3Title": "Aparece en el directorio",
  "step3Body": "Tu refugio queda visible para toda la comunidad.",
  "reviewNote": "Revisamos especialmente el link de donaciones y la web para prevenir fraudes.",
  "noMoneyNote": "SearchPet nunca recauda dinero: solo enlazamos a tu propia página de donaciones.",
  "emailUnverified": "Necesitás verificar tu email antes de registrar un refugio.",
  "verifyEmailLink": "Verificar mi email",
  "start": "Empezar",
  "name": "Nombre del refugio",
  "city": "Ciudad",
  "phone": "Teléfono",
  "email": "Email de contacto",
  "description": "Descripción",
  "websiteUrl": "Sitio web (https://...)",
  "donationUrl": "Link de donaciones (https://...)",
  "invalidUrl": "El link debe empezar con https://",
  "nameRequired": "El nombre es obligatorio",
  "cityRequired": "La ciudad es obligatoria",
  "submit": "Enviar para revisión",
  "submitting": "Enviando...",
  "successTitle": "¡Refugio enviado!",
  "successBody": "Tu refugio está en revisión. Te avisamos cuando esté aprobado.",
  "goToMine": "Ver estado de mi refugio"
},
"mine": {
  "title": "Mi refugio",
  "rejectedTitle": "Tu registro fue rechazado",
  "rejectedReason": "Motivo: {{reason}}",
  "resubmitHint": "Corregí los datos y volvé a enviarlo.",
  "resubmit": "Guardar y reenviar",
  "save": "Guardar cambios",
  "saving": "Guardando...",
  "saved": "Cambios guardados",
  "linkReviewWarning": "Los cambios en la web o el link de donaciones pasan por revisión. El directorio sigue mostrando el link anterior mientras tanto.",
  "linkPendingBadge": "Cambio de link en revisión",
  "approvedTitle": "Tu refugio está publicado",
  "loadError": "No pudimos cargar tu refugio.",
  "retry": "Reintentar",
  "noShelterTitle": "Todavía no registraste un refugio",
  "registerNow": "Registrarlo ahora"
}
```

`en.json` (same structure, replace `"contactCta"`):

```json
"registerCta": "Are you a shelter and want to be listed here?",
"registerButton": "Register my shelter",
"register": {
  "title": "Register your shelter",
  "step1Title": "Fill in your data",
  "step1Body": "Tell us about your shelter: name, city, contact and links.",
  "step2Title": "The team reviews it",
  "step2Body": "We verify the data and notify you.",
  "step3Title": "It goes live in the directory",
  "step3Body": "Your shelter becomes visible to the whole community.",
  "reviewNote": "We especially review the donation link and website to prevent fraud.",
  "noMoneyNote": "SearchPet never collects money: we only link to your own donation page.",
  "emailUnverified": "You need to verify your email before registering a shelter.",
  "verifyEmailLink": "Verify my email",
  "start": "Start",
  "name": "Shelter name",
  "city": "City",
  "phone": "Phone",
  "email": "Contact email",
  "description": "Description",
  "websiteUrl": "Website (https://...)",
  "donationUrl": "Donation link (https://...)",
  "invalidUrl": "The link must start with https://",
  "nameRequired": "Name is required",
  "cityRequired": "City is required",
  "submit": "Submit for review",
  "submitting": "Submitting...",
  "successTitle": "Shelter submitted!",
  "successBody": "Your shelter is under review. We will notify you once it is approved.",
  "goToMine": "See my shelter status"
},
"mine": {
  "title": "My shelter",
  "rejectedTitle": "Your registration was rejected",
  "rejectedReason": "Reason: {{reason}}",
  "resubmitHint": "Fix the data and submit it again.",
  "resubmit": "Save and resubmit",
  "save": "Save changes",
  "saving": "Saving...",
  "saved": "Changes saved",
  "linkReviewWarning": "Changes to the website or donation link go through review. The directory keeps showing the previous link meanwhile.",
  "linkPendingBadge": "Link change under review",
  "approvedTitle": "Your shelter is published",
  "loadError": "We could not load your shelter.",
  "retry": "Retry",
  "noShelterTitle": "You have not registered a shelter yet",
  "registerNow": "Register it now"
}
```

`pt.json` (same structure, replace `"contactCta"`):

```json
"registerCta": "Você é um abrigo e quer aparecer aqui?",
"registerButton": "Registrar meu abrigo",
"register": {
  "title": "Registre seu abrigo",
  "step1Title": "Preencha os dados",
  "step1Body": "Conte sobre seu abrigo: nome, cidade, contato e links.",
  "step2Title": "A equipe revisa",
  "step2Body": "Verificamos os dados e avisamos você com uma notificação.",
  "step3Title": "Entra no diretório",
  "step3Body": "Seu abrigo fica visível para toda a comunidade.",
  "reviewNote": "Revisamos especialmente o link de doações e o site para prevenir fraudes.",
  "noMoneyNote": "O SearchPet nunca arrecada dinheiro: apenas linkamos para a sua própria página de doações.",
  "emailUnverified": "Você precisa verificar seu e-mail antes de registrar um abrigo.",
  "verifyEmailLink": "Verificar meu e-mail",
  "start": "Começar",
  "name": "Nome do abrigo",
  "city": "Cidade",
  "phone": "Telefone",
  "email": "E-mail de contato",
  "description": "Descrição",
  "websiteUrl": "Site (https://...)",
  "donationUrl": "Link de doações (https://...)",
  "invalidUrl": "O link deve começar com https://",
  "nameRequired": "O nome é obrigatório",
  "cityRequired": "A cidade é obrigatória",
  "submit": "Enviar para revisão",
  "submitting": "Enviando...",
  "successTitle": "Abrigo enviado!",
  "successBody": "Seu abrigo está em revisão. Avisamos quando for aprovado.",
  "goToMine": "Ver status do meu abrigo"
},
"mine": {
  "title": "Meu abrigo",
  "rejectedTitle": "Seu registro foi rejeitado",
  "rejectedReason": "Motivo: {{reason}}",
  "resubmitHint": "Corrija os dados e envie novamente.",
  "resubmit": "Salvar e reenviar",
  "save": "Salvar alterações",
  "saving": "Salvando...",
  "saved": "Alterações salvas",
  "linkReviewWarning": "Alterações no site ou no link de doações passam por revisão. O diretório continua mostrando o link anterior enquanto isso.",
  "linkPendingBadge": "Alteração de link em revisão",
  "approvedTitle": "Seu abrigo está publicado",
  "loadError": "Não foi possível carregar seu abrigo.",
  "retry": "Tentar novamente",
  "noShelterTitle": "Você ainda não registrou um abrigo",
  "registerNow": "Registrar agora"
}
```

- [ ] **Step 3: Add the web `admin` keys**

Inside the `"admin"` object of `frontend/packages/web/src/i18n/locales/es.json`: add `"shelters": "Refugios"` to the `"nav"` block, and add a sibling block:

```json
"sheltersQueue": {
  "title": "Refugios pendientes",
  "loading": "Cargando refugios...",
  "error": "No se pudo cargar la cola de refugios.",
  "retry": "Reintentar",
  "empty": "No hay refugios pendientes de revisión.",
  "newRegistration": "Registro nuevo",
  "linkChange": "Cambio de links",
  "website": "Web",
  "donation": "Donaciones",
  "current": "Actual",
  "proposed": "Propuesto",
  "removed": "(se elimina)",
  "approve": "Aprobar",
  "reject": "Rechazar",
  "approveLinks": "Aprobar links",
  "rejectLinks": "Descartar cambio",
  "reasonLabel": "Motivo del rechazo",
  "reasonPlaceholder": "Explicá por qué se rechaza…",
  "confirmReject": "Confirmar rechazo",
  "cancel": "Cancelar",
  "actionError": "No se pudo completar la acción."
}
```

`en.json`: `"shelters": "Shelters"` in `"nav"`, plus:

```json
"sheltersQueue": {
  "title": "Pending shelters",
  "loading": "Loading shelters...",
  "error": "Could not load the shelter queue.",
  "retry": "Retry",
  "empty": "No shelters pending review.",
  "newRegistration": "New registration",
  "linkChange": "Link change",
  "website": "Website",
  "donation": "Donations",
  "current": "Current",
  "proposed": "Proposed",
  "removed": "(removed)",
  "approve": "Approve",
  "reject": "Reject",
  "approveLinks": "Approve links",
  "rejectLinks": "Discard change",
  "reasonLabel": "Rejection reason",
  "reasonPlaceholder": "Explain why it is rejected…",
  "confirmReject": "Confirm rejection",
  "cancel": "Cancel",
  "actionError": "The action could not be completed."
}
```

`pt.json`: `"shelters": "Abrigos"` in `"nav"`, plus:

```json
"sheltersQueue": {
  "title": "Abrigos pendentes",
  "loading": "Carregando abrigos...",
  "error": "Não foi possível carregar a fila de abrigos.",
  "retry": "Tentar novamente",
  "empty": "Nenhum abrigo pendente de revisão.",
  "newRegistration": "Registro novo",
  "linkChange": "Alteração de links",
  "website": "Site",
  "donation": "Doações",
  "current": "Atual",
  "proposed": "Proposto",
  "removed": "(removido)",
  "approve": "Aprovar",
  "reject": "Rejeitar",
  "approveLinks": "Aprovar links",
  "rejectLinks": "Descartar alteração",
  "reasonLabel": "Motivo da rejeição",
  "reasonPlaceholder": "Explique por que está sendo rejeitado…",
  "confirmReject": "Confirmar rejeição",
  "cancel": "Cancelar",
  "actionError": "Não foi possível concluir a ação."
}
```

- [ ] **Step 4: Validate JSON**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/SheltersPage.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS (a JSON syntax error breaks the i18n import and fails every test).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/shared/i18n/locales/es.json frontend/packages/shared/i18n/locales/en.json frontend/packages/shared/i18n/locales/pt.json frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json
git commit -m "feat(i18n): shelter self-registration keys (es/en/pt)"
```

---

### Task 13: Shelters page CTA — "contact us" → register link

**Files:**
- Modify: `frontend/packages/web/src/pages/SheltersPage.tsx` (bottom CTA block, lines 116-120; add `Link` import)
- Modify: `frontend/packages/web/src/pages/SheltersPage.test.tsx` (add `MemoryRouter` + new test)

- [ ] **Step 1: Write the failing test**

In `frontend/packages/web/src/pages/SheltersPage.test.tsx`, wrap the render in `MemoryRouter` (add `import { MemoryRouter } from 'react-router';` and update the wrapper):

```tsx
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
```

and append the test:

```tsx
  it('muestra el CTA de registro apuntando a /shelters/register', () => {
    render(<SheltersPage />, { wrapper });
    const cta = screen.getByText('shelters:registerButton');
    expect(cta.closest('a')?.getAttribute('href')).toBe('/shelters/register');
    expect(screen.queryByText('shelters:contactCta')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/SheltersPage.test.tsx`
Expected: new test FAILS (no `shelters:registerButton` rendered); pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `frontend/packages/web/src/pages/SheltersPage.tsx`, add the import:

```tsx
import { Link } from 'react-router';
```

and replace the bottom block

```tsx
      <div className="text-center mt-10">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          {t('shelters:contactCta')}
        </p>
      </div>
```

with:

```tsx
      <div className="text-center mt-10">
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">{t('shelters:registerCta')}</p>
        <Link
          to="/shelters/register"
          className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-primary-dark transition-colors"
        >
          {t('shelters:registerButton')}
        </Link>
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/SheltersPage.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/SheltersPage.tsx frontend/packages/web/src/pages/SheltersPage.test.tsx
git commit -m "feat(web): shelters page CTA links to self-registration"
```

---

### Task 14: `ShelterSteps` component + `RegisterShelterPage` (step 0 → form → confirmation)

**Files:**
- Create: `frontend/packages/web/src/components/ShelterSteps.tsx`
- Create: `frontend/packages/web/src/pages/RegisterShelterPage.tsx`
- Modify: `frontend/packages/web/src/App.tsx` (import + route inside `<ProtectedRoute>`)
- Test: `frontend/packages/web/src/pages/RegisterShelterPage.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/packages/web/src/pages/RegisterShelterPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterShelterPage } from './RegisterShelterPage';

const mutateMock = vi.fn();
let verificationData: { email_verified: boolean } | undefined = { email_verified: true };
let myShelterData: unknown = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useVerificationStatus: () => ({ data: verificationData }),
  useMyShelter: () => ({ data: myShelterData, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useRegisterShelter: () => ({ mutate: mutateMock, isPending: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'api-error-message',
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RegisterShelterPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('RegisterShelterPage', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    verificationData = { email_verified: true };
    myShelterData = undefined;
  });

  it('shows the 3 process steps and the honest notes on the intro screen', () => {
    renderPage();
    expect(screen.getByText('shelters:register.step1Title')).toBeTruthy();
    expect(screen.getByText('shelters:register.step2Title')).toBeTruthy();
    expect(screen.getByText('shelters:register.step3Title')).toBeTruthy();
    expect(screen.getByText('shelters:register.reviewNote')).toBeTruthy();
    expect(screen.getByText('shelters:register.noMoneyNote')).toBeTruthy();
  });

  it('blocks unverified users with a link to verification instead of the start button', () => {
    verificationData = { email_verified: false };
    renderPage();
    expect(screen.getByText('shelters:register.emailUnverified')).toBeTruthy();
    const verifyLink = screen.getByText('shelters:register.verifyEmailLink');
    expect(verifyLink.closest('a')?.getAttribute('href')).toBe('/profile');
    expect(screen.queryByText('shelters:register.start')).toBeNull();
  });

  it('validates required fields and https URLs before submitting', () => {
    renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.donationUrl'), {
      target: { value: 'http://sin-tls.org' },
    });
    fireEvent.click(screen.getByText('shelters:register.submit'));

    expect(screen.getByText('shelters:register.nameRequired')).toBeTruthy();
    expect(screen.getByText('shelters:register.cityRequired')).toBeTruthy();
    expect(screen.getByText('shelters:register.invalidUrl')).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('submits trimmed data and shows the confirmation on success', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onSuccess?.());
    renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.name'), { target: { value: '  Mi Refugio  ' } });
    fireEvent.change(screen.getByLabelText('shelters:register.city'), { target: { value: 'Montevideo' } });
    fireEvent.change(screen.getByLabelText('shelters:register.donationUrl'), {
      target: { value: 'https://mi.org/donar' },
    });
    fireEvent.click(screen.getByText('shelters:register.submit'));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Mi Refugio', city: 'Montevideo', donation_url: 'https://mi.org/donar' }),
      expect.anything()
    );
    expect(screen.getByText('shelters:register.successTitle')).toBeTruthy();
  });

  it('shows the API error and stays on the form on failure', () => {
    mutateMock.mockImplementation((_data, opts) => opts?.onError?.(new Error('boom')));
    renderPage();
    fireEvent.click(screen.getByText('shelters:register.start'));
    fireEvent.change(screen.getByLabelText('shelters:register.name'), { target: { value: 'Mi Refugio' } });
    fireEvent.change(screen.getByLabelText('shelters:register.city'), { target: { value: 'Montevideo' } });
    fireEvent.click(screen.getByText('shelters:register.submit'));

    expect(screen.getByText('api-error-message')).toBeTruthy();
    expect(screen.queryByText('shelters:register.successTitle')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/RegisterShelterPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ShelterSteps`**

Create `frontend/packages/web/src/components/ShelterSteps.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

export type ShelterStepKey = 'data' | 'review' | 'live';

const STEPS: { key: ShelterStepKey; titleKey: string; bodyKey: string }[] = [
  { key: 'data', titleKey: 'shelters:register.step1Title', bodyKey: 'shelters:register.step1Body' },
  { key: 'review', titleKey: 'shelters:register.step2Title', bodyKey: 'shelters:register.step2Body' },
  { key: 'live', titleKey: 'shelters:register.step3Title', bodyKey: 'shelters:register.step3Body' },
];

// ShelterSteps renders the 3-step publication path. With `active` it works as a
// status stepper (MyShelterPage); without it, as the neutral "how it works"
// list (RegisterShelterPage step 0). Same steps in both places by design.
export function ShelterSteps({ active }: { active?: ShelterStepKey }) {
  const { t } = useTranslation(['shelters']);

  return (
    <ol className="space-y-3">
      {STEPS.map((step, i) => {
        const isActive = active === step.key;
        return (
          <li
            key={step.key}
            className={`flex gap-3 rounded-xl border p-4 ${
              isActive
                ? 'border-primary bg-orange-50 dark:bg-orange-950'
                : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
            }`}
          >
            <span
              className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold ${
                isActive ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}
            >
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{t(step.titleKey)}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t(step.bodyKey)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Implement `RegisterShelterPage`**

Create `frontend/packages/web/src/pages/RegisterShelterPage.tsx`:

```tsx
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyShelter, useRegisterShelter, useVerificationStatus } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ShelterSteps } from '../components/ShelterSteps';

const HTTPS_RE = /^https:\/\/.+/;

type FormState = {
  name: string;
  city: string;
  phone: string;
  email: string;
  description: string;
  website_url: string;
  donation_url: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  city: '',
  phone: '',
  email: '',
  description: '',
  website_url: '',
  donation_url: '',
};

export function RegisterShelterPage() {
  const { t } = useTranslation(['shelters', 'errors', 'common']);
  const [step, setStep] = useState<'intro' | 'form' | 'done'>('intro');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const { data: verification } = useVerificationStatus();
  const { data: myShelter } = useMyShelter();
  const registerShelter = useRegisterShelter();

  // Ya tiene refugio → esta página no aplica. GOTCHA: tras un submit exitoso la
  // invalidación repuebla useMyShelter — sin el guard de 'done' el redirect se
  // comería la pantalla de confirmación.
  if (myShelter && step !== 'done') {
    return <Navigate to="/shelters/mine" replace />;
  }

  const emailVerified = verification?.email_verified ?? false;

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errs.name = t('shelters:register.nameRequired');
    if (!form.city.trim()) errs.city = t('shelters:register.cityRequired');
    if (form.website_url && !HTTPS_RE.test(form.website_url)) errs.website_url = t('shelters:register.invalidUrl');
    if (form.donation_url && !HTTPS_RE.test(form.donation_url)) errs.donation_url = t('shelters:register.invalidUrl');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setApiError(null);
    registerShelter.mutate(
      {
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        description: form.description.trim(),
        website_url: form.website_url.trim(),
        donation_url: form.donation_url.trim(),
      },
      {
        onSuccess: () => setStep('done'),
        onError: (err) => setApiError(getErrorMessage(err, t)),
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        {t('shelters:register.title')}
      </h1>

      {step === 'intro' && (
        <div>
          <ShelterSteps />
          <div className="mt-6 space-y-2 text-sm text-gray-500 dark:text-gray-400">
            <p>{t('shelters:register.reviewNote')}</p>
            <p>{t('shelters:register.noMoneyNote')}</p>
          </div>
          {emailVerified ? (
            <button
              type="button"
              onClick={() => setStep('form')}
              className="mt-6 w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors"
            >
              {t('shelters:register.start')}
            </button>
          ) : (
            <div className="mt-6 rounded-xl border border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950 p-4 text-center">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                {t('shelters:register.emailUnverified')}
              </p>
              <Link to="/profile" className="text-sm font-semibold text-primary hover:underline">
                {t('shelters:register.verifyEmailLink')}
              </Link>
            </div>
          )}
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field id="shelter-name" label={t('shelters:register.name')} value={form.name} onChange={setField('name')} error={fieldErrors.name} />
          <Field id="shelter-city" label={t('shelters:register.city')} value={form.city} onChange={setField('city')} error={fieldErrors.city} />
          <Field id="shelter-phone" label={t('shelters:register.phone')} value={form.phone} onChange={setField('phone')} />
          <Field id="shelter-email" label={t('shelters:register.email')} value={form.email} onChange={setField('email')} type="email" />
          <div>
            <label htmlFor="shelter-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('shelters:register.description')}
            </label>
            <textarea
              id="shelter-description"
              value={form.description}
              onChange={setField('description')}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <Field id="shelter-website" label={t('shelters:register.websiteUrl')} value={form.website_url} onChange={setField('website_url')} error={fieldErrors.website_url} />
          <Field id="shelter-donation" label={t('shelters:register.donationUrl')} value={form.donation_url} onChange={setField('donation_url')} error={fieldErrors.donation_url} />

          {apiError && <p className="text-sm text-red-600">{apiError}</p>}

          <button
            type="submit"
            disabled={registerShelter.isPending}
            className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {registerShelter.isPending ? t('shelters:register.submitting') : t('shelters:register.submit')}
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="text-center py-8">
          <p className="text-4xl mb-4">🏠</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t('shelters:register.successTitle')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('shelters:register.successBody')}</p>
          <Link
            to="/shelters/mine"
            className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
          >
            {t('shelters:register.goToMine')}
          </Link>
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Register the route**

In `frontend/packages/web/src/App.tsx`, add the import:

```tsx
import { RegisterShelterPage } from './pages/RegisterShelterPage';
```

and inside the `<Route element={<ProtectedRoute />}>` block (after the `/alerts` route):

```tsx
            <Route path="/shelters/register" element={<RegisterShelterPage />} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/RegisterShelterPage.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/web/src/components/ShelterSteps.tsx frontend/packages/web/src/pages/RegisterShelterPage.tsx frontend/packages/web/src/pages/RegisterShelterPage.test.tsx frontend/packages/web/src/App.tsx
git commit -m "feat(web): shelter registration page with process steps and confirmation"
```

---

### Task 15: `MyShelterPage` — status stepper, resubmit, staged-link edit

**Files:**
- Create: `frontend/packages/web/src/pages/MyShelterPage.tsx`
- Modify: `frontend/packages/web/src/App.tsx` (import + route inside `<ProtectedRoute>`)
- Test: `frontend/packages/web/src/pages/MyShelterPage.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/packages/web/src/pages/MyShelterPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyShelterPage } from './MyShelterPage';

const mutateMock = vi.fn();
const refetchMock = vi.fn();

type HookState = {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  error: { code?: string } | null;
};
let myShelterState: HookState = { data: undefined, isLoading: false, isError: false, error: null };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/hooks', () => ({
  useMyShelter: () => ({ ...myShelterState, refetch: refetchMock }),
  useUpdateMyShelter: () => ({ mutate: mutateMock, isPending: false }),
}));

vi.mock('@shared/utils/apiErrors', () => ({
  getErrorMessage: () => 'api-error-message',
}));

const baseShelter = {
  id: 's1',
  name: 'Mi Refugio',
  city: 'Montevideo',
  phone: '099123456',
  email: 'refugio@test.org',
  description: 'Refugio de prueba',
  website_url: 'https://refugio.org',
  donation_url: 'https://refugio.org/donar',
  is_verified: false,
  created_at: '2026-07-12T00:00:00Z',
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyShelterPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MyShelterPage', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    refetchMock.mockReset();
    myShelterState = { data: undefined, isLoading: false, isError: false, error: null };
  });

  it('pending: highlights the review step', () => {
    myShelterState.data = { ...baseShelter, status: 'pending' };
    renderPage();
    expect(screen.getByText('shelters:register.step2Title')).toBeTruthy();
    expect(screen.queryByText('shelters:mine.rejectedTitle')).toBeNull();
  });

  it('rejected: shows the admin reason and the resubmit button', () => {
    myShelterState.data = { ...baseShelter, status: 'rejected', rejection_reason: 'link roto' };
    renderPage();
    expect(screen.getByText('shelters:mine.rejectedTitle')).toBeTruthy();
    expect(screen.getByText('shelters:mine.rejectedReason')).toBeTruthy();
    expect(screen.getByText('shelters:mine.resubmit')).toBeTruthy();
  });

  it('approved: shows the link-review warning and the pending-link badge', () => {
    myShelterState.data = {
      ...baseShelter,
      status: 'approved',
      pending_donation_url: 'https://nuevo.org/donar',
    };
    renderPage();
    expect(screen.getByText('shelters:mine.approvedTitle')).toBeTruthy();
    expect(screen.getByText('shelters:mine.linkReviewWarning')).toBeTruthy();
    expect(screen.getByText('shelters:mine.linkPendingBadge')).toBeTruthy();
  });

  it('approved: badge also shows for a staged CLEAR (empty string, not undefined)', () => {
    myShelterState.data = { ...baseShelter, status: 'approved', pending_website_url: '' };
    renderPage();
    expect(screen.getByText('shelters:mine.linkPendingBadge')).toBeTruthy();
  });

  it('saving sends every field including explicit empty strings (rule #22)', () => {
    myShelterState.data = { ...baseShelter, status: 'approved' };
    renderPage();
    fireEvent.change(screen.getByLabelText('shelters:register.phone'), { target: { value: '' } });
    fireEvent.click(screen.getByText('shelters:mine.save'));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '', name: 'Mi Refugio' }),
      expect.anything()
    );
  });

  it('no shelter yet (shelter_not_found): shows the register link, not an error', () => {
    myShelterState = { data: undefined, isLoading: false, isError: true, error: { code: 'shelter_not_found' } };
    renderPage();
    expect(screen.getByText('shelters:mine.noShelterTitle')).toBeTruthy();
    const link = screen.getByText('shelters:mine.registerNow');
    expect(link.closest('a')?.getAttribute('href')).toBe('/shelters/register');
  });

  it('fetch failure: shows a distinct error state with retry (never an empty state)', () => {
    myShelterState = { data: undefined, isLoading: false, isError: true, error: { code: 'internal_error' } };
    renderPage();
    expect(screen.getByText('shelters:mine.loadError')).toBeTruthy();
    fireEvent.click(screen.getByText('shelters:mine.retry'));
    expect(refetchMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/MyShelterPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the page**

Create `frontend/packages/web/src/pages/MyShelterPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMyShelter, useUpdateMyShelter } from '@shared/hooks';
import { getErrorMessage } from '@shared/utils/apiErrors';
import { ShelterSteps, type ShelterStepKey } from '../components/ShelterSteps';
import type { MyShelter } from '@shared/types';

const HTTPS_RE = /^https:\/\/.+/;

type FormState = {
  name: string;
  city: string;
  phone: string;
  email: string;
  description: string;
  website_url: string;
  donation_url: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  city: '',
  phone: '',
  email: '',
  description: '',
  website_url: '',
  donation_url: '',
};

// Estado → paso activo del stepper: rejected vuelve a "datos" (hay que corregir),
// pending resalta "revisión", approved resalta "publicado".
const STEP_BY_STATUS: Record<MyShelter['status'], ShelterStepKey> = {
  rejected: 'data',
  pending: 'review',
  approved: 'live',
};

export function MyShelterPage() {
  const { t } = useTranslation(['shelters', 'errors', 'common']);
  const { data: shelter, isLoading, isError, error, refetch } = useMyShelter();
  const updateShelter = useUpdateMyShelter();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (shelter) {
      setForm({
        name: shelter.name,
        city: shelter.city,
        phone: shelter.phone ?? '',
        email: shelter.email ?? '',
        description: shelter.description ?? '',
        website_url: shelter.website_url ?? '',
        donation_url: shelter.donation_url ?? '',
      });
    }
  }, [shelter]);

  const setField = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  // 404 shelter_not_found = todavía no registró — NO es un error (PR #82 pattern:
  // estados distintos para "vacío esperado" y "falló el fetch").
  if (isError && (error as { code?: string } | null)?.code === 'shelter_not_found') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {t('shelters:mine.noShelterTitle')}
        </h1>
        <Link
          to="/shelters/register"
          className="inline-block bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-primary-dark transition-colors"
        >
          {t('shelters:mine.registerNow')}
        </Link>
      </div>
    );
  }

  if (isError || !shelter) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-red-500 dark:text-red-400 mb-4">{t('shelters:mine.loadError')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-semibold text-primary border border-primary px-4 py-2 rounded-lg hover:bg-primary/5"
        >
          {t('shelters:mine.retry')}
        </button>
      </div>
    );
  }

  const hasStagedLink = shelter.pending_donation_url !== undefined || shelter.pending_website_url !== undefined;
  const isApproved = shelter.status === 'approved';
  const isRejected = shelter.status === 'rejected';

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errs.name = t('shelters:register.nameRequired');
    if (!form.city.trim()) errs.city = t('shelters:register.cityRequired');
    if (form.website_url && !HTTPS_RE.test(form.website_url)) errs.website_url = t('shelters:register.invalidUrl');
    if (form.donation_url && !HTTPS_RE.test(form.donation_url)) errs.donation_url = t('shelters:register.invalidUrl');
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setApiError(null);
    // Regla #22: mandamos TODOS los campos, incluso "" (vaciar). El backend
    // distingue nil (no enviado) de "" (limpiar) con punteros.
    updateShelter.mutate(
      {
        name: form.name.trim(),
        city: form.city.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        description: form.description.trim(),
        website_url: form.website_url.trim(),
        donation_url: form.donation_url.trim(),
      },
      {
        onSuccess: () => setSaved(true),
        onError: (err) => setApiError(getErrorMessage(err, t)),
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">{t('shelters:mine.title')}</h1>

      <ShelterSteps active={STEP_BY_STATUS[shelter.status]} />

      {isApproved && (
        <p className="mt-4 text-sm font-semibold text-green-600 dark:text-green-400">
          {t('shelters:mine.approvedTitle')}
        </p>
      )}

      {isRejected && (
        <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-4">
          <p className="font-semibold text-red-700 dark:text-red-300">{t('shelters:mine.rejectedTitle')}</p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">
            {t('shelters:mine.rejectedReason', { reason: shelter.rejection_reason })}
          </p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{t('shelters:mine.resubmitHint')}</p>
        </div>
      )}

      {isApproved && hasStagedLink && (
        <span className="inline-block mt-4 text-xs font-semibold text-yellow-800 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-900 rounded-full px-3 py-1">
          {t('shelters:mine.linkPendingBadge')}
        </span>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <EditField id="mine-name" label={t('shelters:register.name')} value={form.name} onChange={setField('name')} error={fieldErrors.name} />
        <EditField id="mine-city" label={t('shelters:register.city')} value={form.city} onChange={setField('city')} error={fieldErrors.city} />
        <EditField id="mine-phone" label={t('shelters:register.phone')} value={form.phone} onChange={setField('phone')} />
        <EditField id="mine-email" label={t('shelters:register.email')} value={form.email} onChange={setField('email')} type="email" />
        <div>
          <label htmlFor="mine-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('shelters:register.description')}
          </label>
          <textarea
            id="mine-description"
            value={form.description}
            onChange={setField('description')}
            rows={4}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {isApproved && (
          <p className="text-sm text-yellow-800 dark:text-yellow-200 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-900 rounded-xl p-3">
            {t('shelters:mine.linkReviewWarning')}
          </p>
        )}
        <EditField id="mine-website" label={t('shelters:register.websiteUrl')} value={form.website_url} onChange={setField('website_url')} error={fieldErrors.website_url} />
        <EditField id="mine-donation" label={t('shelters:register.donationUrl')} value={form.donation_url} onChange={setField('donation_url')} error={fieldErrors.donation_url} />

        {apiError && <p className="text-sm text-red-600">{apiError}</p>}
        {saved && <p role="status" className="text-sm text-green-600 dark:text-green-400">{t('shelters:mine.saved')}</p>}

        <button
          type="submit"
          disabled={updateShelter.isPending}
          className="w-full bg-primary text-white font-semibold py-3 rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {updateShelter.isPending
            ? t('shelters:mine.saving')
            : isRejected
              ? t('shelters:mine.resubmit')
              : t('shelters:mine.save')}
        </button>
      </form>
    </div>
  );
}

function EditField({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
```

NOTE: the i18n mock in tests returns the KEY for `t('shelters:mine.rejectedReason', {...})`, so the test asserts the key text — with the real i18n it interpolates `{{reason}}`.

- [ ] **Step 4: Register the route**

In `frontend/packages/web/src/App.tsx`, add the import:

```tsx
import { MyShelterPage } from './pages/MyShelterPage';
```

and inside the `<Route element={<ProtectedRoute />}>` block (right after the `/shelters/register` route from Task 14):

```tsx
            <Route path="/shelters/mine" element={<MyShelterPage />} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/MyShelterPage.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/MyShelterPage.tsx frontend/packages/web/src/pages/MyShelterPage.test.tsx frontend/packages/web/src/App.tsx
git commit -m "feat(web): my-shelter page with status stepper, resubmit and staged-link edit"
```

---

### Task 16: Admin "Shelters" queue page

**Files:**
- Create: `frontend/packages/web/src/pages/admin/SheltersAdminPage.tsx`
- Modify: `frontend/packages/web/src/pages/admin/AdminLayout.tsx` (navLinks array, lines 4-9)
- Modify: `frontend/packages/web/src/App.tsx` (import + route inside the `/admin` layout)
- Test: `frontend/packages/web/src/pages/admin/SheltersAdminPage.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/packages/web/src/pages/admin/SheltersAdminPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import { SheltersAdminPage } from './SheltersAdminPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

vi.mock('@shared/api/client', () => ({
  apiClient: {
    getPendingShelters: vi.fn(),
    approveShelter: vi.fn(),
    rejectShelter: vi.fn(),
    approveShelterLinks: vi.fn(),
    rejectShelterLinks: vi.fn(),
  },
}));

const mockedApi = vi.mocked(apiClient);

const pendingShelter = {
  id: 'sh-1',
  name: 'Refugio Nuevo',
  city: 'Montevideo',
  phone: '099123456',
  email: 'nuevo@test.org',
  website_url: 'https://nuevo.org',
  donation_url: 'https://nuevo.org/donar',
  description: 'Un refugio nuevo',
  is_verified: false,
  created_at: '2026-07-12T00:00:00Z',
  status: 'pending' as const,
  owner_user_id: 'u-1',
};

const linkChangeShelter = {
  ...pendingShelter,
  id: 'sh-2',
  name: 'Refugio Con Cambio',
  status: 'approved' as const,
  pending_donation_url: 'https://cambiado.org/donar',
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SheltersAdminPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SheltersAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getPendingShelters.mockResolvedValue([pendingShelter, linkChangeShelter]);
    mockedApi.approveShelter.mockResolvedValue({ ...pendingShelter, status: 'approved' });
    mockedApi.rejectShelter.mockResolvedValue({ ...pendingShelter, status: 'rejected' });
    mockedApi.approveShelterLinks.mockResolvedValue(linkChangeShelter);
    mockedApi.rejectShelterLinks.mockResolvedValue(linkChangeShelter);
  });

  it('renders both card kinds: new registration and link change with old → new diff', async () => {
    renderPage();
    expect(await screen.findByText('Refugio Nuevo')).toBeTruthy();
    expect(screen.getByText('Refugio Con Cambio')).toBeTruthy();
    expect(screen.getByText('admin:sheltersQueue.newRegistration')).toBeTruthy();
    expect(screen.getByText('admin:sheltersQueue.linkChange')).toBeTruthy();
    // Link diff shows current AND proposed donation URLs.
    expect(screen.getByText('https://nuevo.org/donar')).toBeTruthy();
    expect(screen.getByText('https://cambiado.org/donar')).toBeTruthy();
  });

  it('approve calls the API', async () => {
    renderPage();
    await screen.findByText('Refugio Nuevo');
    fireEvent.click(screen.getByText('admin:sheltersQueue.approve'));
    expect(mockedApi.approveShelter).toHaveBeenCalledWith('sh-1');
  });

  it('reject requires a reason before confirming', async () => {
    renderPage();
    await screen.findByText('Refugio Nuevo');
    fireEvent.click(screen.getByText('admin:sheltersQueue.reject'));

    const confirm = screen.getByText('admin:sheltersQueue.confirmReject') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(mockedApi.rejectShelter).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('admin:sheltersQueue.reasonLabel'), {
      target: { value: 'link de donación sospechoso' },
    });
    fireEvent.click(screen.getByText('admin:sheltersQueue.confirmReject'));
    expect(mockedApi.rejectShelter).toHaveBeenCalledWith('sh-1', 'link de donación sospechoso');
  });

  it('link-change cards approve/discard the staged links', async () => {
    renderPage();
    await screen.findByText('Refugio Con Cambio');
    fireEvent.click(screen.getByText('admin:sheltersQueue.approveLinks'));
    expect(mockedApi.approveShelterLinks).toHaveBeenCalledWith('sh-2');
    fireEvent.click(screen.getByText('admin:sheltersQueue.rejectLinks'));
    expect(mockedApi.rejectShelterLinks).toHaveBeenCalledWith('sh-2');
  });

  it('shows the empty state when the queue is clear', async () => {
    mockedApi.getPendingShelters.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('admin:sheltersQueue.empty')).toBeTruthy();
  });

  it('shows an error state with retry on fetch failure (never an empty state)', async () => {
    mockedApi.getPendingShelters.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('admin:sheltersQueue.error')).toBeTruthy();
    expect(screen.getByText('admin:sheltersQueue.retry')).toBeTruthy();
    expect(screen.queryByText('admin:sheltersQueue.empty')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/admin/SheltersAdminPage.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the page**

Create `frontend/packages/web/src/pages/admin/SheltersAdminPage.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@shared/api/client';
import type { AdminShelter } from '@shared/types';

export function SheltersAdminPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();

  const { data: shelters, isLoading, isError, refetch } = useQuery({
    queryKey: ['adminShelters', 'pending'],
    queryFn: () => apiClient.getPendingShelters(),
  });

  const [rejecting, setRejecting] = useState<AdminShelter | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => {
    setActionError(null);
    queryClient.invalidateQueries({ queryKey: ['adminShelters'] });
    queryClient.invalidateQueries({ queryKey: ['shelters'] });
  };
  const onError = () => setActionError(t('sheltersQueue.actionError'));

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiClient.approveShelter(id),
    onSuccess: invalidate,
    onError,
  });
  const rejectMutation = useMutation({
    mutationFn: (vars: { id: string; reason: string }) => apiClient.rejectShelter(vars.id, vars.reason),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      invalidate();
    },
    onError,
  });
  const approveLinksMutation = useMutation({
    mutationFn: (id: string) => apiClient.approveShelterLinks(id),
    onSuccess: invalidate,
    onError,
  });
  const rejectLinksMutation = useMutation({
    mutationFn: (id: string) => apiClient.rejectShelterLinks(id),
    onSuccess: invalidate,
    onError,
  });

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{t('sheltersQueue.loading')}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 dark:text-red-400 mb-4">{t('sheltersQueue.error')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-semibold text-primary border border-primary px-4 py-2 rounded-lg hover:bg-primary/5"
        >
          {t('sheltersQueue.retry')}
        </button>
      </div>
    );
  }

  const queue = shelters ?? [];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">{t('sheltersQueue.title')}</h2>

      {actionError && <p className="text-sm text-red-600 mb-4">{actionError}</p>}

      {queue.length === 0 ? (
        <p className="text-gray-400 dark:text-gray-500 py-8 text-center">{t('sheltersQueue.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {queue.map((shelter) => {
            const isLinkChange = shelter.status === 'approved';
            return (
              <li
                key={shelter.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{shelter.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">📍 {shelter.city}</p>
                  </div>
                  <span
                    className={`text-xs font-semibold rounded-full px-3 py-1 ${
                      isLinkChange
                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                        : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                    }`}
                  >
                    {isLinkChange ? t('sheltersQueue.linkChange') : t('sheltersQueue.newRegistration')}
                  </span>
                </div>

                {shelter.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{shelter.description}</p>
                )}
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-2 space-y-1">
                  {shelter.phone && <p>📱 {shelter.phone}</p>}
                  {shelter.email && <p>✉️ {shelter.email}</p>}
                </div>

                {isLinkChange ? (
                  <div className="mt-3 space-y-2">
                    {shelter.pending_website_url !== undefined && (
                      <LinkDiff
                        label={t('sheltersQueue.website')}
                        current={shelter.website_url}
                        proposed={shelter.pending_website_url}
                        currentLabel={t('sheltersQueue.current')}
                        proposedLabel={t('sheltersQueue.proposed')}
                        removedLabel={t('sheltersQueue.removed')}
                      />
                    )}
                    {shelter.pending_donation_url !== undefined && (
                      <LinkDiff
                        label={t('sheltersQueue.donation')}
                        current={shelter.donation_url}
                        proposed={shelter.pending_donation_url}
                        currentLabel={t('sheltersQueue.current')}
                        proposedLabel={t('sheltersQueue.proposed')}
                        removedLabel={t('sheltersQueue.removed')}
                      />
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-1 text-sm">
                    {shelter.website_url && (
                      <p>
                        {t('sheltersQueue.website')}:{' '}
                        <a href={shelter.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                          {shelter.website_url}
                        </a>
                      </p>
                    )}
                    {shelter.donation_url && (
                      <p>
                        {t('sheltersQueue.donation')}:{' '}
                        <a href={shelter.donation_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                          {shelter.donation_url}
                        </a>
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  {isLinkChange ? (
                    <>
                      <button
                        type="button"
                        onClick={() => approveLinksMutation.mutate(shelter.id)}
                        className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                      >
                        {t('sheltersQueue.approveLinks')}
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectLinksMutation.mutate(shelter.id)}
                        className="text-sm font-semibold text-red-600 border border-red-600 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        {t('sheltersQueue.rejectLinks')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate(shelter.id)}
                        className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                      >
                        {t('sheltersQueue.approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejecting(shelter)}
                        className="text-sm font-semibold text-red-600 border border-red-600 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      >
                        {t('sheltersQueue.reject')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rejecting && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
              {t('sheltersQueue.reject')} — {rejecting.name}
            </h3>
            <label htmlFor="reject-reason" className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              {t('sheltersQueue.reasonLabel')}
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('sheltersQueue.reasonPlaceholder')}
              rows={4}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setRejecting(null);
                  setReason('');
                }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300"
              >
                {t('sheltersQueue.cancel')}
              </button>
              <button
                type="button"
                disabled={!reason.trim() || rejectMutation.isPending}
                onClick={() => rejectMutation.mutate({ id: rejecting.id, reason: reason.trim() })}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {t('sheltersQueue.confirmReject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// LinkDiff shows current → proposed for one staged link. proposed === ''
// means a staged CLEAR (the *string omitempty gotcha — '' is present, undefined is absent).
function LinkDiff({
  label,
  current,
  proposed,
  currentLabel,
  proposedLabel,
  removedLabel,
}: {
  label: string;
  current?: string;
  proposed: string;
  currentLabel: string;
  proposedLabel: string;
  removedLabel: string;
}) {
  return (
    <div className="text-sm rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
      <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{label}</p>
      <p className="text-gray-500 dark:text-gray-400">
        {currentLabel}:{' '}
        {current ? (
          <a href={current} target="_blank" rel="noopener noreferrer" className="line-through break-all hover:underline">
            {current}
          </a>
        ) : (
          '—'
        )}
      </p>
      <p className="text-gray-900 dark:text-gray-100">
        {proposedLabel}:{' '}
        {proposed ? (
          <a href={proposed} target="_blank" rel="noopener noreferrer" className="text-primary break-all hover:underline">
            {proposed}
          </a>
        ) : (
          removedLabel
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Register nav link and route**

In `frontend/packages/web/src/pages/admin/AdminLayout.tsx`, append to `navLinks`:

```tsx
  { to: '/admin/shelters', labelKey: 'nav.shelters' },
```

In `frontend/packages/web/src/App.tsx`, add the import:

```tsx
import { SheltersAdminPage } from './pages/admin/SheltersAdminPage';
```

and inside the `/admin` layout route (after the `admins` route):

```tsx
              <Route path="shelters" element={<SheltersAdminPage />} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/packages/web && pnpm vitest run src/pages/admin/SheltersAdminPage.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/admin/SheltersAdminPage.tsx frontend/packages/web/src/pages/admin/SheltersAdminPage.test.tsx frontend/packages/web/src/pages/admin/AdminLayout.tsx frontend/packages/web/src/App.tsx
git commit -m "feat(web): admin shelters approval queue with link-change diff"
```

---

### Task 17: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Backend full suite (WITH the test DB)**

Run: `cd backend && go build ./... && DATABASE_URL='postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable' go test ./tests/ -count=1 2>&1 | tail -5 && go test ./internal/... ./pkg/... -count=1 2>&1 | tail -10`
Expected: `ok  lost-pets/tests` + every internal/pkg package `ok`. REMINDER: without `DATABASE_URL` the integration tests skip silently — the `ok` would be a lie.

- [ ] **Step 2: Web full suite + typecheck + build**

Run: `cd frontend/packages/web && pnpm exec tsc --noEmit && pnpm test:run && pnpm build`
Expected: all green (`test:run` chains web + shared vitest configs).

- [ ] **Step 3: Manual smoke (local)**

Per the local-run-setup notes: DB on host port 5433, `make backend`, `make web`, seeded users (`admin@searchpet.local`/`admin1234` for the admin side). Flow to verify by hand:
1. `/shelters` shows the 7 seeded shelters (grandfathered `approved`) and the new "Register my shelter" CTA.
2. Logged out → CTA leads to login (ProtectedRoute). Logged in with UNVERIFIED email → step 0 shows the verification notice linking to `/profile`, no form access.
3. Verify the email (OTP via profile), register a shelter with an `http://` donation link → inline validation blocks; fix to `https://` → submit → confirmation screen → `/shelters/mine` shows the stepper on "under review". The shelter does NOT appear in `/shelters`.
4. As admin, `/admin/shelters` shows the queue card with clickable links; reject with a reason → owner's `/shelters/mine` shows the reason; edit + save → back to pending (resubmitted); approve → owner gets the push (if FCM configured), shelter appears in `/shelters`.
5. As owner (now approved), change the donation link → warning shown, badge "link change under review" appears, `/shelters` still shows the OLD link. As admin, the queue shows the old → new diff; approve links → `/shelters` shows the new link; the badge disappears.
6. `POST /api/shelters` again as the same user → 409 `shelter_already_owned` (localized message).
7. Existing admin flows untouched: create a shelter from `POST /api/admin/shelters` (e.g. via curl) → appears in `/shelters` immediately (born approved, no owner).
8. Re-seed the dev DB if `go test` ran against it.

- [ ] **Step 4: Final commit (if fixups were needed) and stop**

Do NOT push or open a PR — that is a separate explicit step (searchpet-pr skill) after review.
