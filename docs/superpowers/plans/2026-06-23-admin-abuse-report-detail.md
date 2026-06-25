# Admin Abuse Report Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the admin abuse-reports view so it shows the reporter's name and the reported target's name as links, instead of raw truncated UUIDs.

**Architecture:** Add GORM associations to `ReportAbuse` (`Reporter`, `TargetUser`, `TargetReport`→`Pet`), preload them in the repository, map them into nested DTO refs (alongside the existing flat IDs, additively), expose them in the shared TS type, and render names/links in the web admin page with graceful fallback to truncated IDs.

**Tech Stack:** Go 1.25 + Gin + GORM (backend), React + Vite + React Router + Vitest (web), TypeScript shared types.

---

## File Structure

- `backend/internal/domain/models.go` — add 3 associations to `ReportAbuse`.
- `backend/internal/dto/abuse_report_dto.go` — new ref types + nested mapping.
- `backend/tests/abuse_report_dto_test.go` — NEW: pure DTO mapping test (no DB).
- `backend/internal/repository/abuse_report_repository.go` — preloads in `GetAll`/`GetByID`.
- `backend/tests/abuse_report_repository_test.go` — add preload tests (DB).
- `frontend/packages/shared/types/index.ts` — extend `AbuseReport`.
- `frontend/packages/web/src/pages/admin/AbuseReportsPage.tsx` — reporter column + enriched target.
- `frontend/packages/web/src/pages/admin/AbuseReportsPage.test.tsx` — NEW: render tests.

## Test DB note (backend repo test only)

The repository test needs the Postgres test DB (docker container `lostpets-db`, host
port 5433, database `lostpets_test`, with postgis + vector). Start it if needed:
`docker start lostpets-db`. Run backend tests with:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/...
```

`testdb.SetupTestDB` SKIPS without `DATABASE_URL` and TRUNCATES all tables — only ever
use `lostpets_test`. The DTO unit test (Task 1) needs NO DB.

---

### Task 1: Backend model associations + DTO enriched refs

**Files:**
- Modify: `backend/internal/domain/models.go`
- Modify: `backend/internal/dto/abuse_report_dto.go`
- Test: `backend/tests/abuse_report_dto_test.go` (create)

- [ ] **Step 1: Add associations to the model.** In `backend/internal/domain/models.go`, inside the `ReportAbuse` struct, after the `CreatedAt` field, add:

```go
	// Associations (admin enrichment) — not serialized raw; exposed via DTO refs.
	Reporter     User    `gorm:"foreignKey:ReporterID" json:"-"`
	TargetUser   *User   `gorm:"foreignKey:TargetUserID" json:"-"`
	TargetReport *Report `gorm:"foreignKey:TargetReportID" json:"-"`
```

- [ ] **Step 2: Write the failing DTO test.** Create `backend/tests/abuse_report_dto_test.go`:

```go
package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

func TestToAbuseReportResponse_EnrichedUserRefs(t *testing.T) {
	reporterID := uuid.New()
	targetUserID := uuid.New()
	r := &domain.ReportAbuse{
		ID:           uuid.New(),
		ReporterID:   reporterID,
		TargetUserID: &targetUserID,
		Reason:       "spam",
		Status:       "pending",
		Reporter:     domain.User{ID: reporterID, Name: "Alice"},
		TargetUser:   &domain.User{ID: targetUserID, Name: "Bob"},
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.Reporter == nil || resp.Reporter.Name != "Alice" || resp.Reporter.ID != reporterID {
		t.Errorf("want reporter Alice/%s, got %+v", reporterID, resp.Reporter)
	}
	if resp.TargetUser == nil || resp.TargetUser.Name != "Bob" {
		t.Errorf("want target_user Bob, got %+v", resp.TargetUser)
	}
	if resp.TargetReport != nil {
		t.Errorf("want nil target_report for a user-target report, got %+v", resp.TargetReport)
	}
}

func TestToAbuseReportResponse_EnrichedReportRef(t *testing.T) {
	reportID := uuid.New()
	petID := uuid.New()
	r := &domain.ReportAbuse{
		ID:             uuid.New(),
		ReporterID:     uuid.New(),
		TargetReportID: &reportID,
		Reason:         "fake",
		Status:         "pending",
		TargetReport: &domain.Report{
			ID:    reportID,
			PetID: petID,
			Pet:   domain.Pet{ID: petID, Name: "Toby"},
		},
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.TargetReport == nil {
		t.Fatal("want target_report, got nil")
	}
	if resp.TargetReport.PetName != "Toby" || resp.TargetReport.PetID != petID || resp.TargetReport.ID != reportID {
		t.Errorf("want report ref Toby/%s/%s, got %+v", petID, reportID, resp.TargetReport)
	}
}

func TestToAbuseReportResponse_OmitsUnloadedAssociations(t *testing.T) {
	targetUserID := uuid.New()
	r := &domain.ReportAbuse{
		ID:           uuid.New(),
		ReporterID:   uuid.New(), // Reporter association left zero-value (e.g. deleted)
		TargetUserID: &targetUserID,
		Reason:       "other",
		Status:       "pending",
		// Reporter zero, TargetUser nil, TargetReport nil
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.Reporter != nil {
		t.Errorf("want nil reporter when association not loaded, got %+v", resp.Reporter)
	}
	if resp.TargetUser != nil {
		t.Errorf("want nil target_user when association not loaded, got %+v", resp.TargetUser)
	}
}
```

- [ ] **Step 3: Run test to verify it FAILS.** From `backend/`:
`go test ./tests/ -run TestToAbuseReportResponse -v`
Expected: COMPILE FAIL — `resp.Reporter undefined` (and the ref types don't exist).

- [ ] **Step 4: Add ref types + nested mapping.** In `backend/internal/dto/abuse_report_dto.go`:

Add the ref types (after the imports, before `CreateAbuseReportRequest`):

```go
// AbuseUserRef is a minimal user reference for admin enrichment.
type AbuseUserRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// AbuseTargetReportRef is a minimal report reference (with its pet) for admin enrichment.
type AbuseTargetReportRef struct {
	ID      uuid.UUID `json:"id"`
	PetID   uuid.UUID `json:"pet_id"`
	PetName string    `json:"pet_name"`
}
```

Add these fields to the `AbuseReportResponse` struct (after `CreatedAt`):

```go
	Reporter     *AbuseUserRef         `json:"reporter,omitempty"`
	TargetUser   *AbuseUserRef         `json:"target_user,omitempty"`
	TargetReport *AbuseTargetReportRef `json:"target_report,omitempty"`
```

Extend `ToAbuseReportResponse` — before `return resp` (refactor it to a named `resp` variable if it currently returns a literal). The function becomes:

```go
func ToAbuseReportResponse(r *domain.ReportAbuse) AbuseReportResponse {
	resp := AbuseReportResponse{
		ID:             r.ID,
		TargetReportID: r.TargetReportID,
		TargetUserID:   r.TargetUserID,
		ReporterID:     r.ReporterID,
		Reason:         r.Reason,
		Status:         r.Status,
		ResolvedBy:     r.ResolvedBy,
		ResolvedAt:     r.ResolvedAt,
		CreatedAt:      r.CreatedAt,
	}
	if r.Reporter.ID != (uuid.UUID{}) {
		resp.Reporter = &AbuseUserRef{ID: r.Reporter.ID, Name: r.Reporter.Name}
	}
	if r.TargetUser != nil && r.TargetUser.ID != (uuid.UUID{}) {
		resp.TargetUser = &AbuseUserRef{ID: r.TargetUser.ID, Name: r.TargetUser.Name}
	}
	if r.TargetReport != nil && r.TargetReport.ID != (uuid.UUID{}) {
		resp.TargetReport = &AbuseTargetReportRef{
			ID:      r.TargetReport.ID,
			PetID:   r.TargetReport.PetID,
			PetName: r.TargetReport.Pet.Name,
		}
	}
	return resp
}
```

- [ ] **Step 5: Run test to verify it PASSES.** From `backend/`:
`go test ./tests/ -run TestToAbuseReportResponse -v`
Expected: PASS (all three subtests). No DB needed.

- [ ] **Step 6: Commit.**
```bash
git add backend/internal/domain/models.go backend/internal/dto/abuse_report_dto.go backend/tests/abuse_report_dto_test.go
git commit -m "feat(api): enrich AbuseReportResponse with reporter/target refs (#11)"
```

---

### Task 2: Backend repository — preload associations

**Files:**
- Modify: `backend/internal/repository/abuse_report_repository.go`
- Test: `backend/tests/abuse_report_repository_test.go` (append)

- [ ] **Step 1: Write the failing tests.** Append to `backend/tests/abuse_report_repository_test.go`:

```go
func TestAbuseReportRepository_GetAll_PreloadsReporterAndTargetUser(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	abuseRepo := repository.NewAbuseReportRepository(gormDB)
	ctx := context.Background()

	reporter := newTestUser(t, userRepo)
	target := newTestUser(t, userRepo)

	ab := &domain.ReportAbuse{
		ID:           uuid.New(),
		ReporterID:   reporter.ID,
		TargetUserID: &target.ID,
		Reason:       "spam",
		Status:       "pending",
	}
	if err := abuseRepo.Create(ctx, ab); err != nil {
		t.Fatalf("Create: %v", err)
	}

	all, err := abuseRepo.GetAll(ctx, nil, 20, 0)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("want 1 report, got %d", len(all))
	}
	got := all[0]
	if got.Reporter.ID != reporter.ID || got.Reporter.Name != reporter.Name {
		t.Errorf("reporter not preloaded: got %+v", got.Reporter)
	}
	if got.TargetUser == nil || got.TargetUser.ID != target.ID || got.TargetUser.Name != target.Name {
		t.Errorf("target user not preloaded: got %+v", got.TargetUser)
	}
}

func TestAbuseReportRepository_GetByID_PreloadsTargetReportPet(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	abuseRepo := repository.NewAbuseReportRepository(gormDB)
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

	ab := &domain.ReportAbuse{
		ID:             uuid.New(),
		ReporterID:     owner.ID,
		TargetReportID: &rep.ID,
		Reason:         "fake",
		Status:         "pending",
	}
	if err := abuseRepo.Create(ctx, ab); err != nil {
		t.Fatalf("Create abuse: %v", err)
	}

	got, err := abuseRepo.GetByID(ctx, ab.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.TargetReport == nil {
		t.Fatal("target report not preloaded")
	}
	if got.TargetReport.Pet.Name != "Toby" {
		t.Errorf("want target report pet 'Toby', got %q", got.TargetReport.Pet.Name)
	}
}
```

Note: `newTestUser`, `ptrUUID`, `domain.PetStatusLost` are already used elsewhere in the `tests` package. Confirm `domain.PetStatusLost` exists (it is the `lost` status constant); if the constant name differs, use the one used in `success_story_repository_test.go` for a found pet as reference (e.g. `domain.PetStatusFound`) and adapt — a `lost` pet is fine here, any valid status works.

- [ ] **Step 2: Run tests to verify they FAIL.** From `backend/`:
`DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run "TestAbuseReportRepository_GetAll_PreloadsReporterAndTargetUser|TestAbuseReportRepository_GetByID_PreloadsTargetReportPet" -v`
Expected: FAIL — `reporter not preloaded` / `target report not preloaded` (associations are not currently preloaded).

- [ ] **Step 3: Add the preloads.** In `backend/internal/repository/abuse_report_repository.go`:

`GetByID` — change the query to:
```go
	err := r.db.WithContext(ctx).
		Preload("Reporter").
		Preload("TargetUser").
		Preload("TargetReport.Pet").
		Where("id = ?", id).
		First(&report).Error
```

`GetAll` — change the builder `q := r.db.WithContext(ctx)` to:
```go
	q := r.db.WithContext(ctx).
		Preload("Reporter").
		Preload("TargetUser").
		Preload("TargetReport.Pet")
```

- [ ] **Step 4: Run tests to verify they PASS.** Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Run the full abuse-report repo suite (no regression).** From `backend/`:
`DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./tests/ -run TestAbuseReportRepository -v`
Expected: all PASS.

- [ ] **Step 6: Commit.**
```bash
git add backend/internal/repository/abuse_report_repository.go backend/tests/abuse_report_repository_test.go
git commit -m "feat(api): preload reporter/target associations for abuse reports (#11)"
```

---

### Task 3: Shared type — enriched AbuseReport

**Files:**
- Modify: `frontend/packages/shared/types/index.ts` (the `AbuseReport` interface, ~line 389)

- [ ] **Step 1: Add the nested fields.** In the `AbuseReport` interface, after `created_at: string;`, add:

```ts
  reporter?: { id: string; name: string };
  target_user?: { id: string; name: string };
  target_report?: { id: string; pet_id: string; pet_name: string };
```

- [ ] **Step 2: Typecheck.** From `frontend/packages/web`:
`pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit.**
```bash
git add frontend/packages/shared/types/index.ts
git commit -m "feat(types): add enriched refs to AbuseReport (#11)"
```

---

### Task 4: Web — reporter column + enriched target with links

**Files:**
- Modify: `frontend/packages/web/src/pages/admin/AbuseReportsPage.tsx`
- Test: `frontend/packages/web/src/pages/admin/AbuseReportsPage.test.tsx` (create)

- [ ] **Step 1: Write the failing test.** Create `frontend/packages/web/src/pages/admin/AbuseReportsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AbuseReportsPage } from './AbuseReportsPage';

let mockReports: unknown[] = [];

vi.mock('@shared/api/client', () => ({
  apiClient: {
    listAbuseReports: () => Promise.resolve(mockReports),
    resolveAbuseReport: vi.fn(),
  },
}));

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    reporter_id: 'rrrrrrrr-0000-0000-0000-000000000000',
    reason: 'spam',
    status: 'pending',
    created_at: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AbuseReportsPage', () => {
  beforeEach(() => {
    mockReports = [];
  });

  it('muestra el nombre del reporter como link a su perfil', async () => {
    mockReports = [makeReport({ reporter: { id: 'u-rep', name: 'Alice' } })];
    render(<AbuseReportsPage />, { wrapper });

    const link = await screen.findByRole('link', { name: 'Alice' });
    expect(link.getAttribute('href')).toBe('/users/u-rep');
  });

  it('muestra un target usuario como link a su perfil', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_user: { id: 'u-bob', name: 'Bob' },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    const link = await screen.findByRole('link', { name: 'Bob' });
    expect(link.getAttribute('href')).toBe('/users/u-bob');
  });

  it('muestra un target reporte como nombre de mascota linkeado a la mascota', async () => {
    mockReports = [
      makeReport({
        reporter: { id: 'u-rep', name: 'Alice' },
        target_report: { id: 'rep-1', pet_id: 'pet-1', pet_name: 'Toby' },
      }),
    ];
    render(<AbuseReportsPage />, { wrapper });

    const link = await screen.findByRole('link', { name: 'Toby' });
    expect(link.getAttribute('href')).toBe('/pets/pet-1');
  });

  it('cae al ID truncado cuando no hay objetos enriquecidos', async () => {
    mockReports = [makeReport({ target_user_id: 'tttttttt-0000-0000-0000-000000000000' })];
    render(<AbuseReportsPage />, { wrapper });

    expect(await screen.findByText(/user: tttttttt/)).toBeTruthy();
    // reporter falls back to its truncated id (no link)
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS.** From `frontend/packages/web`:
`pnpm vitest run src/pages/admin/AbuseReportsPage.test.tsx`
Expected: FAIL — no `link` with name "Alice" (page renders no reporter link yet).

- [ ] **Step 3: Implement.** In `AbuseReportsPage.tsx`:

Add the `Link` import at the top:
```tsx
import { Link } from 'react-router';
```

Add a **Reporter** header `<th>` between the `ID` and `Reason` headers:
```tsx
                <th className="py-2 px-3 font-semibold text-gray-600 dark:text-gray-400">Reporter</th>
```

Add a **Reporter** cell between the `ID` cell and the `Reason` cell (after the `<td>` that shows `report.id.slice(0, 8)`):
```tsx
                  <td className="py-2 px-3">
                    {report.reporter ? (
                      <Link to={`/users/${report.reporter.id}`} className="text-primary hover:underline">
                        {report.reporter.name}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {report.reporter_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
```

Replace the existing **Target** cell (the one rendering `report.target_user_id ? ... : ...`) with:
```tsx
                  <td className="py-2 px-3">
                    {report.target_user ? (
                      <Link to={`/users/${report.target_user.id}`} className="text-primary hover:underline">
                        {report.target_user.name}
                      </Link>
                    ) : report.target_report ? (
                      <Link to={`/pets/${report.target_report.pet_id}`} className="text-primary hover:underline">
                        {report.target_report.pet_name}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {report.target_user_id
                          ? `user: ${report.target_user_id.slice(0, 8)}`
                          : report.target_report_id
                          ? `report: ${report.target_report_id.slice(0, 8)}`
                          : '—'}
                      </span>
                    )}
                  </td>
```

- [ ] **Step 4: Run test to verify it PASSES.** From `frontend/packages/web`:
`pnpm vitest run src/pages/admin/AbuseReportsPage.test.tsx`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit.**
```bash
git add frontend/packages/web/src/pages/admin/AbuseReportsPage.tsx frontend/packages/web/src/pages/admin/AbuseReportsPage.test.tsx
git commit -m "feat(web): show reporter + target names with links in abuse reports (#11)"
```

---

### Task 5: Full verification + PR

- [ ] **Step 1: Backend full suite.** From `backend/`:
`DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" go test ./...`
Expected: all PASS.

- [ ] **Step 2: Web + shared tests.** From `frontend/packages/web`:
`pnpm test:run`
Expected: all PASS.

- [ ] **Step 3: Web typecheck.** From `frontend/packages/web`:
`pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Open the PR.** Follow the `searchpet-pr` skill. Branch `feat/admin-abuse-report-detail` off `main`. Conventional commits, NO Co-Authored-By. The admin abuse-report surface is sensitive (moderation) — note in the PR body that the change is read-only enrichment (no new mutations). Push and open the PR; the user controls merge.

---

## Self-Review

**Spec coverage:**
- Associations on `ReportAbuse` → Task 1 Step 1. ✓
- Preload in repo → Task 2. ✓
- Nested DTO refs alongside flat IDs (additive) → Task 1 Steps 4. ✓
- Graceful omit when association unloaded/deleted → Task 1 (OmitsUnloadedAssociations test + omitempty). ✓
- Shared type → Task 3. ✓
- Web reporter column + enriched target with links to `/users/:id` and `/pets/:petId`, fallback to truncated IDs → Task 4. ✓
- Web-only, no mobile → no mobile task. ✓
- Out of scope (#13 endpoints, #14 modals) → not present. ✓

**Placeholder scan:** No TBD/TODO; full code in every step. ✓

**Type consistency:** Go `AbuseUserRef{ID,Name}` / `AbuseTargetReportRef{ID,PetID,PetName}` ↔ TS `{id,name}` / `{id,pet_id,pet_name}` ↔ JSON tags. Web reads `report.reporter`, `report.target_user`, `report.target_report` matching the shared type. Routes `/users/:id` and `/pets/:id` confirmed to exist in `App.tsx`. ✓
