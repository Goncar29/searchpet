# Nearby report filters (map redesign, slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional `type`, `status`, `from` and `to` filters to `GET /api/reports/nearby` without changing its behaviour when they are absent.

**Architecture:** `FindNearby` swaps its three positional parameters for a `domain.NearbyReportCriteria` struct, following the `domain.PetSearchCriteria` precedent. The user's filters are applied as extra `WHERE` clauses **inside** the existing `MapVisibleStatuses` allowlist and episode scope, which stay unconditional. The handler parses and validates the query string; the service forwards.

**Tech Stack:** Go 1.25, Gin, GORM, PostgreSQL + PostGIS. Tests run against a real database via `tests/testdb`.

**Spec:** `docs/superpowers/specs/2026-08-10-map-redesign-design.md`

---

## Context an engineer needs before starting

**Run the tests like this, and read the exit code — never grep the output:**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -run TestReportRepository -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

`EXIT=0` is green; anything else, read the log. `-count=1` is mandatory (Go caches results and will print `ok (cached)` after you edit code). Without `DATABASE_URL`, `testdb.SetupTestDB` **skips silently** and a green run means nothing ran.

The database must be up: `docker compose up -d db` from the repo root. Note the host port is **5433**, not 5432.

**Two facts that shape the code:**

1. `domain.Report.OccurredAt` is `*time.Time` — **nullable**. The UI displays `occurred_at ?? created_at`. Date filters must therefore compare against `COALESCE(reports.occurred_at, reports.created_at)`, or every report without an explicit occurrence time silently disappears the moment a user picks a date range.
2. `dto.CreatePetRequest.Type` has no allowlist (`binding:"required"` only), so any string can be stored as a pet type. The filter introduces an allowlist that creation does not have. This is deliberate: the UI select offers exactly four values, so anything else is a malformed request. It does not change stored data.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/internal/domain/models.go` | `NearbyReportCriteria` struct, beside `PetSearchCriteria`. |
| `backend/internal/domain/pet_status.go` | `ValidPetTypes` + `IsValidPetType`, beside the other domain allowlists. |
| `backend/internal/repository/interfaces.go` | `FindNearby` signature. |
| `backend/internal/repository/report_repository.go` | The query. |
| `backend/internal/service/report_service.go` | Forwards the criteria. |
| `backend/internal/handler/report_handler.go` | Query-string parsing and validation. |
| `backend/tests/report_repository_test.go` | Repository-level tests, real Postgres. |
| `backend/tests/report_handler_test.go` | Handler-level validation tests. |

---

## Task 1: Criteria struct and signature change (no behaviour change)

**Files:**
- Modify: `backend/internal/domain/models.go` (after `PetSearchCriteria`, line ~31)
- Modify: `backend/internal/repository/interfaces.go:36`
- Modify: `backend/internal/repository/report_repository.go:98`
- Modify: `backend/internal/service/report_service.go:288`
- Modify: `backend/internal/handler/report_handler.go:200`
- Test: `backend/tests/report_repository_test.go`

- [ ] **Step 1: Write the characterisation test**

This is the backward-compatibility guarantee that lets this slice ship before any UI uses it. Append to `backend/tests/report_repository_test.go`:

```go
// Un criteria sin filtros tiene que devolver EXACTAMENTE lo que devolvía la
// firma vieja. Es la garantía que permite mergear y deployar esta rebanada
// sola, antes de que el frontend mande un solo parámetro nuevo.
func TestReportRepository_FindNearby_SinFiltrosDevuelveTodoLoVisible(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Lost Dog", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	report := &domain.Report{
		ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng,
	}
	if err := reportRepo.Create(report); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	got, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("esperaba 1 reporte sin filtros, obtuve %d", len(got))
	}
}
```

- [ ] **Step 2: Run it and watch it fail to compile**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -run TestReportRepository_FindNearby_SinFiltros -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero exit, `undefined: domain.NearbyReportCriteria`.

- [ ] **Step 3: Add the struct**

In `backend/internal/domain/models.go`, immediately after the closing brace of `PetSearchCriteria`:

```go
// NearbyReportCriteria son los criterios de búsqueda de reportes cercanos.
//
// Sigue el patrón de PetSearchCriteria: la firma con parámetros posicionales
// llegaba a siete argumentos, que es donde se empiezan a pasar al revés.
//
// IMPORTANTE: los campos de acá son SOLO los filtros que provee el usuario.
// La allowlist de visibilidad (MapVisibleStatuses) y el alcance del episodio
// NO viven acá: los aplica el repositorio siempre, pase lo que pase con este
// struct. Un filtro del usuario acota dentro de la allowlist, nunca la ensancha.
type NearbyReportCriteria struct {
	Lat          float64
	Lng          float64
	RadiusMeters float64

	// PetType filtra por pets.type. Vacío = sin filtro.
	PetType string

	// ReportStatuses filtra por reports.status (lost/found/sighting), que es
	// una columna DISTINTA de pets.status. Vacío = sin filtro.
	ReportStatuses []string

	// From/To acotan COALESCE(reports.occurred_at, reports.created_at), porque
	// occurred_at es nullable y la UI muestra ese mismo fallback. Comparar
	// contra la columna pelada haría desaparecer en silencio todo reporte sin
	// fecha de ocurrencia. nil = sin límite.
	From *time.Time
	To   *time.Time
}
```

- [ ] **Step 4: Change the interface**

In `backend/internal/repository/interfaces.go`, replace line 36:

```go
	FindNearby(criteria domain.NearbyReportCriteria) ([]domain.Report, error)
```

- [ ] **Step 5: Change the implementation**

In `backend/internal/repository/report_repository.go`, change the signature and the three uses of the old parameters. The body is otherwise untouched in this task:

```go
func (r *PostgresReportRepository) FindNearby(c domain.NearbyReportCriteria) ([]domain.Report, error) {
	var reports []domain.Report

	orderExpr := fmt.Sprintf(
		"ST_Distance(ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography, ST_SetSRID(ST_MakePoint(%g, %g), 4326)::geography) ASC",
		c.Lng, c.Lat,
	)

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
		`, c.Lng, c.Lat, c.RadiusMeters).
		Order(orderExpr).
		Find(&reports).Error

	return reports, err
}
```

Keep the existing explanatory comment block above the function exactly as it is — it documents the allowlist and episode scope and is still accurate.

- [ ] **Step 6: Change the service**

In `backend/internal/service/report_service.go`, replace `GetNearbyReports`:

```go
// GetNearbyReports busca reportes cercanos a una ubicación.
// El radio debe ser provisto por el caller (ver ReportHandler para la lógica de precedencia).
func (s *reportService) GetNearbyReports(criteria domain.NearbyReportCriteria) ([]domain.Report, error) {
	return s.repo.FindNearby(criteria)
}
```

Update the matching method in the `ReportService` interface in the same file.

- [ ] **Step 7: Change the handler call site**

In `backend/internal/handler/report_handler.go`, replace the call at line ~200:

```go
	reports, err := h.reportService.GetNearbyReports(domain.NearbyReportCriteria{
		Lat:          lat,
		Lng:          lng,
		RadiusMeters: float64(radiusMeters),
	})
```

- [ ] **Step 8: Typecheck the module AND the tests**

```bash
cd backend && go build ./... && go vet ./... 2>&1 | head -30; echo "EXIT=$?"
```

`go build ./...` alone is **not enough**: it does not compile `_test.go` files, and two of them break with this change. `go vet` typechecks them, so run both.

Two call sites the compiler will name, both of which must be updated:

- `tests/episode_flow_test.go` calls `FindNearby` positionally.
- `tests/report_handler_test.go` defines `mockReportService` with
  `getNearbyFn func(_, _, _ float64) ([]domain.Report, error)`. Its field and the method that
  uses it become:

```go
	getNearbyFn func(domain.NearbyReportCriteria) ([]domain.Report, error)
```

Update every literal that sets `getNearbyFn` accordingly — the existing one at the nearby test ignores its arguments, so it becomes `func(_ domain.NearbyReportCriteria) ([]domain.Report, error)`.

- [ ] **Step 9: Run the full report test set**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. Nothing changed behaviourally, so every pre-existing test must still pass.

- [ ] **Step 10: Commit**

```bash
git add backend/internal/domain/models.go backend/internal/repository backend/internal/service backend/internal/handler backend/tests
git commit -m "refactor(backend): FindNearby recibe un criteria struct"
```

---

## Task 2: Status filter, and the test that proves it cannot widen

**Files:**
- Modify: `backend/internal/repository/report_repository.go`
- Test: `backend/tests/report_repository_test.go`

- [ ] **Step 1: Write the widening test**

This is the most important test in the slice. Append to `backend/tests/report_repository_test.go`:

```go
// El filtro del usuario acota DENTRO de la allowlist; jamás la ensancha.
//
// La mascota está `archived`, o sea fuera de MapVisibleStatuses, así que su
// reporte no debe aparecer nunca — ni sin filtros, ni pidiendo explícitamente
// el estado que ese reporte tiene. Si alguna vez este test se pone verde
// porque el filtro reemplazó a la allowlist en vez de sumarse, el mapa estaría
// filtrando casos cerrados y mascotas ya privadas.
func TestReportRepository_FindNearby_ElFiltroNoEnsanchaLaAllowlist(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Archivada", Type: "perro", Status: domain.PetStatusArchived}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	report := &domain.Report{
		ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng,
	}
	if err := reportRepo.Create(report); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	got, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
		ReportStatuses: []string{"lost"},
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("la allowlist se ensanchó: esperaba 0 reportes, obtuve %d", len(got))
	}
}
```

- [ ] **Step 2: Write the filtering test**

```go
func TestReportRepository_FindNearby_FiltraPorEstadoDelReporte(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Lost Dog", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	for _, st := range []string{"lost", "sighting"} {
		r := &domain.Report{
			ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
			Status: st, Latitude: mvdLat, Longitude: mvdLng,
		}
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report %s: %v", st, err)
		}
	}

	got, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
		ReportStatuses: []string{"sighting"},
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(got) != 1 || got[0].Status != "sighting" {
		t.Fatalf("esperaba sólo el sighting, obtuve %d: %+v", len(got), got)
	}
}
```

- [ ] **Step 3: Run both and watch the filtering one fail**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -run "TestReportRepository_FindNearby_(ElFiltroNoEnsancha|FiltraPorEstado)" -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero. `FiltraPorEstadoDelReporte` fails with `esperaba sólo el sighting, obtuve 2` because the filter is not applied yet. The widening test already passes — it must, since the allowlist is already there.

- [ ] **Step 4: Apply the filter**

In `report_repository.go`, build the query in steps instead of one chain, and add the status clause:

```go
	q := r.db.Preload("Pet").Preload("Reporter").
		Joins("JOIN pets ON pets.id = reports.pet_id").
		Where("pets.status IN (?)", domain.MapVisibleStatuses).
		Where("reports.episode_id = pets.current_episode_id").
		Where(`
			ST_DWithin(
				ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
				?
			)
		`, c.Lng, c.Lat, c.RadiusMeters)

	// Los filtros del usuario se SUMAN a lo de arriba. Nunca lo reemplazan.
	if len(c.ReportStatuses) > 0 {
		q = q.Where("reports.status IN (?)", c.ReportStatuses)
	}

	err := q.Order(orderExpr).Find(&reports).Error
```

- [ ] **Step 5: Run them again**

Same command as Step 3. Expected: `EXIT=0`.

- [ ] **Step 6: Prove the widening test can actually fail**

Temporarily replace the allowlist line with the user filter to simulate the bug:

```go
	// TEMPORAL — sólo para ver el rojo. Revertir en el paso siguiente.
	// .Where("pets.status IN (?)", domain.MapVisibleStatuses)   <- comentada
```

Run the widening test. Expected: it FAILS with `la allowlist se ensanchó: esperaba 0 reportes, obtuve 1`.

**Do not skip this step.** A test that passes with and without the bug proves nothing, which is the exact failure mode this project has hit repeatedly.

- [ ] **Step 7: Revert the temporary change and confirm green**

Restore the allowlist line. Run both tests. Expected: `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/repository/report_repository.go backend/tests/report_repository_test.go
git commit -m "feat(backend): filtro por estado del reporte en nearby"
```

---

## Task 3: Pet type filter

**Files:**
- Modify: `backend/internal/repository/report_repository.go`
- Test: `backend/tests/report_repository_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestReportRepository_FindNearby_FiltraPorTipoDeMascota(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	for _, tipo := range []string{"perro", "gato"} {
		pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: tipo, Type: tipo, Status: domain.PetStatusLost}
		if err := petRepo.Create(pet); err != nil {
			t.Fatalf("Create pet %s: %v", tipo, err)
		}
		r := &domain.Report{
			ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
			Status: "lost", Latitude: mvdLat, Longitude: mvdLng,
		}
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report %s: %v", tipo, err)
		}
	}

	got, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
		PetType: "gato",
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("esperaba 1 gato, obtuve %d", len(got))
	}
	if got[0].Pet == nil || got[0].Pet.Type != "gato" {
		t.Fatalf("esperaba un reporte de gato, obtuve %+v", got[0].Pet)
	}
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -run TestReportRepository_FindNearby_FiltraPorTipo -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero, `esperaba 1 gato, obtuve 2`.

- [ ] **Step 3: Add the clause**

Right after the status block in `report_repository.go`:

```go
	if c.PetType != "" {
		q = q.Where("pets.type = ?", c.PetType)
	}
```

- [ ] **Step 4: Run it and watch it pass**

Same command. Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/repository/report_repository.go backend/tests/report_repository_test.go
git commit -m "feat(backend): filtro por tipo de mascota en nearby"
```

---

## Task 4: Date range, with the nullable-column trap

**Files:**
- Modify: `backend/internal/repository/report_repository.go`
- Test: `backend/tests/report_repository_test.go`

- [ ] **Step 1: Write the test that catches the NULL trap**

```go
// occurred_at es NULLABLE y la UI muestra `occurred_at ?? created_at`. Si el
// filtro compara contra la columna pelada, todo reporte sin fecha de
// ocurrencia DESAPARECE apenas el usuario elige un rango — en silencio, que es
// el peor modo de falla. Por eso la query usa COALESCE, igual que la pantalla.
func TestReportRepository_FindNearby_RangoDeFechasUsaCoalesce(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Lost Dog", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Reporte SIN occurred_at: su created_at es ahora, así que cae dentro del rango.
	sinFecha := &domain.Report{
		ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng,
	}
	if err := reportRepo.Create(sinFecha); err != nil {
		t.Fatalf("Create report sin fecha: %v", err)
	}

	desde := time.Now().Add(-24 * time.Hour)
	hasta := time.Now().Add(24 * time.Hour)

	got, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
		From: &desde, To: &hasta,
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("el reporte sin occurred_at desapareció del rango: esperaba 1, obtuve %d", len(got))
	}
}
```

Add `"time"` to the test file's imports if it is not already there.

- [ ] **Step 2: Write the exclusion test**

```go
func TestReportRepository_FindNearby_RangoDeFechasExcluyeLoViejo(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Lost Dog", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	viejo := time.Now().Add(-72 * time.Hour)
	r := &domain.Report{
		ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng, OccurredAt: &viejo,
	}
	if err := reportRepo.Create(r); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	desde := time.Now().Add(-24 * time.Hour)
	got, err := reportRepo.FindNearby(domain.NearbyReportCriteria{
		Lat: mvdLat, Lng: mvdLng, RadiusMeters: 5000,
		From: &desde,
	})
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("esperaba 0 reportes fuera del rango, obtuve %d", len(got))
	}
}
```

- [ ] **Step 3: Run both and watch the exclusion one fail**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -run TestReportRepository_FindNearby_RangoDeFechas -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero. `ExcluyeLoViejo` fails with `esperaba 0 reportes fuera del rango, obtuve 1`; the COALESCE test passes already because no filter is applied yet.

- [ ] **Step 4: Add the clauses**

After the type block:

```go
	// COALESCE, no la columna pelada: occurred_at es nullable y la pantalla
	// muestra `occurred_at ?? created_at`. Filtrar por la columna sola haría
	// desaparecer los reportes sin fecha de ocurrencia sin decir una palabra.
	if c.From != nil {
		q = q.Where("COALESCE(reports.occurred_at, reports.created_at) >= ?", *c.From)
	}
	if c.To != nil {
		q = q.Where("COALESCE(reports.occurred_at, reports.created_at) <= ?", *c.To)
	}
```

- [ ] **Step 5: Run them again**

Same command. Expected: `EXIT=0`.

- [ ] **Step 6: Prove the COALESCE test can fail**

Temporarily change both clauses to use `reports.occurred_at` directly. Run the tests.

Expected: `RangoDeFechasUsaCoalesce` FAILS with `el reporte sin occurred_at desapareció del rango`. Then restore `COALESCE` and confirm green again.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/repository/report_repository.go backend/tests/report_repository_test.go
git commit -m "feat(backend): rango de fechas en nearby, con COALESCE sobre occurred_at"
```

---

## Task 5: Handler parsing and validation

**Files:**
- Modify: `backend/internal/domain/pet_status.go`
- Modify: `backend/internal/handler/report_handler.go`
- Test: `backend/tests/report_handler_test.go`

- [ ] **Step 1: Write the validation tests**

Append to `backend/tests/report_handler_test.go`. It uses the helper that file already defines —
`setupReportRouter(h *handler.ReportHandler, reporterID uuid.UUID) *gin.Engine` — with a
`mockReportService`, so these tests need no database.

The mock's `getNearbyFn` is left nil on purpose: a request that reaches the service means validation
did **not** reject it, and the test would then fail on a nil call instead of passing quietly.

```go
func TestGetNearbyReports_FiltrosInvalidosDan400(t *testing.T) {
	reporterID := uuid.New()

	casos := []struct {
		name  string
		query string
	}{
		{"tipo inexistente", "type=dinosaurio"},
		{"tipo en inglés (los valores son español)", "type=dog"},
		{"estado inexistente", "status=lost,inventado"},
		{"fecha no parseable", "from=ayer"},
		{"from posterior a to", "from=2026-08-10T00:00:00Z&to=2026-08-01T00:00:00Z"},
	}

	for _, tc := range casos {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockReportService{}
			r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

			w := httptest.NewRecorder()
			url := "/api/reports/nearby?lat=-34.9011&lng=-56.1645&" + tc.query
			req, _ := http.NewRequest("GET", url, nil)
			r.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("esperaba 400, obtuve %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

// Los cuatro parámetros son OPCIONALES: sin ellos el endpoint se comporta como
// siempre. Es la garantía que permite deployar esta rebanada antes de que el
// frontend exista.
func TestGetNearbyReports_SinFiltrosSigueDando200(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()

	svc := &mockReportService{
		getNearbyFn: func(_ domain.NearbyReportCriteria) ([]domain.Report, error) {
			return []domain.Report{*newTestReport(reporterID, petID)}, nil
		},
	}
	r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/reports/nearby?lat=-34.9011&lng=-56.1645", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("esperaba 200 sin filtros, obtuve %d: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./tests/... -run "TestGetNearbyReports_(TipoInvalido|EstadoInvalido|DesdePosterior)" -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: non-zero — the handler currently ignores these parameters and answers 200.

- [ ] **Step 3: Add the domain allowlists**

In `backend/internal/domain/pet_status.go`, beside the existing visibility allowlists:

```go
// ValidPetTypes son los cuatro tipos de mascota que ofrece la UI.
//
// Ojo con la asimetría: la CREACIÓN no valida el tipo (CreatePetRequest sólo
// pide `required`), así que en la base puede haber cualquier string. Esta lista
// existe para validar FILTROS, donde el cliente es un select con estas cuatro
// opciones y cualquier otra cosa es un request malformado.
var ValidPetTypes = []string{"perro", "gato", "pajaro", "otro"}

func IsValidPetType(t string) bool {
	for _, v := range ValidPetTypes {
		if v == t {
			return true
		}
	}
	return false
}

// ValidReportStatuses son los estados de un REPORTE (no de una mascota).
var ValidReportStatuses = []string{"lost", "found", "sighting"}

func IsValidReportStatus(s string) bool {
	for _, v := range ValidReportStatuses {
		if v == s {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Parse and validate in the handler**

In `backend/internal/handler/report_handler.go`, between the radius resolution and the service call:

```go
	criteria := domain.NearbyReportCriteria{
		Lat:          lat,
		Lng:          lng,
		RadiusMeters: float64(radiusMeters),
	}

	if petType := c.Query("type"); petType != "" {
		if !domain.IsValidPetType(petType) {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
			return
		}
		criteria.PetType = petType
	}

	if raw := c.Query("status"); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			s = strings.TrimSpace(s)
			if !domain.IsValidReportStatus(s) {
				writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
				return
			}
			criteria.ReportStatuses = append(criteria.ReportStatuses, s)
		}
	}

	if raw := c.Query("from"); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
			return
		}
		criteria.From = &parsed
	}

	if raw := c.Query("to"); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
			return
		}
		criteria.To = &parsed
	}

	if criteria.From != nil && criteria.To != nil && criteria.From.After(*criteria.To) {
		writeError(c, http.StatusBadRequest, domain.ErrInvalidInput)
		return
	}

	reports, err := h.reportService.GetNearbyReports(criteria)
```

Add `"strings"` and `"time"` to the file's imports if absent.

- [ ] **Step 5: Run the tests and watch them pass**

Same command as Step 2. Expected: `EXIT=0`.

- [ ] **Step 6: Run everything**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test ./... -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/domain/pet_status.go backend/internal/handler/report_handler.go backend/tests/report_handler_test.go
git commit -m "feat(backend): validar y parsear los filtros de nearby"
```

---

## Task 6: End-to-end check and slice close

**Files:**
- Test: `backend/tests/e2e/report_flow_test.go`

- [ ] **Step 1: Add the e2e case**

Append to `backend/tests/e2e/report_flow_test.go`. It reuses that file's existing helpers —
`startTestServer(t)` and `createPet(t, baseURL, token, name)` — and the authentication helper used
by `TestReportFlow_NearbySearch`; read that test first and mirror how it obtains `token`.

`createPet` always seeds `"type": "perro"`, which is what makes the `type=gato` assertion meaningful.

```go
func TestReportFlow_NearbyFiltraPorTipo(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token := registerAndLogin(t, baseURL)
	petID := createPet(t, baseURL, token, "Filtrable")
	createReportAt(t, baseURL, token, petID, -34.9011, -56.1645)

	contar := func(query string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, baseURL+"/api/reports/nearby?"+query, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("nearby: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("nearby %q: want 200, got %d", query, resp.StatusCode)
		}
		var out struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatalf("nearby %q: decode: %v", query, err)
		}
		return len(out.Data)
	}

	base := "lat=-34.9011&lng=-56.1645&radius=5000"

	if n := contar(base); n != 1 {
		t.Fatalf("sin filtros esperaba 1 reporte, obtuve %d", n)
	}
	if n := contar(base + "&type=perro"); n != 1 {
		t.Fatalf("filtrando por perro esperaba 1 reporte, obtuve %d", n)
	}
	if n := contar(base + "&type=gato"); n != 0 {
		t.Fatalf("filtrando por gato esperaba 0 reportes, obtuve %d", n)
	}
	// Filtros combinados: el tipo correcto con un estado que el reporte no tiene.
	if n := contar(base + "&type=perro&status=found"); n != 0 {
		t.Fatalf("combinando tipo correcto con estado ajeno esperaba 0, obtuve %d", n)
	}
}
```

If `registerAndLogin` or `createReportAt` carry different names in that file, use the existing ones —
do not add duplicates. Their names are the only thing to adapt here; the assertions stand as written.

- [ ] **Step 2: Run the e2e suite**

```bash
cd backend
DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" \
  go test -tags e2e ./tests/e2e/... -count=1 > /tmp/out.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 3: Run every normalizer before the review**

This must happen **before** the RDD review starts. After the review freezes the candidate, any changed byte invalidates the receipt.

```bash
cd backend && gofmt -l . && go vet ./... ; echo "EXIT=$?"
```

`gofmt -l` must print nothing. Fix anything it lists, then re-run.

- [ ] **Step 4: Commit and open the PR**

```bash
git add backend/tests/e2e/report_flow_test.go
git commit -m "test(backend): e2e de los filtros de nearby"
```

Then follow the `searchpet-pr` skill for the branch and PR conventions. This is the base of a three-PR chain: merge it **without** `--delete-branch`, and retarget slice 2 to `main` before deleting anything (rule #49).

- [ ] **Step 5: Enter the RDD cycle**

```bash
gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --agent claude-code --next-transition
```

Route only from the returned `next_transition`. This slice touches a visibility invariant, so it may be classified high risk and draw the canonical four-lens review; if so, give the cost forecast before the first lens runs. Remember the candidate admits **one** bounded correction.
