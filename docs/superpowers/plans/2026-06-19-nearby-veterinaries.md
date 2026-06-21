# Nearby Veterinaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any user reveal nearby veterinary clinics on the map, sourced from OpenStreetMap imported into a PostGIS table.

**Architecture:** A `cmd/import-vets` batch job pulls `amenity=veterinary` POIs for Uruguay from the Overpass API and upserts them into a `vets` table. A public `GET /api/vets/nearby` endpoint serves them with PostGIS `ST_DWithin`/`ST_Distance`, reusing the `reports` nearby pattern. The map screens (web Leaflet, mobile MapLibreGL) gain a vet layer toggle with a "buscar en esta zona" trigger and a detail sheet.

**Tech Stack:** Go 1.25 + Gin + GORM + PostGIS; React + Leaflet (web); React Native + MapLibreGL (mobile); React Query + shared TS package.

**Spec:** `docs/superpowers/specs/2026-06-19-nearby-veterinaries-design.md`

**Suggested PR boundary (chained):** Phases A–C = backend PR; Phases D–F = frontend PR. Backend ships and is independently testable first.

---

## File Structure

**Backend (create):**
- `backend/internal/domain/vet.go` — `Vet` model + `VetNearbyResult`
- `backend/internal/repository/vet_repository.go` — interface impl (`Upsert`, `FindNearby`)
- `backend/internal/service/vet_service.go` — `VetService` (radius clamp + query)
- `backend/internal/dto/vet_dto.go` — `VetResponse` + mappers
- `backend/internal/handler/vet_handler.go` — `GetNearby`
- `backend/internal/osmimport/importer.go` — Overpass fetch + element→Vet mapping + upsert loop
- `backend/cmd/import-vets/main.go` — thin CLI wrapper
- Tests: `backend/tests/vet_repository_test.go`, `backend/internal/service/vet_service_test.go`, `backend/tests/vet_handler_test.go`, `backend/internal/osmimport/importer_test.go`

**Backend (modify):**
- `backend/internal/repository/interfaces.go` — add `VetRepository` interface
- `backend/pkg/database/postgres.go` — register `&domain.Vet{}` in `migrate()`
- `backend/tests/testdb/setup.go` — add `&domain.Vet{}` to `allModels`
- `backend/internal/app/router.go` — wire repo/service/handler + public route

**Frontend (create):** none beyond i18n keys.

**Frontend (modify):**
- `frontend/packages/shared/types/index.ts` — `Vet`, `VetsNearbyParams`
- `frontend/packages/shared/api/client.ts` — `getNearbyVets`
- `frontend/packages/shared/hooks/index.ts` — `useNearbyVets`
- `frontend/packages/shared/hooks/index.test.ts` — hook test
- `frontend/packages/web/src/pages/MapPage.tsx` — vet layer
- `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` — `vets` keys (or `map` keys)
- `frontend/packages/mobile/app/(tabs)/map.tsx` — vet layer
- `frontend/packages/mobile/__tests__/map.test.tsx` — add `useNearbyVets` to the `@shared/hooks` mock
- `frontend/packages/mobile/i18n/locales/{es,en,pt}.json` — `vets`/`map` keys

---

# PHASE A — Backend domain + repository

### Task 1: `Vet` domain model + AutoMigrate registration

**Files:**
- Create: `backend/internal/domain/vet.go`
- Modify: `backend/pkg/database/postgres.go` (the `migrate()` model list, ~line 114)
- Modify: `backend/tests/testdb/setup.go` (the `allModels` slice)

- [ ] **Step 1: Create the model**

`backend/internal/domain/vet.go`:

```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Vet is a veterinary clinic imported from OpenStreetMap (amenity=veterinary).
// The natural key (OSMType, OSMID) makes the import idempotent. Geography is
// built on the fly in the nearby query, so no PostGIS column type is needed.
type Vet struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OSMType      string    `gorm:"size:8;not null;uniqueIndex:idx_vets_osm,priority:1" json:"-"`
	OSMID        int64     `gorm:"not null;uniqueIndex:idx_vets_osm,priority:2" json:"-"`
	Name         string    `gorm:"size:255" json:"name"`
	Latitude     float64   `gorm:"type:double precision;not null;index" json:"latitude"`
	Longitude    float64   `gorm:"type:double precision;not null;index" json:"longitude"`
	Address      string    `gorm:"size:500" json:"address,omitempty"`
	Phone        string    `gorm:"size:50" json:"phone,omitempty"`
	Website      string    `gorm:"size:500" json:"website,omitempty"`
	OpeningHours string    `gorm:"size:255" json:"opening_hours,omitempty"`
	Source       string    `gorm:"size:20;default:'osm'" json:"-"`
	LastSyncedAt time.Time `json:"-"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"-"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"-"`
}

// VetNearbyResult is a Vet plus its computed distance from the query point.
type VetNearbyResult struct {
	Vet
	DistanceMeters float64 `gorm:"column:distance_meters" json:"distance_meters"`
}
```

- [ ] **Step 2: Register in AutoMigrate**

In `backend/pkg/database/postgres.go`, add `&domain.Vet{},` to the `db.AutoMigrate(...)` list inside `migrate()` (after `&domain.UserReview{},`).

- [ ] **Step 3: Register in the test DB model list**

In `backend/tests/testdb/setup.go`, add `&domain.Vet{},` to the `allModels` slice (same list as `migrate()`).

- [ ] **Step 4: Build to verify it compiles**

Run: `cd backend && go build ./...`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/domain/vet.go backend/pkg/database/postgres.go backend/tests/testdb/setup.go
git commit -m "feat(vets): add Vet domain model + AutoMigrate registration"
```

---

### Task 2: `VetRepository` — Upsert + FindNearby

**Files:**
- Modify: `backend/internal/repository/interfaces.go`
- Create: `backend/internal/repository/vet_repository.go`
- Test: `backend/tests/vet_repository_test.go`

> PostGIS repo tests run against the Docker test DB (PostGIS on :5433). Start it
> the same way the existing `tests/` PostGIS tests run before this task. Mirror
> the exact `testdb.SetupTestDB(t)` usage in `tests/shelter_repository_test.go`
> (adapt if its signature returns a cleanup func).

- [ ] **Step 1: Write the failing test**

`backend/tests/vet_repository_test.go`:

```go
package tests

import (
	"context"
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func seedVet(t *testing.T, repo repository.VetRepository, osmID int64, name string, lat, lng float64) {
	t.Helper()
	err := repo.Upsert(context.Background(), &domain.Vet{
		OSMType:      "node",
		OSMID:        osmID,
		Name:         name,
		Latitude:     lat,
		Longitude:    lng,
		Source:       "osm",
		LastSyncedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("seed vet %q: %v", name, err)
	}
}

func TestVetRepository_FindNearby_FiltersAndOrdersByDistance(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	// Montevideo center.
	const lat, lng = -34.9011, -56.1645
	seedVet(t, repo, 1, "Close", lat+0.001, lng+0.001)  // ~150 m
	seedVet(t, repo, 2, "Mid", lat+0.02, lng+0.02)      // ~3 km
	seedVet(t, repo, 3, "Far", lat+0.5, lng+0.5)        // ~70 km — outside 5 km

	results, err := repo.FindNearby(context.Background(), lat, lng, 5000, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 vets within 5km, got %d", len(results))
	}
	if results[0].Name != "Close" || results[1].Name != "Mid" {
		t.Errorf("expected distance order [Close, Mid], got [%s, %s]", results[0].Name, results[1].Name)
	}
	if results[0].DistanceMeters <= 0 || results[0].DistanceMeters > results[1].DistanceMeters {
		t.Errorf("distance not populated/ordered: %v vs %v", results[0].DistanceMeters, results[1].DistanceMeters)
	}
}

func TestVetRepository_Upsert_IsIdempotentByOSMKey(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	const lat, lng = -34.9011, -56.1645
	seedVet(t, repo, 42, "Original", lat, lng)
	seedVet(t, repo, 42, "Renamed", lat, lng) // same osm_type+osm_id → update, not insert

	results, err := repo.FindNearby(context.Background(), lat, lng, 1000, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 vet after re-upsert, got %d", len(results))
	}
	if results[0].Name != "Renamed" {
		t.Errorf("expected updated name 'Renamed', got %q", results[0].Name)
	}
}
```

- [ ] **Step 2: Add the interface**

In `backend/internal/repository/interfaces.go`, add:

```go
// VetRepository persiste y consulta veterinarias importadas de OSM.
type VetRepository interface {
	Upsert(ctx context.Context, vet *domain.Vet) error
	FindNearby(ctx context.Context, lat, lng, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error)
}
```

(Confirm `context` and `domain` are already imported in this file — they are, used by other interfaces.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestVetRepository -v`
Expected: FAIL — `repository.NewVetRepository` undefined.

- [ ] **Step 4: Implement the repository**

`backend/internal/repository/vet_repository.go`:

```go
package repository

import (
	"context"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
)

type postgresVetRepository struct {
	db *gorm.DB
}

// NewVetRepository construye un VetRepository respaldado por PostgreSQL/PostGIS.
func NewVetRepository(db *gorm.DB) VetRepository {
	return &postgresVetRepository{db: db}
}

// Upsert inserta una veterinaria o la actualiza si ya existe (mismo osm_type+osm_id).
// Hace idempotente la importación: re-correr el import nunca duplica filas.
func (r *postgresVetRepository) Upsert(ctx context.Context, vet *domain.Vet) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "osm_type"}, {Name: "osm_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"name", "latitude", "longitude", "address",
				"phone", "website", "opening_hours", "last_synced_at", "updated_at",
			}),
		}).
		Create(vet).Error
}

// FindNearby retorna las veterinarias dentro de radiusMeters, ordenadas por
// distancia ascendente, con la distancia exacta en metros. Mismo patrón PostGIS
// que ReportRepository.FindNearby (ST_DWithin para filtrar, ST_Distance para ordenar).
func (r *postgresVetRepository) FindNearby(ctx context.Context, lat, lng, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error) {
	var results []domain.VetNearbyResult

	// float64 embebido directamente (no user-controlled text → sin riesgo de inyección);
	// gorm.Expr con ? params puede perder el ORDER BY en expresiones PostGIS.
	distExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography)",
		lng, lat,
	)

	err := r.db.WithContext(ctx).
		Model(&domain.Vet{}).
		Select("vets.*, "+distExpr+" AS distance_meters").
		Where(
			"ST_DWithin(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)",
			lng, lat, radiusMeters,
		).
		Order(distExpr + " ASC").
		Limit(limit).
		Scan(&results).Error

	return results, err
}

var _ VetRepository = (*postgresVetRepository)(nil)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestVetRepository -v`
Expected: PASS (both subtests).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/vet_repository.go backend/tests/vet_repository_test.go
git commit -m "feat(vets): add VetRepository with PostGIS nearby + idempotent upsert"
```

---

# PHASE B — Backend service + API

### Task 3: `VetService` — radius clamp + query

**Files:**
- Create: `backend/internal/service/vet_service.go`
- Test: `backend/internal/service/vet_service_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/service/vet_service_test.go`:

```go
package service_test

import (
	"context"
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

type mockVetRepo struct {
	gotRadius float64
	gotLimit  int
}

func (m *mockVetRepo) Upsert(_ context.Context, _ *domain.Vet) error { return nil }
func (m *mockVetRepo) FindNearby(_ context.Context, _, _, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error) {
	m.gotRadius = radiusMeters
	m.gotLimit = limit
	return []domain.VetNearbyResult{}, nil
}

func TestVetService_FindNearby_DefaultsRadiusWhenZero(t *testing.T) {
	repo := &mockVetRepo{}
	svc := service.NewVetService(repo)

	_, err := svc.FindNearby(context.Background(), -34.9, -56.1, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.gotRadius != 5000 {
		t.Errorf("default radius = %v, want 5000", repo.gotRadius)
	}
	if repo.gotLimit != 50 {
		t.Errorf("limit = %d, want 50", repo.gotLimit)
	}
}

func TestVetService_FindNearby_ClampsRadiusToMax(t *testing.T) {
	repo := &mockVetRepo{}
	svc := service.NewVetService(repo)

	_, err := svc.FindNearby(context.Background(), -34.9, -56.1, 999999)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.gotRadius != 50000 {
		t.Errorf("clamped radius = %v, want 50000", repo.gotRadius)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/service/ -run TestVetService -v`
Expected: FAIL — `service.NewVetService` undefined.

- [ ] **Step 3: Implement the service**

`backend/internal/service/vet_service.go`:

```go
package service

import (
	"context"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

const (
	defaultVetRadiusMeters = 5000
	maxVetRadiusMeters     = 50000
	vetResultLimit         = 50
)

// VetService define la lógica de negocio para veterinarias cercanas.
type VetService interface {
	FindNearby(ctx context.Context, lat, lng float64, radiusMeters int) ([]domain.VetNearbyResult, error)
}

type vetService struct {
	repo repository.VetRepository
}

// NewVetService construye el VetService con su repositorio.
func NewVetService(repo repository.VetRepository) VetService {
	return &vetService{repo: repo}
}

// FindNearby normaliza el radio (default/clamp) y delega la query geográfica al repo.
func (s *vetService) FindNearby(ctx context.Context, lat, lng float64, radiusMeters int) ([]domain.VetNearbyResult, error) {
	if radiusMeters <= 0 {
		radiusMeters = defaultVetRadiusMeters
	}
	if radiusMeters > maxVetRadiusMeters {
		radiusMeters = maxVetRadiusMeters
	}
	return s.repo.FindNearby(ctx, lat, lng, float64(radiusMeters), vetResultLimit)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/service/ -run TestVetService -v`
Expected: PASS (both subtests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/service/vet_service.go backend/internal/service/vet_service_test.go
git commit -m "feat(vets): add VetService with radius clamp"
```

---

### Task 4: `VetDTO` + `VetHandler`

**Files:**
- Create: `backend/internal/dto/vet_dto.go`
- Create: `backend/internal/handler/vet_handler.go`
- Test: `backend/tests/vet_handler_test.go`

- [ ] **Step 1: Create the DTO**

`backend/internal/dto/vet_dto.go`:

```go
package dto

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// VetResponse son los datos públicos de una veterinaria devueltos al cliente.
type VetResponse struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	Address        string    `json:"address,omitempty"`
	Phone          string    `json:"phone,omitempty"`
	Website        string    `json:"website,omitempty"`
	OpeningHours   string    `json:"opening_hours,omitempty"`
	DistanceMeters float64   `json:"distance_meters"`
}

// ToVetResponse convierte un VetNearbyResult de dominio en su DTO.
func ToVetResponse(r domain.VetNearbyResult) VetResponse {
	return VetResponse{
		ID:             r.ID,
		Name:           r.Name,
		Latitude:       r.Latitude,
		Longitude:      r.Longitude,
		Address:        r.Address,
		Phone:          r.Phone,
		Website:        r.Website,
		OpeningHours:   r.OpeningHours,
		DistanceMeters: r.DistanceMeters,
	}
}

// ToVetListResponse convierte un slice de resultados. Siempre retorna slice
// inicializado (nunca nil) para que JSON serialice [] en vez de null.
func ToVetListResponse(rs []domain.VetNearbyResult) []VetResponse {
	out := make([]VetResponse, len(rs))
	for i, r := range rs {
		out[i] = ToVetResponse(r)
	}
	return out
}
```

- [ ] **Step 2: Write the failing handler test**

`backend/tests/vet_handler_test.go`:

```go
package tests

import (
	"context"
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

type stubVetService struct {
	result []domain.VetNearbyResult
	called bool
}

func (s *stubVetService) FindNearby(_ context.Context, _, _ float64, _ int) ([]domain.VetNearbyResult, error) {
	s.called = true
	return s.result, nil
}

func setupVetRouter(svc *stubVetService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewVetHandler(svc)
	r.GET("/api/vets/nearby", h.GetNearby)
	return r
}

func TestVetHandler_GetNearby_HappyPath(t *testing.T) {
	svc := &stubVetService{result: []domain.VetNearbyResult{
		{Vet: domain.Vet{ID: uuid.New(), Name: "Puntovet"}, DistanceMeters: 123.4},
	}}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby?lat=-34.9&lng=-56.1&radius=5000", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var body []dto.VetResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad body: %v", err)
	}
	if len(body) != 1 || body[0].Name != "Puntovet" || body[0].DistanceMeters != 123.4 {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestVetHandler_GetNearby_InvalidCoords(t *testing.T) {
	svc := &stubVetService{}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby?lat=999&lng=-56.1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid coords, got %d", w.Code)
	}
	if svc.called {
		t.Error("service should not be called on invalid coords")
	}
}

func TestVetHandler_GetNearby_MissingParams(t *testing.T) {
	svc := &stubVetService{}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing lat/lng, got %d", w.Code)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && go test ./tests/ -run TestVetHandler -v`
Expected: FAIL — `handler.NewVetHandler` undefined.

- [ ] **Step 4: Implement the handler**

`backend/internal/handler/vet_handler.go`:

```go
package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// VetHandler maneja los endpoints HTTP de veterinarias.
type VetHandler struct {
	vetService service.VetService
}

// NewVetHandler construye el VetHandler con su servicio.
func NewVetHandler(vetService service.VetService) *VetHandler {
	return &VetHandler{vetService: vetService}
}

// GetNearby godoc
// GET /api/vets/nearby?lat={lat}&lng={lng}&radius={meters}   (público, sin auth)
func (h *VetHandler) GetNearby(c *gin.Context) {
	lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
	lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
	if errLat != nil || errLng != nil || !validCoordinates(lat, lng) {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	radius := 0
	if rs := c.Query("radius"); rs != "" {
		if r, err := strconv.Atoi(rs); err == nil {
			radius = r
		}
	}

	vets, err := h.vetService.FindNearby(c.Request.Context(), lat, lng, radius)
	if err != nil {
		writeError(c, http.StatusInternalServerError, domain.ErrInternal)
		return
	}

	c.JSON(http.StatusOK, dto.ToVetListResponse(vets))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && go test ./tests/ -run TestVetHandler -v`
Expected: PASS (all three subtests).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/dto/vet_dto.go backend/internal/handler/vet_handler.go backend/tests/vet_handler_test.go
git commit -m "feat(vets): add VetHandler + DTO for GET /api/vets/nearby"
```

---

### Task 5: Wire the route into the router

**Files:**
- Modify: `backend/internal/app/router.go`

- [ ] **Step 1: Add repository + service (CAPA 3 / CAPA 2 sections)**

After `shelterRepo := repository.NewShelterRepository(db)` (~line 83), add:

```go
	vetRepo := repository.NewVetRepository(db)
```

After `shelterService := service.NewShelterService(shelterRepo)` (~line 100), add:

```go
	vetService := service.NewVetService(vetRepo)
```

- [ ] **Step 2: Add the handler (CAPA 1 section)**

After `shelterHandler := handler.NewShelterHandler(shelterService)` (~line 178), add:

```go
	vetHandler := handler.NewVetHandler(vetService)
```

- [ ] **Step 3: Register the public route**

In the `public := router.Group("/api")` block, next to the `shelters` routes (~line 232), add:

```go
		public.GET("/vets/nearby", vetHandler.GetNearby)
```

- [ ] **Step 4: Build + run the full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: build clean; all packages PASS (PostGIS test DB must be up for `tests/`).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/app/router.go
git commit -m "feat(vets): wire public GET /api/vets/nearby route"
```

---

# PHASE C — Import command

### Task 6: `osmimport` package — Overpass fetch + element mapping

**Files:**
- Create: `backend/internal/osmimport/importer.go`
- Test: `backend/internal/osmimport/importer_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/osmimport/importer_test.go`:

```go
package osmimport

import (
	"testing"
)

func TestMapElement_NodeWithTags(t *testing.T) {
	el := overpassElement{
		Type: "node", ID: 100, Lat: -34.9, Lon: -56.1,
		Tags: map[string]string{
			"name":          "Puntovet",
			"addr:street":   "Av. Brasil",
			"addr:housenumber": "2500",
			"phone":         "+598 2 700 0000",
			"opening_hours": "Mo-Fr 09:00-18:00",
		},
	}
	vet, ok := mapElement(el)
	if !ok {
		t.Fatal("expected ok=true for a node with coords")
	}
	if vet.OSMType != "node" || vet.OSMID != 100 {
		t.Errorf("bad natural key: %s/%d", vet.OSMType, vet.OSMID)
	}
	if vet.Name != "Puntovet" {
		t.Errorf("name = %q", vet.Name)
	}
	if vet.Address != "Av. Brasil 2500" {
		t.Errorf("address = %q, want 'Av. Brasil 2500'", vet.Address)
	}
	if vet.Phone != "+598 2 700 0000" {
		t.Errorf("phone = %q", vet.Phone)
	}
	if vet.Source != "osm" || vet.LastSyncedAt.IsZero() {
		t.Errorf("source/last_synced not set: %q %v", vet.Source, vet.LastSyncedAt)
	}
}

func TestMapElement_WayUsesCenter(t *testing.T) {
	el := overpassElement{
		Type: "way", ID: 200,
		Center: &overpassCenter{Lat: -34.8, Lon: -56.2},
		Tags:   map[string]string{"name": "Clinic"},
	}
	vet, ok := mapElement(el)
	if !ok {
		t.Fatal("expected ok=true for a way with center")
	}
	if vet.Latitude != -34.8 || vet.Longitude != -56.2 {
		t.Errorf("way center not used: %v,%v", vet.Latitude, vet.Longitude)
	}
}

func TestMapElement_SkipsMissingCoords(t *testing.T) {
	el := overpassElement{Type: "way", ID: 300, Tags: map[string]string{"name": "NoGeo"}}
	if _, ok := mapElement(el); ok {
		t.Error("expected ok=false when no coords available")
	}
}

func TestMapElement_PhoneFallbackToContactTag(t *testing.T) {
	el := overpassElement{
		Type: "node", ID: 400, Lat: -34.9, Lon: -56.1,
		Tags: map[string]string{"contact:phone": "099 123 456", "contact:website": "https://x.uy"},
	}
	vet, _ := mapElement(el)
	if vet.Phone != "099 123 456" {
		t.Errorf("phone fallback failed: %q", vet.Phone)
	}
	if vet.Website != "https://x.uy" {
		t.Errorf("website fallback failed: %q", vet.Website)
	}
}

func TestParseOverpass_DecodesElements(t *testing.T) {
	body := []byte(`{"elements":[
		{"type":"node","id":1,"lat":-34.9,"lon":-56.1,"tags":{"name":"A"}},
		{"type":"way","id":2,"center":{"lat":-34.8,"lon":-56.2},"tags":{"name":"B"}}
	]}`)
	els, err := parseOverpass(body)
	if err != nil {
		t.Fatalf("parseOverpass: %v", err)
	}
	if len(els) != 2 {
		t.Fatalf("expected 2 elements, got %d", len(els))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/osmimport/ -v`
Expected: FAIL — undefined `overpassElement`, `mapElement`, etc.

- [ ] **Step 3: Implement the package**

`backend/internal/osmimport/importer.go`:

```go
// Package osmimport fetches veterinary POIs from the OpenStreetMap Overpass API
// and upserts them into the vets table. It is a one-off, idempotent batch job
// (see cmd/import-vets). Querying Overpass is rate-respectful: a handful of
// requests per run, never per user request.
package osmimport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
)

// DefaultOverpassEndpoint is the public Overpass API interpreter.
const DefaultOverpassEndpoint = "https://overpass-api.de/api/interpreter"

// uruguayVetQuery selects every amenity=veterinary node/way inside Uruguay.
// `out center tags` gives ways a representative lat/lng.
const uruguayVetQuery = `[out:json][timeout:120];
area["ISO3166-1"="UY"][admin_level=2]->.uy;
(
  node["amenity"="veterinary"](area.uy);
  way["amenity"="veterinary"](area.uy);
);
out center tags;`

type overpassCenter struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type overpassElement struct {
	Type   string            `json:"type"`
	ID     int64             `json:"id"`
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center *overpassCenter   `json:"center"`
	Tags   map[string]string `json:"tags"`
}

type overpassResponse struct {
	Elements []overpassElement `json:"elements"`
}

// Result summarizes an import run.
type Result struct {
	Scanned  int
	Upserted int
	Skipped  int
}

// Importer pulls OSM vets and upserts them via the repository.
type Importer struct {
	repo       repository.VetRepository
	httpClient *http.Client
	endpoint   string
	logger     *zap.Logger
}

// New builds an Importer. Pass DefaultOverpassEndpoint unless overriding for tests.
func New(db *gorm.DB, client *http.Client, endpoint string) *Importer {
	logger, _ := zap.NewProduction()
	return &Importer{
		repo:       repository.NewVetRepository(db),
		httpClient: client,
		endpoint:   endpoint,
		logger:     logger,
	}
}

// Run fetches Uruguay vets from Overpass and upserts each into the vets table.
func (i *Importer) Run(ctx context.Context) (Result, error) {
	var res Result

	body, err := i.fetch(ctx)
	if err != nil {
		return res, err
	}
	elements, err := parseOverpass(body)
	if err != nil {
		return res, err
	}

	for _, el := range elements {
		res.Scanned++
		vet, ok := mapElement(el)
		if !ok {
			res.Skipped++
			continue
		}
		if err := i.repo.Upsert(ctx, vet); err != nil {
			i.logger.Warn("[osmimport] upsert failed",
				zap.String("osm_type", vet.OSMType), zap.Int64("osm_id", vet.OSMID), zap.Error(err))
			res.Skipped++
			continue
		}
		res.Upserted++
	}

	i.logger.Info("[osmimport] done",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted), zap.Int("skipped", res.Skipped))
	return res, nil
}

// fetch POSTs the Overpass QL query and returns the raw response body.
func (i *Importer) fetch(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, i.endpoint, strings.NewReader("data="+uruguayVetQuery))
	if err != nil {
		return nil, fmt.Errorf("osmimport: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := i.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("osmimport: overpass request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("osmimport: overpass returned %d: %s", resp.StatusCode, string(b))
	}
	return io.ReadAll(resp.Body)
}

func parseOverpass(body []byte) ([]overpassElement, error) {
	var parsed overpassResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("osmimport: parse response: %w", err)
	}
	return parsed.Elements, nil
}

// mapElement converts an Overpass element into a domain.Vet. Returns ok=false
// when no usable coordinates are present (e.g. a way without a center).
func mapElement(el overpassElement) (*domain.Vet, bool) {
	lat, lng := el.Lat, el.Lon
	if lat == 0 && lng == 0 && el.Center != nil {
		lat, lng = el.Center.Lat, el.Center.Lon
	}
	if lat == 0 && lng == 0 {
		return nil, false
	}

	tags := el.Tags
	if tags == nil {
		tags = map[string]string{}
	}

	phone := firstNonEmpty(tags["phone"], tags["contact:phone"])
	website := firstNonEmpty(tags["website"], tags["contact:website"])

	return &domain.Vet{
		OSMType:      el.Type,
		OSMID:        el.ID,
		Name:         tags["name"],
		Latitude:     lat,
		Longitude:    lng,
		Address:      composeAddress(tags),
		Phone:        phone,
		Website:      website,
		OpeningHours: tags["opening_hours"],
		Source:       "osm",
		LastSyncedAt: time.Now(),
	}, true
}

func composeAddress(tags map[string]string) string {
	street := tags["addr:street"]
	num := tags["addr:housenumber"]
	switch {
	case street != "" && num != "":
		return street + " " + num
	case street != "":
		return street
	default:
		return ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/osmimport/ -v`
Expected: PASS (all subtests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/osmimport/
git commit -m "feat(vets): add osmimport package (Overpass fetch + element mapping)"
```

---

### Task 7: `cmd/import-vets` CLI wrapper

**Files:**
- Create: `backend/cmd/import-vets/main.go`

- [ ] **Step 1: Implement the command**

`backend/cmd/import-vets/main.go`:

```go
// Command import-vets pulls amenity=veterinary POIs for Uruguay from the OSM
// Overpass API and upserts them into the vets table. Idempotent: first run seeds,
// later runs refresh. Run manually against DATABASE_URL when a refresh is wanted.
package main

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/internal/domain"
	"lost-pets/internal/osmimport"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
)

func main() {
	cfg := config.Load()
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("import-vets: DB connect failed", zap.Error(err))
	}

	// Ensure the table exists when run against a fresh DB (server AutoMigrate
	// normally creates it, but the command must be self-sufficient).
	if err := db.AutoMigrate(&domain.Vet{}); err != nil {
		log.Fatal("import-vets: AutoMigrate failed", zap.Error(err))
	}

	imp := osmimport.New(db, &http.Client{Timeout: 150 * time.Second}, osmimport.DefaultOverpassEndpoint)

	res, err := imp.Run(context.Background())
	if err != nil {
		log.Fatal("import-vets: run failed", zap.Error(err))
	}

	log.Info("import-vets: completed",
		zap.Int("scanned", res.Scanned),
		zap.Int("upserted", res.Upserted),
		zap.Int("skipped", res.Skipped),
	)
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd backend && go build ./cmd/import-vets/`
Expected: no output (success).

- [ ] **Step 3: Manual smoke test (local DB)**

With a local Postgres/PostGIS up and `DATABASE_URL` exported:

Run: `cd backend && go run ./cmd/import-vets/`
Expected: log line `import-vets: completed` with `scanned` ~120+ and `upserted` > 0.
Verify: `curl "http://localhost:8081/api/vets/nearby?lat=-34.9011&lng=-56.1645&radius=15000"` returns a JSON array of vets with `distance_meters` ascending.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/import-vets/main.go
git commit -m "feat(vets): add cmd/import-vets idempotent OSM import command"
```

---

# PHASE D — Shared frontend

### Task 8: `Vet` type + client method + `useNearbyVets` hook

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`
- Modify: `frontend/packages/shared/api/client.ts`
- Modify: `frontend/packages/shared/hooks/index.ts`
- Test: `frontend/packages/shared/hooks/index.test.ts`

- [ ] **Step 1: Add types**

In `frontend/packages/shared/types/index.ts`, near `NearbySearchParams` (~line 253), add:

```ts
export interface Vet {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  phone?: string;
  website?: string;
  opening_hours?: string;
  distance_meters: number;
}

export interface VetsNearbyParams {
  lat: number;
  lng: number;
  radius?: number; // meters
}
```

- [ ] **Step 2: Add the client method**

In `frontend/packages/shared/api/client.ts`, add `Vet, VetsNearbyParams` to the type imports (near `NearbySearchParams`, ~line 35), then add a method after `getNearbyReports` (~line 483):

```ts
  async getNearbyVets(params: VetsNearbyParams): Promise<Vet[]> {
    const queryParams: Record<string, string | number> = {
      lat: params.lat,
      lng: params.lng,
    };
    if (params.radius) {
      queryParams['radius'] = params.radius;
    }
    return this.request<Vet[]>('GET', '/api/vets/nearby', undefined, queryParams);
  }
```

- [ ] **Step 3: Write the failing hook test**

In `frontend/packages/shared/hooks/index.test.ts`, add `useNearbyVets` to the hook imports (near `useNearbyReports`, ~line 22), then add a describe block at the end of the file:

```ts
// ============================================================
// useNearbyVets — passes radius in meters, gated by enabled.
// ============================================================
describe('useNearbyVets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls getNearbyVets with lat/lng/radius and exposes the array', async () => {
    const mockVet = {
      id: 'v1', name: 'Puntovet', latitude: -34.9, longitude: -56.1, distance_meters: 120,
    };
    const spy = vi.spyOn(apiClient, 'getNearbyVets').mockResolvedValue([mockVet]);

    const { result } = renderHook(() => useNearbyVets(-34.9, -56.1, 5000, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ lat: -34.9, lng: -56.1, radius: 5000 });
    expect(result.current.data).toEqual([mockVet]);
  });

  it('does not fire when disabled', async () => {
    const spy = vi.spyOn(apiClient, 'getNearbyVets').mockResolvedValue([]);

    renderHook(() => useNearbyVets(-34.9, -56.1, 5000, false), { wrapper });

    // enabled is false -> query stays idle, queryFn never runs.
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts -t useNearbyVets`
Expected: FAIL — `useNearbyVets` is not exported.

- [ ] **Step 5: Implement the hook**

In `frontend/packages/shared/hooks/index.ts`, add `Vet` to the type imports (near `NearbyReportsResponse`, ~line 17), then add after `useNearbyReports` (~line 312):

```ts
// radiusMeters en metros (default 5000). enabled=false por defecto: la query
// solo dispara cuando la UI lo activa ("buscar en esta zona" / toggle de capa).
export const useNearbyVets = (lat: number, lng: number, radiusMeters = 5000, enabled = false) => {
  return useQuery<Vet[]>({
    queryKey: ['vets', 'nearby', lat, lng, radiusMeters],
    queryFn: () => apiClient.getNearbyVets({ lat, lng, radius: radiusMeters }),
    enabled: enabled && !!lat && !!lng,
    staleTime: 30 * 60 * 1000, // 30 min — los vets casi no cambian
  });
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts -t useNearbyVets`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts frontend/packages/shared/hooks/index.ts frontend/packages/shared/hooks/index.test.ts
git commit -m "feat(vets): add Vet type, getNearbyVets client, useNearbyVets hook"
```

---

# PHASE E — Web UI (Leaflet)

### Task 9: Vet layer on `MapPage`

**Files:**
- Modify: `frontend/packages/web/src/pages/MapPage.tsx`
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json`

> No existing test covers `MapPage`; verify via build + manual check. Leaflet's
> `TileLayer` already renders the required OSM attribution on web.

- [ ] **Step 1: Add i18n keys**

In each of `es.json`, `en.json`, `pt.json` under `web/src/i18n/locales/`, add a `vets` namespace. Spanish (`es.json`):

```json
"vets": {
  "toggle": "Veterinarias",
  "searchArea": "Buscar en esta zona",
  "directions": "Cómo llegar",
  "call": "Llamar",
  "empty": "No hay veterinarias en esta zona",
  "defaultName": "Veterinaria",
  "attribution": "Datos de veterinarias © colaboradores de OpenStreetMap"
}
```

English (`en.json`): `"toggle":"Veterinaries"`, `"searchArea":"Search this area"`, `"directions":"Directions"`, `"call":"Call"`, `"empty":"No veterinaries in this area"`, `"defaultName":"Veterinary"`, `"attribution":"Veterinary data © OpenStreetMap contributors"`.
Portuguese (`pt.json`): `"toggle":"Veterinárias"`, `"searchArea":"Buscar nesta área"`, `"directions":"Como chegar"`, `"call":"Ligar"`, `"empty":"Não há veterinárias nesta área"`, `"defaultName":"Veterinária"`, `"attribution":"Dados de veterinárias © colaboradores do OpenStreetMap"`.

- [ ] **Step 2: Add the vet icon + imports**

At the top of `MapPage.tsx`, extend imports and add a blue vet icon next to the existing icons:

```ts
import { useNearbyReports, useNearbyVets } from '@shared/hooks';
import type { Report, Vet } from '@shared/types';
```

```ts
const vetIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
```

- [ ] **Step 3: Add vet state + hook**

Inside `MapPage`, after the existing `useNearbyReports` call (~line 47), add:

```ts
  const { t: tv } = useTranslation('vets');
  const [showVets, setShowVets] = useState(false);
  const { data: vets } = useNearbyVets(userLocation[0], userLocation[1], 5000, showVets);

  const directionsUrl = (lat: number, lng: number) =>
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
```

- [ ] **Step 4: Add the toggle control**

In the header controls `<div className="flex items-center gap-4 ...">` (~line 71), add a toggle button as the first child:

```tsx
          <button
            type="button"
            onClick={() => setShowVets((v) => !v)}
            className={`px-3 py-1 rounded-full text-sm font-semibold border transition-colors ${
              showVets
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
            }`}
          >
            🏥 {tv('toggle')}
          </button>
```

- [ ] **Step 5: Render vet markers + popups**

Inside `<MapContainer>`, after the reports `{reports?.map(...)}` block (~line 151), add:

```tsx
            {showVets && vets?.map((vet: Vet) => (
              <Marker key={`vet-${vet.id}`} position={[vet.latitude, vet.longitude]} icon={vetIcon}>
                <Popup>
                  <div className="min-w-48">
                    <h3 className="font-bold text-base">{vet.name || tv('defaultName')}</h3>
                    {vet.address && <p className="text-sm text-gray-600 mt-1">{vet.address}</p>}
                    <div className="flex gap-3 mt-2">
                      <a
                        href={directionsUrl(vet.latitude, vet.longitude)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary font-semibold hover:underline"
                      >
                        {tv('directions')} →
                      </a>
                      {vet.phone && (
                        <a href={`tel:${vet.phone}`} className="text-sm text-primary font-semibold hover:underline">
                          {tv('call')}
                        </a>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2">{tv('attribution')}</p>
                  </div>
                </Popup>
              </Marker>
            ))}
```

- [ ] **Step 6: Add the empty state**

After the reports empty-state block (~line 160), add:

```tsx
      {showVets && vets && vets.length === 0 && (
        <p className="text-center text-gray-500 dark:text-gray-400 mt-2 text-sm">{tv('empty')}</p>
      )}
```

- [ ] **Step 7: Build + manual verify**

Run: `cd frontend/packages/web && pnpm build`
Expected: build succeeds.
Manual: `pnpm dev`, open the map, toggle "🏥 Veterinarias" → blue vet pins appear; click one → name, address, "Cómo llegar" (opens maps) and "Llamar" (only when a phone exists).

- [ ] **Step 8: Commit**

```bash
git add frontend/packages/web/src/pages/MapPage.tsx frontend/packages/web/src/i18n/locales/
git commit -m "feat(vets): add veterinary layer to web map"
```

---

# PHASE F — Mobile UI (MapLibreGL)

### Task 10: Vet layer on the mobile map

**Files:**
- Modify: `frontend/packages/mobile/app/(tabs)/map.tsx`
- Modify: `frontend/packages/mobile/__tests__/map.test.tsx`
- Modify: `frontend/packages/mobile/i18n/locales/{es,en,pt}.json`

> The mobile map uses **MapLibreGL** (coordinates are `[longitude, latitude]`).
> `map.test.tsx` mocks `@shared/hooks` hook-by-hook, so the new hook MUST be
> added to that mock or the suite breaks (project rule #17).

- [ ] **Step 1: Add i18n keys**

In `mobile/i18n/locales/{es,en,pt}.json`, add the same keys used below under the `map` namespace (the mobile map screen uses `useTranslation('map')`):

`es.json` `map` block — add: `"vetsToggle": "Veterinarias"`, `"vetDirections": "Cómo llegar"`, `"vetCall": "Llamar"`, `"vetEmpty": "No hay veterinarias en esta zona"`, `"vetDefaultName": "Veterinaria"`, `"vetAttribution": "© colaboradores de OpenStreetMap"`.
`en.json`: `"vetsToggle":"Veterinaries"`, `"vetDirections":"Directions"`, `"vetCall":"Call"`, `"vetEmpty":"No veterinaries in this area"`, `"vetDefaultName":"Veterinary"`, `"vetAttribution":"© OpenStreetMap contributors"`.
`pt.json`: `"vetsToggle":"Veterinárias"`, `"vetDirections":"Como chegar"`, `"vetCall":"Ligar"`, `"vetEmpty":"Não há veterinárias nesta área"`, `"vetDefaultName":"Veterinária"`, `"vetAttribution":"© colaboradores do OpenStreetMap"`.

- [ ] **Step 2: Add the hook to the test mock + run to confirm green baseline**

In `frontend/packages/mobile/__tests__/map.test.tsx`, find the `@shared/hooks` mock and add `useNearbyVets: jest.fn(() => ({ data: [], isLoading: false })),` alongside the existing `useNearbyReports` mock entry.

Run: `cd frontend/packages/mobile && pnpm test:run map`
Expected: PASS (baseline still green before screen changes).

- [ ] **Step 3: Add imports + hook usage**

In `map.tsx`, extend the imports:

```ts
import { Linking } from 'react-native';
import { useNearbyReports, useNearbyVets } from '../../../shared/hooks';
import type { Report, Vet } from '../../../shared/types';
```

Inside `MapScreen`, after the `useNearbyReports` call (~line 89), add:

```ts
  const [showVets, setShowVets] = useState(false);
  const [selectedVet, setSelectedVet] = useState<Vet | null>(null);
  const { data: vets } = useNearbyVets(lat, lng, 5000, showVets);
```

- [ ] **Step 4: Render vet annotations**

Inside `<MapLibreGL.MapView>`, after the reports `{reports?.map(...)}` block (~line 189), add:

```tsx
          {showVets && vets?.map((vet) => (
            <MapLibreGL.PointAnnotation
              key={`vet-${vet.id}`}
              id={`vet-${vet.id}`}
              coordinate={[vet.longitude, vet.latitude]}
              onSelected={() => { setSelectedVet(vet); setSelectedReport(null); }}
            >
              <View style={[styles.marker, { backgroundColor: COLORS.primary }]} />
            </MapLibreGL.PointAnnotation>
          ))}
```

- [ ] **Step 5: Add the toggle button + vet detail card**

After the radius selector `<View style={styles.radiusSelector}>...</View>` (~line 205), add a toggle:

```tsx
        <TouchableOpacity
          style={[styles.vetToggle, showVets && styles.vetToggleActive]}
          onPress={() => setShowVets((v) => !v)}
        >
          <Text style={[styles.vetToggleText, showVets && styles.vetToggleTextActive]}>
            🏥 {t('vetsToggle')}
          </Text>
        </TouchableOpacity>
```

After the existing `{selectedReport && (...)}` card (~line 264), add the vet card:

```tsx
        {selectedVet && (
          <View style={styles.reportCard}>
            <Text style={styles.reportName}>{selectedVet.name || t('vetDefaultName')}</Text>
            {selectedVet.address ? <Text style={styles.reportDesc}>{selectedVet.address}</Text> : null}
            <View style={{ flexDirection: 'row', gap: SPACING.md }}>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${selectedVet.latitude},${selectedVet.longitude}`)
                }
              >
                <Text style={styles.reportAction}>{t('vetDirections')}</Text>
              </TouchableOpacity>
              {selectedVet.phone ? (
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedVet.phone}`)}>
                  <Text style={styles.reportAction}>{t('vetCall')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={{ fontSize: 10, color: COLORS.textSecondary, marginTop: 6 }}>{t('vetAttribution')}</Text>
          </View>
        )}
```

Also clear the vet selection on map background press — change the `MapView` `onPress` (~line 153) to:

```tsx
          onPress={() => { setSelectedReport(null); setSelectedVet(null); }}
```

- [ ] **Step 6: Add the toggle styles**

In the `StyleSheet.create({...})`, add:

```ts
  vetToggle: {
    position: 'absolute',
    bottom: 290,
    left: SPACING.lg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1.5,
    borderColor: COLORS.border || '#e5e7eb',
  },
  vetToggleActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  vetToggleText: { fontSize: FONTS.sizes.xs, fontWeight: '600', color: COLORS.textSecondary },
  vetToggleTextActive: { color: COLORS.white },
```

- [ ] **Step 7: Run the mobile test + typecheck**

Run: `cd frontend/packages/mobile && pnpm test:run map`
Expected: PASS (mock now includes `useNearbyVets`).
Run: `cd frontend/packages/mobile && pnpm exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add "frontend/packages/mobile/app/(tabs)/map.tsx" frontend/packages/mobile/__tests__/map.test.tsx frontend/packages/mobile/i18n/locales/
git commit -m "feat(vets): add veterinary layer to mobile map"
```

---

## Final Verification

- [ ] Backend: `cd backend && go build ./... && go test ./...` (PostGIS test DB up) — all green.
- [ ] Shared: `cd frontend/packages/web && pnpm vitest run --config vitest.shared.config.ts` — green.
- [ ] Web: `pnpm build` succeeds; manual map check passes.
- [ ] Mobile: `pnpm test:run` green; `tsc --noEmit` clean.
- [ ] Run `cmd/import-vets` against a local DB and confirm `/api/vets/nearby` returns ordered results.

## Notes / Deviations from Spec

- The mobile map uses **MapLibreGL**, not react-native-maps (the spec/CLAUDE.md
  reference was stale; spec corrected). Coordinates are `[lng, lat]`.
- "Buscar en esta zona" is implemented as the **layer toggle** triggering the
  fetch around the current center (the toggle is the search trigger for the MVP).
  A pan-triggered re-search button is a follow-up; the hook is already gated by
  `enabled`, so wiring a second trigger later needs no API change.
- No new error codes were needed: invalid coordinates reuse `ErrInvalidInput`.
