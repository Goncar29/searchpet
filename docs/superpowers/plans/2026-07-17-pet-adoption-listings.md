# Pet Adoption Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user publish a pet for adoption in a dedicated "Adoptar" section, fully isolated from the lost-pet flows, with a two-state lifecycle (`adoption` → `adopted`).

**Architecture:** Option A from the design spec — reuse the `Pet` entity and add two new statuses (`adoption`, `adopted`) that form a closed state-machine cluster with zero edges to the lost cluster. A free-text `city` field replaces geo. New public `GET /api/adoptions` endpoint. Web and mobile reuse the existing publish wizard and the "Mis mascotas" page (new third tab).

**Tech Stack:** Go 1.25 + Gin + GORM (backend), React + Vite + Tailwind (web), React Native + Expo (mobile), shared TS package, i18next (es/en/pt), Go tests + Vitest + Jest.

**Spec:** `docs/superpowers/specs/2026-07-17-pet-adoption-listings-design.md`

**Delivery:** Three phases, each a shippable stacked PR (matching SearchPet's stacked-PR convention):
- **Phase 1 — Backend** (Tasks B1–B7): statuses, state machine, city, create path, `/api/adoptions`.
- **Phase 2 — Shared + Web** (Tasks W1–W7): types, hooks, client, publish step, Adoptar page, profile tab, i18n.
- **Phase 3 — Mobile** (Tasks M1–M4): publish step, Adoptar screen, profile tab, i18n.

Each phase depends on the previous. Do not start Phase 2 before Phase 1 is merged (frontend types must match the shipped API).

---

## File Structure

**Backend (Phase 1)**
- Modify `backend/internal/domain/pet_status.go` — new status constants + `AdoptionVisibleStatuses`.
- Modify `backend/internal/domain/status_machine.go` — adoption cluster edges.
- Modify `backend/internal/domain/models.go` — `Pet.City` field.
- Modify `backend/internal/domain/pet_search.go` (or wherever `PetSearchCriteria` lives) — `City` filter field.
- Modify `backend/internal/dto/pet_dto.go` — `City` on Create/Update/Response DTOs + mapper.
- Modify `backend/internal/service/pet_service.go` — accept `adoption` at creation, set city.
- Modify `backend/internal/handler/pet_handler.go` — `ListAdoptions` handler.
- Modify `backend/internal/app/router.go` — register `GET /api/adoptions`.
- Modify `backend/internal/repository/pet_repository.go` — city filter in `Search`.
- Tests: `backend/internal/domain/status_machine_test.go`, `backend/internal/dto/pet_dto_test.go`, plus a flow test under `backend/tests/`.

**Shared + Web (Phase 2)**
- Modify `frontend/packages/shared/types/index.ts` — `PetStatus`, `Pet.city`, `AdoptionFilters`, DTOs.
- Modify `frontend/packages/shared/utils/petStatusTransitions.ts` — adoption edges.
- Modify `frontend/packages/shared/api/client.ts` — `getAdoptions`.
- Modify `frontend/packages/shared/hooks/index.ts` — `useAdoptions`.
- Create `frontend/packages/web/src/pages/AdoptPage.tsx` — Adoptar section.
- Create `frontend/packages/web/src/components/publish/AdoptionFormStep.tsx` — publish step.
- Modify `frontend/packages/web/src/pages/PublishWizardPage.tsx` — adoption intent + step.
- Modify `frontend/packages/web/src/pages/MyPetsPage.tsx` — third tab + adoption card actions.
- Modify `frontend/packages/web/src/App.tsx` + nav layout — `/adopt` route + link.
- Create `frontend/packages/web/src/i18n/locales/{es,en,pt}/adoption.json`; modify `web/src/i18n/index.ts` + `pets.json` (status labels).

**Mobile (Phase 3)**
- Create `frontend/packages/mobile/components/publish/AdoptionFormStep.tsx`.
- Modify the mobile publish screen (`app/(tabs)/post.tsx` / `PostScreen`) — adoption intent + step.
- Create `frontend/packages/mobile/app/adopt.tsx` — Adoptar screen.
- Modify `frontend/packages/mobile/app/my-pets.tsx` — third tab.
- Modify mobile i18n bundles — same keys as web.

---

# PHASE 1 — BACKEND

### Task B1: Adoption statuses + state machine cluster

**Files:**
- Modify: `backend/internal/domain/pet_status.go`
- Modify: `backend/internal/domain/status_machine.go`
- Test: `backend/internal/domain/status_machine_test.go` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `backend/internal/domain/status_machine_test.go`:

```go
package domain

import "testing"

func TestAdoptionClusterTransitions(t *testing.T) {
	allowed := [][2]string{
		{PetStatusAdoption, PetStatusAdopted},
		{PetStatusAdopted, PetStatusAdoption},
		{PetStatusAdoption, PetStatusArchived},
		{PetStatusAdopted, PetStatusArchived},
	}
	for _, tc := range allowed {
		if err := ValidateTransition(tc[0], tc[1]); err != nil {
			t.Errorf("expected %s->%s allowed, got %v", tc[0], tc[1], err)
		}
	}

	// Isolation: no edges between the adoption cluster and the lost cluster.
	forbidden := [][2]string{
		{PetStatusLost, PetStatusAdoption},
		{PetStatusAdoption, PetStatusLost},
		{PetStatusRegistered, PetStatusAdoption},
		{PetStatusAdoption, PetStatusFound},
		{PetStatusStray, PetStatusAdoption},
		{PetStatusFound, PetStatusAdopted},
	}
	for _, tc := range forbidden {
		if err := ValidateTransition(tc[0], tc[1]); err == nil {
			t.Errorf("expected %s->%s rejected, got nil", tc[0], tc[1])
		}
	}

	if !ValidPetStatuses[PetStatusAdoption] || !ValidPetStatuses[PetStatusAdopted] {
		t.Error("adoption statuses must be in ValidPetStatuses")
	}
	// Isolation: adoption statuses must NOT be publicly searchable via ?status=.
	if PublicSearchableStatuses[PetStatusAdoption] || PublicSearchableStatuses[PetStatusAdopted] {
		t.Error("adoption statuses must NOT be in PublicSearchableStatuses")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/domain/ -run TestAdoptionClusterTransitions -v`
Expected: FAIL — `undefined: PetStatusAdoption`.

- [ ] **Step 3: Add the status constants**

In `backend/internal/domain/pet_status.go`, add to the `const` block:

```go
	PetStatusAdoption   = "adoption"
	PetStatusAdopted    = "adopted"
```

Add both to `ValidPetStatuses`:

```go
	PetStatusAdoption:   true,
	PetStatusAdopted:    true,
```

Append after `MapVisibleStatuses`:

```go
// AdoptionVisibleStatuses is the allowlist for the public "Adoptar" section.
// Only pets *available* for adoption are public; adopted pets are visible only
// to their owner (their profile tab). Deliberately kept OUT of
// FeedVisibleStatuses / MapVisibleStatuses / PublicSearchableStatuses so
// adoption never leaks into the lost-pet feed, map, or public search.
var AdoptionVisibleStatuses = []string{PetStatusAdoption}
```

**Do NOT** add the adoption statuses to `FeedVisibleStatuses`, `MapVisibleStatuses`, or `PublicSearchableStatuses`.

- [ ] **Step 4: Add the state-machine edges**

In `backend/internal/domain/status_machine.go`, add two entries to `AllowedTransitions`:

```go
	PetStatusAdoption: {PetStatusAdopted, PetStatusArchived},
	PetStatusAdopted:  {PetStatusAdoption, PetStatusArchived},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/domain/ -run TestAdoptionClusterTransitions -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/domain/pet_status.go backend/internal/domain/status_machine.go backend/internal/domain/status_machine_test.go
git commit -m "feat(backend): add adoption/adopted statuses and isolated state-machine cluster"
```

---

### Task B2: `Pet.City` field + DTO plumbing + response mapper

**Files:**
- Modify: `backend/internal/domain/models.go:64-91` (Pet struct)
- Modify: `backend/internal/dto/pet_dto.go` (CreatePetRequest, UpdatePetRequest, PetResponse, ToPetResponse)
- Test: `backend/internal/dto/pet_dto_test.go`

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/dto/pet_dto_test.go`:

```go
func TestToPetResponseIncludesCity(t *testing.T) {
	pet := &domain.Pet{Name: "Firulais", Type: "perro", Status: domain.PetStatusAdoption, City: "Montevideo"}
	resp := dto.ToPetResponse(pet)
	if resp.City != "Montevideo" {
		t.Errorf("expected city Montevideo, got %q", resp.City)
	}
}
```

(Adjust the import/package prefix to match the existing test file's style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/dto/ -run TestToPetResponseIncludesCity -v`
Expected: FAIL — `pet.City undefined` / `resp.City undefined`.

- [ ] **Step 3: Add `City` to the `Pet` model**

In `backend/internal/domain/models.go`, add to the `Pet` struct (after `Description`):

```go
	City string `gorm:"size:120" json:"city,omitempty"` // free-text city/zone; used by adoption listings for filtering
```

- [ ] **Step 4: Add `City` to the DTOs**

In `backend/internal/dto/pet_dto.go`:

`CreatePetRequest` (after `Description`):
```go
	City string `json:"city"`
```

`UpdatePetRequest` (after `Description`, pointer per rule #22):
```go
	City *string `json:"city"`
```

`PetResponse` (after `Description`):
```go
	City string `json:"city,omitempty"`
```

In `ToPetResponse`, add `City: pet.City,` to the `PetResponse{...}` literal.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./internal/dto/ -run TestToPetResponseIncludesCity -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/domain/models.go backend/internal/dto/pet_dto.go backend/internal/dto/pet_dto_test.go
git commit -m "feat(backend): add city field to Pet model and DTOs"
```

---

### Task B3: Accept `adoption` at creation + persist city

**Files:**
- Modify: `backend/internal/service/pet_service.go:80-197` (CreatePet)
- Modify: `backend/internal/service/pet_service.go:245-256` (UpdatePet city set)
- Test: `backend/internal/service/pet_service_adoption_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/internal/service/pet_service_adoption_test.go`. Use the mock `PetRepository` pattern already used by other service tests in this package (find an existing `*_test.go` in `internal/service/` and mirror its fakes/setup — reuse its mock repo type rather than writing a new one):

```go
package service

// Mirror the existing service-test scaffolding in this package for the fake
// PetRepository (Create captures the pet, FindByID returns it).

func TestCreatePetAdoption(t *testing.T) {
	// ... build petService with the package's existing fake repo (eventBus/uow may be nil) ...
	req := dto.CreatePetRequest{Name: "Michi", Type: "gato", Status: domain.PetStatusAdoption, City: "Salto"}
	pet, err := svc.CreatePet(validOwnerUUID, req)
	if err != nil {
		t.Fatalf("adoption create failed: %v", err)
	}
	if pet.Status != domain.PetStatusAdoption {
		t.Errorf("status = %q, want adoption", pet.Status)
	}
	if pet.City != "Salto" {
		t.Errorf("city = %q, want Salto", pet.City)
	}
	if pet.OwnerID == nil {
		t.Error("adoption pet must have an owner")
	}
}

func TestCreatePetAdoptionRejectsInitialReport(t *testing.T) {
	req := dto.CreatePetRequest{Name: "Michi", Type: "gato", Status: domain.PetStatusAdoption,
		InitialReport: &dto.InitialReportRequest{Latitude: -34.9, Longitude: -56.1}}
	_, err := svc.CreatePet(validOwnerUUID, req)
	if !errors.Is(err, domain.ErrInitialReportNotAllowed) {
		t.Errorf("want ErrInitialReportNotAllowed, got %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestCreatePetAdoption -v`
Expected: FAIL — adoption rejected with `ErrInvalidStatusTransition`.

- [ ] **Step 3: Extend the creation validation and set city**

In `CreatePet` (`pet_service.go`), replace the creation-status guard:

```go
	// Only registered, stray and adoption are valid at creation
	if status != domain.PetStatusRegistered && status != domain.PetStatusStray && status != domain.PetStatusAdoption {
		return nil, domain.ErrInvalidStatusTransition
	}

	// initial_report rules: required for stray, forbidden for every other status
	if status == domain.PetStatusStray && req.InitialReport == nil {
		return nil, domain.ErrInitialReportRequired
	}
	if status != domain.PetStatusStray && req.InitialReport != nil {
		return nil, domain.ErrInitialReportNotAllowed
	}
```

(This generalizes the old `registered`-only `ErrInitialReportNotAllowed` check to cover adoption too. Adoption falls into the existing `else` branch that sets `ownerPtr` — the publisher becomes the owner, no report, no episode.)

Add `City: req.City,` to the `pet := &domain.Pet{...}` literal.

- [ ] **Step 4: Allow city edits in UpdatePet**

In `UpdatePet`, after the `req.Description` block (`pet_service.go:254-256`), add:

```go
	if req.City != nil {
		pet.City = *req.City
	}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test ./internal/service/ -run TestCreatePetAdoption -v`
Expected: PASS (both subtests).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/service/pet_service.go backend/internal/service/pet_service_adoption_test.go
git commit -m "feat(backend): accept adoption status at creation and persist city"
```

---

### Task B4: `PetSearchCriteria.City` + repository filter

**Files:**
- Modify: `backend/internal/domain/pet_search.go` (or the file defining `PetSearchCriteria`)
- Modify: `backend/internal/repository/pet_repository.go:77-170` (Search)

- [ ] **Step 1: Add the criteria field**

Find the `PetSearchCriteria` struct (grep: `type PetSearchCriteria struct`). Add:

```go
	City string
```

- [ ] **Step 2: Add the filter to the repository query**

In `Search` (`pet_repository.go`), after the `Color` filter block (line ~110-112), add:

```go
	if filters.City != "" {
		q = q.Where("pets.city ILIKE ?", "%"+filters.City+"%")
	}
```

Also add `pets.city` to the JOIN-path `Distinct(...)` column list (line ~143) so it isn't dropped if a city + geo/date query ever combines (harmless for the adoption path, which never joins):

```go
		q = q.Distinct("pets.id, pets.owner_id, pets.reporter_id, pets.name, pets.type, pets.breed, pets.color, pets.description, pets.gender, pets.microchip_id, pets.status, pets.version, pets.city, pets.created_at, pets.updated_at")
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/domain/pet_search.go backend/internal/repository/pet_repository.go
git commit -m "feat(backend): add city filter to pet search criteria and repository"
```

---

### Task B5: `GET /api/adoptions` handler + route

**Files:**
- Modify: `backend/internal/handler/pet_handler.go` (add `ListAdoptions`)
- Modify: `backend/internal/app/router.go` (register public route)

- [ ] **Step 1: Add the handler**

In `pet_handler.go`, add after `SearchPets`:

```go
// ListAdoptions godoc
// GET /api/adoptions
// Public — lists pets available for adoption (status "adoption" only).
// Optional query params: type, city, page, limit. Never returns adopted pets
// or any lost-cluster status.
func (h *PetHandler) ListAdoptions(c *gin.Context) {
	criteria := domain.PetSearchCriteria{
		Statuses: []string{domain.PetStatusAdoption},
		Type:     c.Query("type"),
		City:     c.Query("city"),
	}

	if pageStr := c.Query("page"); pageStr != "" {
		p, err := strconv.Atoi(pageStr)
		if err != nil || p < 1 {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidPageParam)
			return
		}
		criteria.Page = p
	} else {
		criteria.Page = 1
	}

	if limitStr := c.Query("limit"); limitStr != "" {
		l, err := strconv.Atoi(limitStr)
		if err != nil || l < 1 {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidLimitParam)
			return
		}
		if l > 100 {
			l = 100
		}
		criteria.Limit = l
	} else {
		criteria.Limit = 20
	}

	result, err := h.petService.SearchPets(criteria)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}
	c.JSON(http.StatusOK, result)
}
```

- [ ] **Step 2: Register the route**

In `router.go`, find where the **public** `GET /api/pets/search` route is registered (grep: `"/pets/search"` or `SearchPets`). Register the adoptions route in the same public group:

```go
	// public group (no auth):
	<publicGroup>.GET("/adoptions", petHandler.ListAdoptions)
```

Match the exact group variable and path prefix used for `/pets/search` (e.g. if search is `api.GET("/pets/search", ...)` under an `api := r.Group("/api")`, use `api.GET("/adoptions", ...)`).

- [ ] **Step 3: Verify it builds**

Run: `cd backend && go build ./...`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/handler/pet_handler.go backend/internal/app/router.go
git commit -m "feat(backend): add public GET /api/adoptions endpoint"
```

---

### Task B6: End-to-end flow test for adoptions

**Files:**
- Test: `backend/tests/adoption_flow_test.go` (create — mirror the existing httptest flow tests in `backend/tests/`)

- [ ] **Step 1: Write the flow test**

Mirror the setup of an existing flow test in `backend/tests/` (they spin up the router via `app.SetupRouter` / the exported `SetupRouter` against a test DB). Cover:

```go
// 1. Register + login a user, get a JWT.
// 2. POST /api/pets with {name, type, status:"adoption", city:"Montevideo"} -> 201, status "adoption".
// 3. GET /api/adoptions -> 200, the pet appears; GET /api/adoptions?city=montevideo -> appears;
//    GET /api/adoptions?city=salto -> does NOT appear.
// 4. GET /api/pets/search?status=lost -> the adoption pet does NOT appear (isolation).
// 5. GET /api/pets/search?status=adoption -> 400 (adoption not in PublicSearchableStatuses).
// 6. PUT /api/pets/:id {status:"adopted", version:N} -> 200, status "adopted".
// 7. GET /api/adoptions -> the pet no longer appears (adopted is not public).
// 8. PUT /api/pets/:id {status:"lost", version:N} -> 422 (no cross-cluster edge).
```

- [ ] **Step 2: Run the flow test**

Run: `cd backend && go test ./tests/ -run Adoption -v`
Expected: PASS. (If the suite needs a DB, follow the existing flow tests' env setup. Per memory note `go-test-wipes-dev-db`: never point `DATABASE_URL` at the dev DB — use the test DB the other flow tests use, and reseed dev after if touched.)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/adoption_flow_test.go
git commit -m "test(backend): end-to-end adoption listing flow + isolation from lost search"
```

---

### Task B7: Phase 1 verification + PR

- [ ] **Step 1: Full backend test + build**

Run: `cd backend && go build ./... && go test ./...`
Expected: all green.

- [ ] **Step 2: Open the Phase 1 PR**

Use the `searchpet-pr` skill (branch conventions). Base `main`, branch `feat/pet-adoption-listings` (already created). Title: "feat(backend): adoption listings — statuses, city, GET /api/adoptions". Note: AutoMigrate adds the `city` column on deploy (rule #19); no manual migration.

---

# PHASE 2 — SHARED + WEB

> Depends on Phase 1 being merged (the API must ship the new status + endpoint first). Branch off updated `main`: `feat/pet-adoption-web` (stacked on Phase 1 if not yet merged).

### Task W1: Shared types + status transitions

**Files:**
- Modify: `frontend/packages/shared/types/index.ts:258` (PetStatus), `:48-65` (Pet), `:304-310` (UpdatePetRequest), `CreatePetRequest`, add `AdoptionFilters`
- Modify: `frontend/packages/shared/utils/petStatusTransitions.ts`
- Test: `frontend/packages/shared/utils/petStatusTransitions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `petStatusTransitions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectableStatuses, ALLOWED_TRANSITIONS } from './petStatusTransitions';

describe('adoption cluster transitions', () => {
  it('allows adoption <-> adopted and both -> archived', () => {
    expect(ALLOWED_TRANSITIONS.adoption).toEqual(['adopted', 'archived']);
    expect(ALLOWED_TRANSITIONS.adopted).toEqual(['adoption', 'archived']);
  });
  it('never offers a lost-cluster target from adoption', () => {
    const targets = selectableStatuses('adoption');
    expect(targets).not.toContain('lost');
    expect(targets).not.toContain('found');
    expect(targets).not.toContain('stray');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts petStatusTransitions`
Expected: FAIL — `ALLOWED_TRANSITIONS.adoption` is undefined.

- [ ] **Step 3: Update the types**

In `shared/types/index.ts`:
- `PetStatus`: `export type PetStatus = 'registered' | 'lost' | 'stray' | 'found' | 'archived' | 'adoption' | 'adopted';`
- `Pet` interface: add `city?: string;` after `description`.
- `CreatePetRequest`: add `city?: string;`.
- `UpdatePetRequest`: add `city?: string;`.
- Add near `PetSearchFilters`:

```ts
export interface AdoptionFilters {
  type?: PetType;
  city?: string;
  page?: number;
  limit?: number;
}
```

- [ ] **Step 4: Update the transitions map**

In `petStatusTransitions.ts`, add to `ALLOWED_TRANSITIONS`:

```ts
  adoption: ['adopted', 'archived'],
  adopted: ['adoption', 'archived'],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts petStatusTransitions`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/utils/petStatusTransitions.ts frontend/packages/shared/utils/petStatusTransitions.test.ts
git commit -m "feat(shared): add adoption statuses, city field, and adoption transitions"
```

---

### Task W2: API client + hook for adoptions

**Files:**
- Modify: `frontend/packages/shared/api/client.ts:262-310` (pets section)
- Modify: `frontend/packages/shared/hooks/index.ts:104-138` (pet hooks)

- [ ] **Step 1: Add the client method**

In `client.ts`, after `searchPets`, add:

```ts
  async getAdoptions(filters: AdoptionFilters): Promise<PetListResponse> {
    const params: Record<string, string | number> = {};
    if (filters.type) params.type = filters.type;
    if (filters.city) params.city = filters.city;
    if (filters.page) params.page = filters.page;
    if (filters.limit) params.limit = filters.limit;
    return this.request<PetListResponse>('GET', '/api/adoptions', undefined, params);
  }
```

(Match the exact `request` signature `searchPets` uses for query params — mirror its call shape.)

Import `AdoptionFilters` in the client's type imports.

- [ ] **Step 2: Add the hook**

In `hooks/index.ts`, after `useSearchPets`, add:

```ts
export const useAdoptions = (params: AdoptionFilters) => {
  return useQuery({
    queryKey: ['pets', 'adoptions', params],
    queryFn: () => apiClient.getAdoptions(params),
  });
};
```

Add `AdoptionFilters` to the type imports at the top of `hooks/index.ts`.

- [ ] **Step 3: Verify it type-checks**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/api/client.ts frontend/packages/shared/hooks/index.ts
git commit -m "feat(shared): add getAdoptions client method and useAdoptions hook"
```

---

### Task W3: i18n — status labels + `adoption` namespace (web)

**Files:**
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}/pets.json` — status labels
- Create: `frontend/packages/web/src/i18n/locales/{es,en,pt}/adoption.json`
- Modify: `frontend/packages/web/src/i18n/index.ts` — register `adoption` namespace in all 3 blocks

- [ ] **Step 1: Add status labels to `pets.json`**

In each `pets.json`, under `status`, add:
- es: `"adoption": "En adopción", "adopted": "Adoptado"`
- en: `"adoption": "For adoption", "adopted": "Adopted"`
- pt: `"adoption": "Para adoção", "adopted": "Adotado"`

- [ ] **Step 2: Create the `adoption` namespace files**

`adoption.json` (es shown; translate for en/pt with matching keys):

```json
{
  "section": {
    "title": "Adoptar",
    "subtitle": "Mascotas que buscan un hogar",
    "empty": "No hay mascotas en adopción por ahora",
    "cityFilter": "Ciudad",
    "cityPlaceholder": "Filtrar por ciudad",
    "typeFilter": "Tipo",
    "allTypes": "Todos",
    "badge": "En adopción",
    "resultCount_one": "{{count}} mascota",
    "resultCount_other": "{{count}} mascotas"
  },
  "publish": {
    "intentOption": "Doy en adopción",
    "intentHelp": "Publicá una mascota que busca un hogar",
    "cityLabel": "Ciudad",
    "cityPlaceholder": "Ej: Montevideo",
    "submit": "Publicar en adopción",
    "cityRequired": "Ingresá una ciudad"
  },
  "profile": {
    "tab": "En adopción",
    "empty": "No tenés mascotas en adopción",
    "markAdopted": "Marcar adoptado",
    "markAdoptedConfirm": "¿Confirmás que esta mascota fue adoptada?",
    "archive": "Archivar"
  }
}
```

en (`For adoption` / `Pets looking for a home` / `City` / `I'm giving for adoption` / `Publish for adoption` / `Mark adopted` …) and pt (`Adotar` / `Animais à procura de um lar` / `Cidade` / `Dou para adoção` / `Publicar para adoção` / `Marcar adotado` …) with the **same key set**.

- [ ] **Step 3: Register the namespace**

In `web/src/i18n/index.ts`, add `adoption` to each of the `es`, `en`, `pt` resource blocks (import the JSON + add to the namespace map), exactly like the existing `admin`/`vets` namespaces (rule #21 — otherwise `useTranslation('adoption')` returns raw keys).

- [ ] **Step 4: Verify parity + type-check**

Run: `cd frontend/packages/web && pnpm tsc --noEmit`
Manually confirm es/en/pt `adoption.json` have identical key sets.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/i18n
git commit -m "feat(web): add adoption i18n namespace and status labels (es/en/pt)"
```

---

### Task W4: Adopt section page + route + nav

**Files:**
- Create: `frontend/packages/web/src/pages/AdoptPage.tsx`
- Modify: `frontend/packages/web/src/App.tsx` (route `/adopt`)
- Modify: the nav layout (`layouts/MainLayout.tsx`) — add "Adoptar" link

- [ ] **Step 1: Build the page**

Create `AdoptPage.tsx` modeled on `HomePage.tsx`'s structure (filters + grid of `PetCardWeb`), but:
- Data source: `useAdoptions({ type, city, page })`.
- Filters: a **city** text input and a **type** select, using the draft/applied state pattern (mirror HomePage — a "borrador" state updated on keystroke, applied on submit/button, so the query doesn't fire per keystroke; see rule/pattern in HomePage). Copy from `t('adoption:section.*')`.
- Cards: reuse `PetCardWeb` with the `adoption:section.badge` label. Card links to `/pets/:id` (existing detail page works — it already shows contact/chat).
- Empty state: `t('adoption:section.empty')`.

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdoptions } from '@shared/hooks';
import { PetCardWeb } from '../components/PetCardWeb';

export function AdoptPage() {
  const { t } = useTranslation(['adoption', 'common', 'pets']);
  const [cityDraft, setCityDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState('');
  const [applied, setApplied] = useState<{ city?: string; type?: string }>({});
  const { data, isLoading } = useAdoptions({ city: applied.city, type: applied.type as never });

  const apply = () => setApplied({ city: cityDraft.trim() || undefined, type: typeDraft || undefined });
  // ... render: title/subtitle, city input + type select + apply button,
  //     loading skeletons, empty state, grid of <PetCardWeb pet={p} />.
}
```

Fill in the JSX following `HomePage.tsx`'s markup and Tailwind classes so it matches the site.

- [ ] **Step 2: Register the route**

In `App.tsx`, add `<Route path="/adopt" element={<AdoptPage />} />` (import `AdoptPage`).

- [ ] **Step 3: Add the nav link**

In `MainLayout.tsx`, add a nav link to `/adopt` labeled `t('adoption:section.title')` (or a `layout` namespace key if nav labels live there — follow the existing nav-link pattern).

- [ ] **Step 4: Verify build + smoke**

Run: `cd frontend/packages/web && pnpm build`
Expected: build succeeds. Manually: `pnpm dev`, open `/adopt`, confirm it renders (empty state if no data) with no raw i18n keys.

- [ ] **Step 5: Commit**

```bash
git add frontend/packages/web/src/pages/AdoptPage.tsx frontend/packages/web/src/App.tsx frontend/packages/web/src/layouts/MainLayout.tsx
git commit -m "feat(web): add Adoptar section page, route, and nav link"
```

---

### Task W5: Publish wizard — adoption intent + step

**Files:**
- Create: `frontend/packages/web/src/components/publish/AdoptionFormStep.tsx`
- Modify: `frontend/packages/web/src/pages/PublishWizardPage.tsx`
- Test: `frontend/packages/web/src/pages/PublishWizardPage.test.tsx`

- [ ] **Step 1: Extend the wizard types**

In `PublishWizardPage.tsx`:
- `PublishIntent`: `'lost' | 'stray' | 'adoption'`.
- `PublishStep`: add `'adoption-form'`.
- Add an `adoptionForm` slice to `PublishWizardState` (`{ type, breed, color, description, city, photos }`) with an `initial` value.
- In the intent step UI, add a third option card "Doy en adopción" (`t('adoption:publish.intentOption')`) that routes to the `adoption-form` step.

- [ ] **Step 2: Build the adoption form step**

Create `AdoptionFormStep.tsx` modeled on `StrayFormStep.tsx`, but with a **city** text input (`adoption:publish.cityLabel`) instead of the location/contact-opt-in fields, and **no** location step afterwards. On submit it calls `useCreatePet().mutate({ name, type, breed, color, description, city, status: 'adoption', photos… })` then uploads photos (mirror how `StrayFormStep` creates the pet and uploads photos), and advances to the `success` step.

City is required client-side: block submit with `t('adoption:publish.cityRequired')` if empty.

- [ ] **Step 3: Wire the step into the wizard render switch**

In `PublishWizardPage.tsx`, render `<AdoptionFormStep .../>` when `step === 'adoption-form'`.

- [ ] **Step 4: Write/extend the test**

In `PublishWizardPage.test.tsx`, add a test: selecting the "Doy en adopción" intent shows the adoption form with a city field; submitting calls create with `status: 'adoption'` and the city. Mock `@shared/hooks` (`useCreatePet`, `useMyPets`, `useUploadPhoto`) per the existing test's mock setup.

- [ ] **Step 5: Run tests**

Run: `cd frontend/packages/web && pnpm vitest run PublishWizardPage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/components/publish/AdoptionFormStep.tsx frontend/packages/web/src/pages/PublishWizardPage.tsx frontend/packages/web/src/pages/PublishWizardPage.test.tsx
git commit -m "feat(web): add adoption intent and form step to publish wizard"
```

---

### Task W6: "En adopción" profile tab

**Files:**
- Modify: `frontend/packages/web/src/pages/MyPetsPage.tsx`
- Test: `frontend/packages/web/src/pages/MyPetsPage.test.tsx`

- [ ] **Step 1: Add the STATUS_CONFIG entries**

At the top of `MyPetsPage.tsx`, extend `STATUS_CONFIG` with `adoption` and `adopted` entries (badge className + `labelKey: 'pets:status.adoption' / 'pets:status.adopted'`), mirroring the existing entries.

- [ ] **Step 2: Add the third tab + client-side split**

- Change the tab state type to `'owned' | 'reported' | 'adoption'`.
- Split `ownedPets` (from `useMyPets`): the **owned** tab shows pets whose status is NOT `adoption`/`adopted`; the **adoption** tab shows only pets whose status IS `adoption`/`adopted`.

```tsx
const adoptionPets = (ownedPets ?? []).filter(p => p.status === 'adoption' || p.status === 'adopted');
const ownedNonAdoption = (ownedPets ?? []).filter(p => p.status !== 'adoption' && p.status !== 'adopted');
```

- Add `renderTab('adoption', t('adoption:section.title'))` next to the existing tabs; wire `pets`/`emptyText` for the new tab (`t('adoption:profile.empty')`).

- [ ] **Step 3: Adoption-specific card actions**

For adoption cards, the status dropdown already works via `selectableStatuses` (now includes the adoption cluster) — so "Marcar adoptado" is available as a status change to `adopted`, and revert/archive too. Ensure the lost-only **"Reportar perdida"** button is hidden for adoption/adopted pets (guard: only render it when `pet.status !== 'adoption' && pet.status !== 'adopted'`). Keep Edit + Delete.

- [ ] **Step 4: Update the test**

In `MyPetsPage.test.tsx`, add a test: with a mocked adoption pet in `useMyPets`, the "En adopción" tab renders it, the "Reportar perdida" button is absent, and the status dropdown offers `adopted`.

- [ ] **Step 5: Run tests**

Run: `cd frontend/packages/web && pnpm vitest run MyPetsPage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/web/src/pages/MyPetsPage.tsx frontend/packages/web/src/pages/MyPetsPage.test.tsx
git commit -m "feat(web): add En adopción profile tab with adoption-specific actions"
```

---

### Task W7: Phase 2 verification + PR

- [ ] **Step 1: Full web test + build**

Run: `cd frontend/packages/web && pnpm test:run && pnpm build`
Expected: all green (includes the shared vitest config per rule #14).

- [ ] **Step 2: Manual smoke**

`pnpm dev`: publish an adoption pet → appears in `/adopt` and in the profile "En adopción" tab → mark adopted → disappears from `/adopt`. Confirm no raw i18n keys in es/en/pt.

- [ ] **Step 3: Open the Phase 2 PR** (searchpet-pr skill). Title: "feat(web): adoption listings — Adoptar section, publish step, profile tab".

---

# PHASE 3 — MOBILE

> Depends on Phase 2's shared changes (types/hooks/client) being merged. Branch `feat/pet-adoption-mobile`.

### Task M1: Mobile i18n keys

**Files:**
- Modify: the mobile i18n bundles for es/en/pt (find via grep `i18n` under `frontend/packages/mobile`)

- [ ] **Step 1: Add the same keys as web**

Add `pets:status.adoption` / `pets:status.adopted` labels and the `adoption` namespace keys (section/publish/profile) to the mobile es/en/pt bundles, following the mobile i18n setup. Same key set across the three languages.

- [ ] **Step 2: Verify**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/packages/mobile
git commit -m "feat(mobile): add adoption i18n keys (es/en/pt)"
```

---

### Task M2: Mobile publish — adoption intent + step

**Files:**
- Create: `frontend/packages/mobile/components/publish/AdoptionFormStep.tsx`
- Modify: the mobile publish screen (`PostScreen` in `app/(tabs)/post.tsx`)

- [ ] **Step 1: Build the step**

Create `AdoptionFormStep.tsx` modeled on the mobile `StrayFormStep.tsx`, with a city `TextInput` and no location step. On submit: `useCreatePet().mutate({ ..., city, status: 'adoption' })` + photo upload via `useUploadPhotoNative` (mirror StrayFormStep).

- [ ] **Step 2: Add the intent option + step**

In `PostScreen`, add the "Doy en adopción" intent option and render `<AdoptionFormStep/>` for that branch (mirror how the stray intent renders `StrayFormStep`).

- [ ] **Step 3: Verify**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit && pnpm test:run`
Expected: green. (If `post`/`PostScreen` has a smoke test, add `useCreatePet`/`useUploadPhotoNative` to its `@shared/hooks` mock per rule #17.)

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/mobile/components/publish/AdoptionFormStep.tsx "frontend/packages/mobile/app/(tabs)/post.tsx"
git commit -m "feat(mobile): add adoption intent and form step to publish flow"
```

---

### Task M3: Mobile Adoptar screen + entry point

**Files:**
- Create: `frontend/packages/mobile/app/adopt.tsx`
- Modify: an entry point (home header or profile menu) to navigate to `/adopt`

- [ ] **Step 1: Build the screen**

Create `app/adopt.tsx`: `useAdoptions({ city, type })`, a city `TextInput` filter + type filter, a list of `PetCard` (reuse the existing mobile `PetCard` component) with the "En adopción" badge, empty state, loading state. Tapping a card navigates to `pet/[id]`.

- [ ] **Step 2: Add the entry point**

Add an "Adoptar" entry to the profile menu (or a home header button) that routes to `/adopt`. Do NOT add a 6th bottom tab (design decision — avoid overcrowding the tab bar).

- [ ] **Step 3: Verify**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit && pnpm test:run`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/mobile/app/adopt.tsx frontend/packages/mobile/app/(tabs)/profile.tsx
git commit -m "feat(mobile): add Adoptar screen and profile entry point"
```

---

### Task M4: Mobile profile "En adopción" tab + Phase 3 PR

**Files:**
- Modify: `frontend/packages/mobile/app/my-pets.tsx`

- [ ] **Step 1: Add the third tab**

Mirror the web change: split `useMyPets` results into owned-non-adoption and adoption; add an "En adopción" tab (`t('adoption:section.title')`) showing adoption/adopted pets with a "Marcar adoptado" action (status change to `adopted` via `useUpdatePet`) and Edit; hide the lost-report action for adoption pets.

- [ ] **Step 2: Verify**

Run: `cd frontend/packages/mobile && pnpm tsc --noEmit && pnpm test:run`
Expected: green (update the my-pets smoke test mock for any new hook per rule #17).

- [ ] **Step 3: Commit + PR**

```bash
git add frontend/packages/mobile/app/my-pets.tsx
git commit -m "feat(mobile): add En adopción tab to my pets"
```

Open the Phase 3 PR (searchpet-pr skill). Title: "feat(mobile): adoption listings — publish step, Adoptar screen, profile tab".

---

## Notes for the implementer

- **Isolation is the invariant.** Never add `adoption`/`adopted` to `FeedVisibleStatuses`, `MapVisibleStatuses`, or `PublicSearchableStatuses`. The B1 and B6 tests guard this — if you break it, they fail.
- **i18n discipline (rule #21):** every web namespace must be registered in `web/src/i18n/index.ts`. Every new string in es/en/pt with identical key sets. No hardcoded Spanish in code.
- **Rule #22:** `UpdatePetRequest.city` is a pointer/optional so it can be cleared; the edit form sends `""` (not `undefined`) to clear.
- **Rule #13:** status badges always use `t('pets:status.<status>')` — never hardcode "En adopción".
- **Rule #14 / #17:** shared tests run via `vitest.shared.config.ts`; mobile uses `pnpm test:run` (never `pnpm test`, which watches).
