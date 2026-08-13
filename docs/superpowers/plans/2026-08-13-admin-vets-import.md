# Admin-triggered OSM vet import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin refresh the `vets` table from OpenStreetMap through the web panel, and have that refresh remove clinics OSM no longer lists — without anyone holding the production database password.

**Architecture:** `internal/osmimport.Importer` keeps owning the import and gains a stale-row sweep guarded by two conditions. It stops taking a `*gorm.DB` and takes a `repository.VetRepository`, so both entry points — `cmd/import-vets` and a new admin-only HTTP handler — drive the same code. Deletion is soft (`gorm.DeletedAt`), which makes a mistaken sweep reversible and makes a vet's return to OSM self-healing through the existing upsert.

**Tech Stack:** Go 1.25 + Gin + GORM, PostgreSQL/PostGIS (Neon in production), React + Vite + Tailwind + React Query on the web.

**Spec:** `docs/superpowers/specs/2026-08-13-admin-vets-import-design.md`

---

## Conventions for every task

**Backend test command** (the whole suite; `DATABASE_URL` is mandatory — without it `testdb.SetupTestDB` skips every integration test *silently*):

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 > /tmp/bt.log 2>&1; echo "EXIT=$?"
```

Single test: append `-run '<TestName>' -v` and drop the redirect.

**Judge by `EXIT=`, never by grepping the output.** `EXIT=0` is green; anything else means open `/tmp/bt.log`. A pipe into `rg 'FAIL' || echo green` prints success when the grep read nothing at all.

Postgres must be up: `docker compose up -d db redis`, wait for `lostpets-db` to report `healthy`.

**Never point `DATABASE_URL` at `lostpets`** — that is the developer's seeded database and the tests truncate it.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `backend/internal/domain/vet.go` | `Vet` entity | Modify — add `DeletedAt` |
| `backend/internal/domain/errors.go` | Error sentinels + codes | Modify — two new errors |
| `backend/internal/repository/interfaces.go` | `VetRepository` contract | Modify — two new methods |
| `backend/internal/repository/vet_repository.go` | Postgres implementation | Modify — implement them, resurrect on upsert |
| `backend/internal/osmimport/importer.go` | Fetch, map, upsert, sweep | Modify — repo injection, split `Result`, sweep + guards |
| `backend/internal/dto/vet_dto.go` | HTTP shape of a run result | Modify — `VetImportResponse` |
| `backend/internal/handler/vet_import_handler.go` | HTTP entry point + concurrency guard | **Create** |
| `backend/internal/app/router.go` | Wiring and route | Modify |
| `backend/cmd/import-vets/main.go` | CLI entry point | Modify — build the repo, log new fields |
| `backend/tests/vet_repository_test.go` | Repo behaviour against real Postgres | Modify |
| `backend/tests/vet_import_handler_test.go` | HTTP contract | **Create** |
| `backend/internal/osmimport/importer_test.go` | Sweep guards against a fake Overpass | Modify |
| `frontend/packages/shared/api/client.ts` | `importVets()` | Modify |
| `frontend/packages/shared/types/index.ts` | `VetImportResult` | Modify |
| `frontend/packages/web/src/pages/admin/VetsAdminPage.tsx` | Panel page | **Create** |
| `frontend/packages/web/src/pages/admin/VetsAdminPage.test.tsx` | Page behaviour | **Create** |
| `frontend/packages/web/src/pages/admin/AdminLayout.tsx` | Nav | Modify — one link |
| `frontend/packages/web/src/App.tsx` | Route | Modify |
| `frontend/packages/web/src/i18n/locales/{es,en,pt}.json` | `admin.vets.*` keys | Modify |

**No SQL migration.** `DeletedAt` is an additive nullable column with no backfill and no constraint, and AutoMigrate creates it in both environments. Rule #35 is about a struct tag and a migration disagreeing; here there is only the tag, so they cannot diverge. Task 1 Step 6 verifies the column really lands on an empty database rather than assuming it.

---

# SLICE 1 — Backend

## Task 1: Soft delete on `Vet`, and resurrection through upsert

**Files:**
- Modify: `backend/internal/domain/vet.go:12-27`
- Modify: `backend/internal/repository/vet_repository.go:23-33`
- Test: `backend/tests/vet_repository_test.go`

- [ ] **Step 1: Write the two failing tests**

Append to `backend/tests/vet_repository_test.go`:

```go
func TestVetRepository_FindNearby_ExcludesSoftDeleted(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	const lat, lng = -34.9011, -56.1645
	seedVet(t, repo, 1, "Alive", lat+0.001, lng+0.001)
	seedVet(t, repo, 2, "Gone", lat+0.002, lng+0.002)

	// Soft delete straight through GORM: this test pins the READ path, not the
	// sweep (Task 2 owns that). If GORM ever stopped applying the soft-delete
	// scope to FindNearby's model-scoped query, the map would keep drawing
	// clinics we already decided are closed — with nothing failing anywhere.
	if err := db.Where("osm_id = ?", 2).Delete(&domain.Vet{}).Error; err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	results, err := repo.FindNearby(context.Background(), lat, lng, 5000, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected only the live vet, got %d", len(results))
	}
	if results[0].Name != "Alive" {
		t.Errorf("returned the deleted vet: %q", results[0].Name)
	}
}

func TestVetRepository_Upsert_ResurrectsSoftDeleted(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	const lat, lng = -34.9011, -56.1645
	seedVet(t, repo, 7, "Back In OSM", lat, lng)
	if err := db.Where("osm_id = ?", 7).Delete(&domain.Vet{}).Error; err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	// A vet deleted from OSM and later re-added must come back on the next
	// import, with no revival code path of its own to forget.
	seedVet(t, repo, 7, "Back In OSM", lat, lng)

	results, err := repo.FindNearby(context.Background(), lat, lng, 1000, 50)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected the vet to be back, got %d rows", len(results))
	}
}
```

- [ ] **Step 2: Run them and watch both fail**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetRepository_(FindNearby_ExcludesSoftDeleted|Upsert_ResurrectsSoftDeleted)' -v
```

**Both tests PASS here, and that is not a red run — it is the absence of one.** `Vet` has no
`deleted_at` column yet, so GORM's `Delete` issues a **hard** `DELETE`: the row is gone, the next
`Upsert` finds no conflict target and inserts cleanly, and the vet "comes back" for a reason that
has nothing to do with the fix. Neither test can fail before Step 3, because removing the whole
feature also removes the soft delete the test setup depends on.

*(Measured 2026-08-13: both PASS at this point. An earlier draft of this plan predicted the second
one would fail — it does not.)*

So the redness of these two is verified **after** Step 4, by removing only the line that carries
the behaviour. That is Step 5b below, and it is the step that decides whether these tests are
guards or decoration.

- [ ] **Step 3: Add the field**

In `backend/internal/domain/vet.go`, add the import and the field:

```go
import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)
```

Inside `type Vet struct`, after `LastSyncedAt`:

```go
	// DeletedAt marks a vet OpenStreetMap no longer lists. GORM applies the
	// soft-delete scope to every model-scoped query, so FindNearby needs no
	// change — a fact pinned by TestVetRepository_FindNearby_ExcludesSoftDeleted
	// rather than by this comment.
	//
	// Soft rather than hard because the sweep that sets it is automated and
	// unattended: a wrong run is undone with one UPDATE instead of waiting for
	// the next full import.
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
```

- [ ] **Step 4: Make the upsert clear it**

In `backend/internal/repository/vet_repository.go`, add `"deleted_at"` to the `DoUpdates` list and explain why:

```go
// Upsert inserta una veterinaria o la actualiza si ya existe (mismo osm_type+osm_id).
// Hace idempotente la importación: re-correr el import nunca duplica filas.
//
// deleted_at viaja en DoUpdates a propósito: el registro entrante lo trae en su
// valor cero, así que EXCLUDED.deleted_at es NULL y una veterinaria que vuelve a
// OpenStreetMap RESUCITA sola. Sin esa columna, la fila seguiría marcada como
// borrada y el mapa no la dibujaría nunca más, sin un solo error a la vista.
func (r *postgresVetRepository) Upsert(ctx context.Context, vet *domain.Vet) error {
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "osm_type"}, {Name: "osm_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"name", "latitude", "longitude", "address",
				"phone", "website", "opening_hours", "last_synced_at", "updated_at",
				"deleted_at",
			}),
		}).
		Create(vet).Error
}
```

- [ ] **Step 5: Run them and watch both pass**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetRepository_' -v
```

Expected: PASS, including the two pre-existing `FindNearby`/`Upsert` tests.

- [ ] **Step 5b: Verify the resurrection test RED — remove the line, not the feature**

Delete only `"deleted_at",` from the `DoUpdates` list in `Upsert`, leaving the model field alone,
and run:

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetRepository_Upsert_ResurrectsSoftDeleted' -v
```

Expected: **FAIL** with `expected the vet to be back, got 0 rows` — the soft-deleted row still
occupies the unique key, the upsert hits the conflict and leaves `deleted_at` set. Restore the
line with `git checkout -- backend/internal/repository/vet_repository.go` and re-run to confirm
green.

*(Verified 2026-08-13: red output exactly as above, `EXIT=1`; restored, `EXIT=0`.)*

**This is the general form, and it is why Step 2 could not be the red run.** To prove a guard
guards, remove the one line that implements the behaviour — never the whole feature. Removing the
feature can also remove the conditions the test depends on, and then green means "the scenario no
longer exists", not "the code is correct".

- [ ] **Step 6: Verify the column lands on an EMPTY database**

The test database is reused across runs, so a passing suite does not prove AutoMigrate creates the column from scratch. Prove it:

```bash
docker exec lostpets-db psql -U postgres -c "DROP DATABASE IF EXISTS lostpets_fresh;" -q
docker exec lostpets-db psql -U postgres -c "CREATE DATABASE lostpets_fresh;" -q
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_fresh?sslmode=disable" JWT_SECRET=test-secret go run ./cmd/server & sleep 25; kill %1
docker exec lostpets-db psql -U postgres -d lostpets_fresh -c "\d vets"
```

Expected: the `\d vets` output lists `deleted_at | timestamp with time zone` and an index on it.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/domain/vet.go backend/internal/repository/vet_repository.go backend/tests/vet_repository_test.go
git commit -m "feat(vets): borrado suave, y una veterinaria que vuelve a OSM resucita sola"
```

---

## Task 2: `SoftDeleteStaleBefore` and `CountActiveOSM`

**Files:**
- Modify: `backend/internal/repository/interfaces.go:328-332`
- Modify: `backend/internal/repository/vet_repository.go`
- Test: `backend/tests/vet_repository_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/vet_repository_test.go`:

```go
// seedVetAt is seedVet with an explicit last_synced_at, so a test can place a row
// on either side of a sweep cutoff.
func seedVetAt(t *testing.T, db *gorm.DB, osmID int64, name, source string, syncedAt time.Time) {
	t.Helper()
	const lat, lng = -34.9011, -56.1645
	err := db.Create(&domain.Vet{
		OSMType:      "node",
		OSMID:        osmID,
		Name:         name,
		Latitude:     lat,
		Longitude:    lng,
		Source:       source,
		LastSyncedAt: syncedAt,
	}).Error
	if err != nil {
		t.Fatalf("seed vet %q: %v", name, err)
	}
}

func TestVetRepository_SoftDeleteStaleBefore_OnlyStaleOSMRows(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	cutoff := time.Now()
	old := cutoff.Add(-time.Hour)
	fresh := cutoff.Add(time.Minute)

	seedVetAt(t, db, 1, "Stale OSM", "osm", old)       // swept
	seedVetAt(t, db, 2, "Fresh OSM", "osm", fresh)     // survives: synced this run
	seedVetAt(t, db, 3, "Community", "community", old) // survives: not ours to sweep

	n, err := repo.SoftDeleteStaleBefore(context.Background(), cutoff)
	if err != nil {
		t.Fatalf("SoftDeleteStaleBefore: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected exactly the stale OSM row swept, got %d", n)
	}

	// The source predicate is the blast-radius boundary: a vet a human added by
	// hand must never disappear because OpenStreetMap does not know about it.
	var survivors []string
	if err := db.Model(&domain.Vet{}).Order("osm_id").Pluck("name", &survivors).Error; err != nil {
		t.Fatalf("pluck: %v", err)
	}
	if len(survivors) != 2 || survivors[0] != "Fresh OSM" || survivors[1] != "Community" {
		t.Errorf("wrong survivors: %v", survivors)
	}
}

func TestVetRepository_CountActiveOSM_IgnoresDeletedAndOtherSources(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewVetRepository(db)

	now := time.Now()
	seedVetAt(t, db, 1, "Live", "osm", now)
	seedVetAt(t, db, 2, "Deleted", "osm", now)
	seedVetAt(t, db, 3, "Community", "community", now)
	if err := db.Where("osm_id = ?", 2).Delete(&domain.Vet{}).Error; err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	// This count is the denominator of the sweep threshold. Counting a
	// soft-deleted row would inflate it and make the guard stricter than
	// designed; counting a community row would make the guard depend on data
	// the import cannot affect.
	n, err := repo.CountActiveOSM(context.Background())
	if err != nil {
		t.Fatalf("CountActiveOSM: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 active OSM vet, got %d", n)
	}
}
```

Add `"gorm.io/gorm"` to the imports of that file.

- [ ] **Step 2: Run them and watch them fail to compile**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetRepository_(SoftDeleteStaleBefore|CountActiveOSM)' -v
```

Expected: FAIL — `repo.SoftDeleteStaleBefore undefined` and `repo.CountActiveOSM undefined`.

- [ ] **Step 3: Extend the interface**

In `backend/internal/repository/interfaces.go`, replace the `VetRepository` block:

```go
// VetRepository persiste y consulta veterinarias importadas de OSM.
type VetRepository interface {
	Upsert(ctx context.Context, vet *domain.Vet) error
	FindNearby(ctx context.Context, lat, lng, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error)
	// SoftDeleteStaleBefore marca como borradas las veterinarias de origen OSM
	// cuya última sincronización exitosa es anterior a cutoff. Retorna cuántas.
	SoftDeleteStaleBefore(ctx context.Context, cutoff time.Time) (int64, error)
	// CountActiveOSM cuenta las filas VIVAS de origen OSM. Es el denominador del
	// umbral de cordura del barrido.
	CountActiveOSM(ctx context.Context) (int64, error)
}
```

Add `"time"` to that file's imports if it is not already there.

- [ ] **Step 4: Implement both**

Append to `backend/internal/repository/vet_repository.go`:

```go
// SoftDeleteStaleBefore marca las veterinarias de OSM que la última corrida no
// tocó. GORM traduce Delete a UPDATE ... SET deleted_at = now() y agrega solo
// "deleted_at IS NULL" al WHERE, así que re-barrer es idempotente.
//
// El filtro por source es deliberado y NO es cosmético: acota el radio de acción
// del barrido a las filas que vienen de OpenStreetMap. Una veterinaria cargada a
// mano nunca aparece en la respuesta de Overpass, así que sin este filtro el
// primer import la borraría.
func (r *postgresVetRepository) SoftDeleteStaleBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	res := r.db.WithContext(ctx).
		Where("source = ? AND last_synced_at < ?", "osm", cutoff).
		Delete(&domain.Vet{})
	return res.RowsAffected, res.Error
}

// CountActiveOSM cuenta las veterinarias vivas de origen OSM. El scope de borrado
// suave de GORM excluye las marcadas sin que haga falta pedirlo.
func (r *postgresVetRepository) CountActiveOSM(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).
		Model(&domain.Vet{}).
		Where("source = ?", "osm").
		Count(&n).Error
	return n, err
}
```

Add `"time"` to the imports.

- [ ] **Step 5: Run them and watch them pass**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetRepository_' -v
```

Expected: PASS, all six.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/repository/interfaces.go backend/internal/repository/vet_repository.go backend/tests/vet_repository_test.go
git commit -m "feat(vets): barrido de filas muertas acotado a las de origen OSM"
```

---

## Task 3: Inject the repository, split `Result`

Pure refactor, no behaviour change. It exists so the handler can drive the importer without a `*gorm.DB`, and so the sweep in Task 4 can tell "never existed" apart from "write failed".

**Files:**
- Modify: `backend/internal/osmimport/importer.go:54-113`
- Modify: `backend/cmd/import-vets/main.go`
- Test: `backend/internal/osmimport/importer_test.go`

- [ ] **Step 1: Change the constructor and the Result**

In `backend/internal/osmimport/importer.go`, replace the `Result` struct and `New`:

```go
// Result summarizes an import run.
type Result struct {
	Scanned  int
	Upserted int
	// SkippedNoCoords counts OSM elements with no usable coordinates. They were
	// never in our table, so they cannot be swept and they must not block a sweep.
	SkippedNoCoords int
	// UpsertFailed counts rows whose write failed. These ARE in the table with a
	// stale last_synced_at, so a sweep would delete a vet that is alive in OSM.
	// Keeping this separate from SkippedNoCoords is what lets guard 2 be correct.
	UpsertFailed int
	// Swept counts rows soft-deleted because OSM no longer lists them.
	Swept int
	// SweepSkipped names the guard that blocked the sweep, or "" when it ran.
	SweepSkipped string
}

// Importer pulls OSM vets and upserts them via the repository.
type Importer struct {
	repo       repository.VetRepository
	httpClient *http.Client
	endpoint   string
	logger     *zap.Logger
}

// New builds an Importer. Pass DefaultOverpassEndpoint unless overriding for tests.
// It takes the repository rather than a *gorm.DB so the HTTP handler can drive the
// same importer the CLI does, without either one owning a database handle.
func New(repo repository.VetRepository, client *http.Client, endpoint string, log *zap.Logger) *Importer {
	return &Importer{
		repo:       repo,
		httpClient: client,
		endpoint:   endpoint,
		logger:     log,
	}
}
```

Remove the now-unused `"gorm.io/gorm"` import.

In the `Run` loop, replace the two `res.Skipped++` lines: the coords branch becomes `res.SkippedNoCoords++` and the upsert branch becomes `res.UpsertFailed++`. Update the closing log line:

```go
	i.logger.Info("[osmimport] done",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted),
		zap.Int("skipped_no_coords", res.SkippedNoCoords), zap.Int("upsert_failed", res.UpsertFailed))
```

- [ ] **Step 2: Update the CLI caller**

In `backend/cmd/import-vets/main.go`, replace the construction and the final log:

```go
	imp := osmimport.New(
		repository.NewVetRepository(db),
		&http.Client{Timeout: 150 * time.Second},
		osmimport.DefaultOverpassEndpoint,
		log,
	)

	res, err := imp.Run(context.Background())
	if err != nil {
		log.Fatal("import-vets: run failed", zap.Error(err))
	}

	log.Info("import-vets: completed",
		zap.Int("scanned", res.Scanned),
		zap.Int("upserted", res.Upserted),
		zap.Int("skipped_no_coords", res.SkippedNoCoords),
		zap.Int("upsert_failed", res.UpsertFailed),
		zap.Int("swept", res.Swept),
		zap.String("sweep_skipped", res.SweepSkipped),
	)
```

Add `"lost-pets/internal/repository"` to the imports.

- [ ] **Step 3: Build and run the package tests**

```bash
cd backend && go build ./... && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./internal/osmimport/ -count=1 -v
```

Expected: build clean, existing `osmimport` tests PASS (they construct `&Importer{...}` by field, so they are unaffected).

- [ ] **Step 4: Commit**

```bash
git add backend/internal/osmimport/importer.go backend/cmd/import-vets/main.go
git commit -m "refactor(vets): el importador recibe el repositorio y distingue por que se salteo cada fila"
```

---

## Task 4: The sweep and its two guards

**Files:**
- Modify: `backend/internal/osmimport/importer.go:80-113`
- Test: `backend/internal/osmimport/importer_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/osmimport/importer_test.go`:

```go
// fakeVetRepo records what the importer asks of the repository. Counting calls is
// the point: these tests are about WHETHER the sweep runs, not about SQL.
type fakeVetRepo struct {
	activeBefore int64
	upsertErr    error
	sweptCutoff  *time.Time
	upserts      int
}

func (f *fakeVetRepo) Upsert(_ context.Context, _ *domain.Vet) error {
	f.upserts++
	return f.upsertErr
}

func (f *fakeVetRepo) FindNearby(_ context.Context, _, _, _ float64, _ int) ([]domain.VetNearbyResult, error) {
	return nil, nil
}

func (f *fakeVetRepo) SoftDeleteStaleBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.sweptCutoff = &cutoff
	return 3, nil
}

func (f *fakeVetRepo) CountActiveOSM(_ context.Context) (int64, error) {
	return f.activeBefore, nil
}

// overpassStub serves a fixed number of usable vet nodes.
func overpassStub(t *testing.T, elements int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		els := make([]string, 0, elements)
		for i := 1; i <= elements; i++ {
			els = append(els, fmt.Sprintf(
				`{"type":"node","id":%d,"lat":-34.9,"lon":-56.1,"tags":{"name":"V%d"}}`, i, i))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[` + strings.Join(els, ",") + `]}`))
	}))
}

func newTestImporter(repo *fakeVetRepo, endpoint string) *Importer {
	return &Importer{repo: repo, httpClient: &http.Client{}, endpoint: endpoint, logger: zap.NewNop()}
}

func TestRun_SweepsWhenTheRunLooksComplete(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Fatalf("sweep should have run, blocked by %q", res.SweepSkipped)
	}
	if repo.sweptCutoff == nil {
		t.Fatal("SoftDeleteStaleBefore was never called")
	}
	if res.Swept != 3 {
		t.Errorf("Swept = %d, want 3", res.Swept)
	}
}

// THE guard. Overpass can answer 200 with a short body and no error of any kind.
// Without the threshold, that response sweeps almost the whole table.
func TestRun_ThresholdBlocksSweepOnShortResponse(t *testing.T) {
	srv := overpassStub(t, 2) // 2 upserted against 100 already there
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "below_threshold" {
		t.Errorf("SweepSkipped = %q, want \"below_threshold\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep ran on a response that lost 98% of the table")
	}
	if res.Swept != 0 {
		t.Errorf("Swept = %d, want 0", res.Swept)
	}
}

// A failed upsert leaves a live row with a stale last_synced_at, which the sweep
// would read as "OSM dropped it". It did not — our write failed.
func TestRun_UpsertFailureBlocksSweep(t *testing.T) {
	srv := overpassStub(t, 100)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 100, upsertErr: errors.New("connection reset")}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "upsert_failures" {
		t.Errorf("SweepSkipped = %q, want \"upsert_failures\"", res.SweepSkipped)
	}
	if repo.sweptCutoff != nil {
		t.Error("the sweep ran after every write failed")
	}
	if res.UpsertFailed != 100 || res.Upserted != 0 {
		t.Errorf("counters wrong: upserted=%d failed=%d", res.Upserted, res.UpsertFailed)
	}
}

// An element with no coordinates was never in the table, so it must NOT block a
// sweep — otherwise one malformed OSM way disables cleanup permanently.
func TestRun_MissingCoordsDoesNotBlockSweep(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"elements":[
			{"type":"node","id":1,"lat":-34.9,"lon":-56.1,"tags":{"name":"Ok"}},
			{"type":"way","id":2,"tags":{"name":"NoGeo"}}
		]}`))
	}))
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 1}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SkippedNoCoords != 1 || res.UpsertFailed != 0 {
		t.Errorf("counters wrong: no_coords=%d failed=%d", res.SkippedNoCoords, res.UpsertFailed)
	}
	if res.SweepSkipped != "" {
		t.Errorf("a coordinate-less element blocked the sweep: %q", res.SweepSkipped)
	}
}

// An empty table has nothing to sweep and must not trip the threshold.
func TestRun_EmptyTableStillSweeps(t *testing.T) {
	srv := overpassStub(t, 5)
	defer srv.Close()
	repo := &fakeVetRepo{activeBefore: 0}

	res, err := newTestImporter(repo, srv.URL).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.SweepSkipped != "" {
		t.Errorf("first-ever import blocked its own sweep: %q", res.SweepSkipped)
	}
}
```

Extend that file's imports to:

```go
import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"lost-pets/internal/domain"
)
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd backend && go test ./internal/osmimport/ -count=1 -run 'TestRun_' -v
```

Expected: FAIL. `Run` never calls `CountActiveOSM` or `SoftDeleteStaleBefore`, so `TestRun_SweepsWhenTheRunLooksComplete` fails with `SoftDeleteStaleBefore was never called`, and the guard tests fail with `SweepSkipped = ""`.

- [ ] **Step 3: Implement the sweep**

In `backend/internal/osmimport/importer.go`, add the constant above `Result`:

```go
// sweepMinRatio is the share of the existing OSM rows a run must re-upsert before
// it is allowed to delete anything. It defends the ugly failure mode: Overpass
// answering 200 with a short body and no error, which a blind sweep would read as
// "OpenStreetMap dropped almost every vet in Uruguay".
//
// 0.8 is judgement, not measurement — the real run re-upserts ~100%. If it ever
// blocks a legitimate import, that is the number to revisit, and revisiting it
// means looking at what OSM actually did, not at this file.
const sweepMinRatio = 0.8
```

Replace `Run`:

```go
// Run fetches Uruguay vets from Overpass, upserts each into the vets table, and
// then soft-deletes the rows this run did not touch — but only if the run passes
// both guards (see sweepReason).
func (i *Importer) Run(ctx context.Context) (Result, error) {
	var res Result

	// Captured BEFORE the fetch: every successful upsert writes a later
	// last_synced_at, so whatever stays behind this instant is what OSM no
	// longer lists.
	cutoff := time.Now()

	activeBefore, err := i.repo.CountActiveOSM(ctx)
	if err != nil {
		return res, fmt.Errorf("osmimport: count active: %w", err)
	}

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
			i.logger.Warn("[osmimport] skipping element without usable coords",
				zap.String("type", el.Type), zap.Int64("id", el.ID))
			res.SkippedNoCoords++
			continue
		}
		if err := i.repo.Upsert(ctx, vet); err != nil {
			i.logger.Warn("[osmimport] upsert failed",
				zap.String("osm_type", vet.OSMType), zap.Int64("osm_id", vet.OSMID), zap.Error(err))
			res.UpsertFailed++
			continue
		}
		res.Upserted++
	}

	res.SweepSkipped = sweepReason(res, activeBefore)
	if res.SweepSkipped == "" {
		swept, err := i.repo.SoftDeleteStaleBefore(ctx, cutoff)
		if err != nil {
			return res, fmt.Errorf("osmimport: sweep: %w", err)
		}
		res.Swept = int(swept)
	} else {
		i.logger.Warn("[osmimport] sweep skipped",
			zap.String("reason", res.SweepSkipped),
			zap.Int("upserted", res.Upserted), zap.Int64("active_before", activeBefore))
	}

	i.logger.Info("[osmimport] done",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted),
		zap.Int("skipped_no_coords", res.SkippedNoCoords), zap.Int("upsert_failed", res.UpsertFailed),
		zap.Int("swept", res.Swept), zap.String("sweep_skipped", res.SweepSkipped))
	return res, nil
}

// sweepReason returns "" when the run earned the right to delete rows, or the name
// of the guard that blocked it.
//
// Both conditions protect against the same thing from opposite directions: rows
// whose last_synced_at is stale for a reason that is OUR fault rather than OSM's.
func sweepReason(res Result, activeBefore int64) string {
	// Our writes failed, so those rows kept an old timestamp while still existing
	// in OSM. Sweeping now would delete live clinics.
	if res.UpsertFailed > 0 {
		return "upsert_failures"
	}
	// The response was too small to be believable against what we already have.
	if float64(res.Upserted) < sweepMinRatio*float64(activeBefore) {
		return "below_threshold"
	}
	return ""
}
```

- [ ] **Step 4: Run them and watch them pass**

```bash
cd backend && go test ./internal/osmimport/ -count=1 -v
```

Expected: PASS, all tests in the package.

- [ ] **Step 5: Verify guard 1 RED — this step is not optional**

A guard whose test passes with the guard removed is not a guard. Temporarily change `sweepReason` so the threshold cannot fire:

```go
	if false && float64(res.Upserted) < sweepMinRatio*float64(activeBefore) {
```

Run:

```bash
cd backend && go test ./internal/osmimport/ -count=1 -run 'TestRun_ThresholdBlocksSweepOnShortResponse' -v
```

Expected: **FAIL**, with `SweepSkipped = "", want "below_threshold"` and `the sweep ran on a response that lost 98% of the table`. Then restore the line and re-run to confirm green. Paste the red output into the commit body.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/osmimport/importer.go backend/internal/osmimport/importer_test.go
git commit -m "feat(vets): el import borra lo que OSM ya no tiene, detras de dos guardas"
```

---

## Task 5: The admin endpoint

**Files:**
- Create: `backend/internal/handler/vet_import_handler.go`
- Modify: `backend/internal/domain/errors.go`
- Modify: `backend/internal/dto/vet_dto.go`
- Modify: `backend/internal/app/router.go:276-290, 496-530`
- Test: `backend/tests/vet_import_handler_test.go`

- [ ] **Step 1: Add the two error sentinels**

In `backend/internal/domain/errors.go`, near the other domain errors:

```go
	ErrVetImportRunning  = errors.New("ya hay una importación de veterinarias en curso")
	ErrVetImportUpstream = errors.New("no se pudo consultar OpenStreetMap")
```

And in the `ErrorCodes` map, before the `// General` block:

```go
	// Vets
	ErrVetImportRunning:  "vet_import_running",
	ErrVetImportUpstream: "vet_import_upstream_failed",
```

- [ ] **Step 2: Add the response DTO**

Append to `backend/internal/dto/vet_dto.go`:

```go
// VetImportResponse is the outcome of one OSM import run.
//
// sweep_skipped is present ONLY when a guard blocked the deletion pass. An
// operator has to be able to tell "nothing was stale" (swept: 0, no reason) from
// "we refused to delete" (swept: 0, with a reason) — collapsing those two into a
// bare zero is how a broken import looks identical to a clean one.
type VetImportResponse struct {
	Scanned         int    `json:"scanned"`
	Upserted        int    `json:"upserted"`
	SkippedNoCoords int    `json:"skipped_no_coords"`
	UpsertFailed    int    `json:"upsert_failed"`
	Swept           int    `json:"swept"`
	SweepSkipped    string `json:"sweep_skipped,omitempty"`
}

// ToVetImportResponse maps an importer Result onto its HTTP shape.
func ToVetImportResponse(r osmimport.Result) VetImportResponse {
	return VetImportResponse{
		Scanned:         r.Scanned,
		Upserted:        r.Upserted,
		SkippedNoCoords: r.SkippedNoCoords,
		UpsertFailed:    r.UpsertFailed,
		Swept:           r.Swept,
		SweepSkipped:    r.SweepSkipped,
	}
}
```

Add `"lost-pets/internal/osmimport"` to that file's imports.

- [ ] **Step 3: Write the failing handler tests**

Create `backend/tests/vet_import_handler_test.go`:

```go
package tests

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/handler"
	"lost-pets/internal/osmimport"
)

type fakeImporter struct {
	res     osmimport.Result
	err     error
	started chan struct{} // closed on entry when non-nil
	release chan struct{} // blocks Run until closed when non-nil
}

func (f *fakeImporter) Run(_ context.Context) (osmimport.Result, error) {
	if f.started != nil {
		close(f.started)
		<-f.release
	}
	return f.res, f.err
}

func vetImportRouter(imp handler.VetImporter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/admin/vets/import", handler.NewVetImportHandler(imp).Import)
	return r
}

func TestVetImportHandler_ReturnsTheRunResult(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{
		Scanned: 183, Upserted: 183, Swept: 1,
	}}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["upserted"] != float64(183) || body["swept"] != float64(1) {
		t.Errorf("body = %v", body)
	}
	// Absent, not zero: a run that swept cleanly must not look blocked.
	if _, present := body["sweep_skipped"]; present {
		t.Errorf("sweep_skipped leaked into a clean run: %v", body)
	}
}

func TestVetImportHandler_BlockedSweepIsVisibleInTheBody(t *testing.T) {
	imp := &fakeImporter{res: osmimport.Result{
		Scanned: 2, Upserted: 2, SweepSkipped: "below_threshold",
	}}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["sweep_skipped"] != "below_threshold" {
		t.Errorf("the operator cannot see why nothing was deleted: %v", body)
	}
}

func TestVetImportHandler_UpstreamFailureIs502(t *testing.T) {
	imp := &fakeImporter{err: errors.New("overpass returned 504")}
	w := httptest.NewRecorder()
	vetImportRouter(imp).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "vet_import_upstream_failed" {
		t.Errorf("code = %q", body["code"])
	}
	// The upstream error text can carry the endpoint and internals; it belongs in
	// the log, not in a response body.
	if body["message"] == "overpass returned 504" {
		t.Error("raw upstream error reached the client")
	}
}

func TestVetImportHandler_SecondConcurrentRunIs409(t *testing.T) {
	imp := &fakeImporter{started: make(chan struct{}), release: make(chan struct{})}
	router := vetImportRouter(imp)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))
	}()

	<-imp.started // first run is inside Run and holding the flag

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("second run status = %d, want 409", w.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "vet_import_running" {
		t.Errorf("code = %q", body["code"])
	}

	close(imp.release)
	wg.Wait()

	// The flag must clear, or one run poisons the endpoint until the next deploy.
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/admin/vets/import", nil))
	if w.Code != http.StatusOK {
		t.Errorf("endpoint stayed locked after the run finished: %d", w.Code)
	}
}
```

Add `"context"` to that file's imports.

- [ ] **Step 4: Run them and watch them fail to compile**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetImportHandler_' -v
```

Expected: FAIL — `undefined: handler.VetImporter`, `undefined: handler.NewVetImportHandler`.

- [ ] **Step 5: Write the handler**

Create `backend/internal/handler/vet_import_handler.go`:

```go
package handler

import (
	"context"
	"net/http"
	"sync/atomic"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/osmimport"
	"lost-pets/pkg/logger"
)

// VetImporter is the slice of osmimport.Importer this handler needs. Declaring it
// here keeps the handler testable with a fake and keeps the HTTP layer from
// depending on a concrete importer.
type VetImporter interface {
	Run(ctx context.Context) (osmimport.Result, error)
}

// VetImportHandler exposes the OSM veterinary import to admins (RequireAdmin at
// the route level).
//
// The import is synchronous on purpose: the Overpass round trip was measured at
// 10.9 s for all of Uruguay (2026-08-13), and a run that DELETES rows should hand
// its result back in the same response the operator is already waiting on. An
// async job would move that outcome behind a second request and lose it entirely
// on a free-tier restart.
type VetImportHandler struct {
	importer VetImporter
	// running serialises runs. Two concurrent imports would interleave their
	// cutoffs and thresholds over each other's writes — exactly the state the
	// guards reason about — and serialising is cheaper than reasoning about it.
	running atomic.Bool
}

// NewVetImportHandler builds the handler.
func NewVetImportHandler(importer VetImporter) *VetImportHandler {
	return &VetImportHandler{importer: importer}
}

// Import godoc
// POST /api/admin/vets/import  (admin only)
func (h *VetImportHandler) Import(c *gin.Context) {
	if !h.running.CompareAndSwap(false, true) {
		writeError(c, http.StatusConflict, domain.ErrVetImportRunning)
		return
	}
	defer h.running.Store(false)

	res, err := h.importer.Run(c.Request.Context())
	if err != nil {
		// The upstream error carries the endpoint and driver internals, so it goes
		// to the log drain and never to the client.
		logger.Get().Error("vet import failed", zap.Error(err))
		writeError(c, http.StatusBadGateway, domain.ErrVetImportUpstream)
		return
	}

	logger.Get().Info("vet import completed",
		zap.Int("scanned", res.Scanned), zap.Int("upserted", res.Upserted),
		zap.Int("swept", res.Swept), zap.String("sweep_skipped", res.SweepSkipped))

	c.JSON(http.StatusOK, dto.ToVetImportResponse(res))
}
```

- [ ] **Step 6: Run them and watch them pass**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./tests/ -count=1 -run 'TestVetImportHandler_' -v
```

Expected: PASS, four tests.

- [ ] **Step 7: Wire the route**

In `backend/internal/app/router.go`, next to the other handler constructions (around line 276), add — reusing the `vetRepo` already built at line 113 for `vetService`, so there is one repository instance, not two:

```go
	vetImportHandler := handler.NewVetImportHandler(osmimport.New(
		vetRepo,
		// 60 s against a measured 10.9 s round trip: ~5.5x headroom, and far below
		// the 150 s the CLI can afford, because a browser is waiting on this one.
		&http.Client{Timeout: 60 * time.Second},
		osmimport.DefaultOverpassEndpoint,
		logger.Get(),
	))
```

Add `"net/http"`, `"time"` and `"lost-pets/internal/osmimport"` to the imports if absent.

Inside the `admin` group (after line 528, with the other `/admin/...` routes):

```go
		admin.POST("/admin/vets/import", vetImportHandler.Import)
```

- [ ] **Step 8: Run the whole backend suite**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 > /tmp/bt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. Anything else, open `/tmp/bt.log`.

- [ ] **Step 9: Verify the route is admin-gated, by hand**

The handler tests in Step 3 mount the handler bare, with no middleware, so they say nothing about
authorization. Only the wiring can be checked here, and it must be checked on **both** doors —
a route that rejects anonymous callers but accepts any logged-in user is the failure that matters.

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets?sslmode=disable" JWT_SECRET=test-secret go run ./cmd/server &
sleep 20

curl -s -o /dev/null -w "sin token:  %{http_code}\n" -X POST http://localhost:8080/api/admin/vets/import

# ana@searchpet.local is a seeded NON-admin (cmd/seed/fixtures.go).
USER_TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@searchpet.local","password":"user1234"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -o /dev/null -w "no admin:   %{http_code}\n" -X POST http://localhost:8080/api/admin/vets/import \
  -H "Authorization: Bearer $USER_TOKEN"

kill %1
```

Expected exactly:

```
sin token:  401
no admin:   403
```

A 404 means the route never registered. A **200 on the second line is the bad one**: it means the
route landed outside the `admin` group and any logged-in user can rewrite the vets table.

- [ ] **Step 10: Commit**

```bash
git add backend/internal/handler/vet_import_handler.go backend/internal/domain/errors.go backend/internal/dto/vet_dto.go backend/internal/app/router.go backend/tests/vet_import_handler_test.go
git commit -m "feat(vets): POST /api/admin/vets/import, sincronico y con una sola corrida a la vez"
```

---

# SLICE 2 — Web panel

## Task 6: API client and types

**Files:**
- Modify: `frontend/packages/shared/types/index.ts`
- Modify: `frontend/packages/shared/api/client.ts:1161-1167`

- [ ] **Step 1: Add the result type**

Append to `frontend/packages/shared/types/index.ts`:

```typescript
/** Outcome of one OSM veterinary import run. */
export interface VetImportResult {
  scanned: number;
  upserted: number;
  skipped_no_coords: number;
  upsert_failed: number;
  swept: number;
  /** Present only when a guard blocked the deletion pass. */
  sweep_skipped?: string;
}
```

- [ ] **Step 2: Add the client method**

In `frontend/packages/shared/api/client.ts`, next to `setUserAdmin`:

```typescript
  async importVets(): Promise<VetImportResult> {
    return this.request<VetImportResult>('POST', '/api/admin/vets/import');
  }
```

Add `VetImportResult` to the type import block at the top of the file.

- [ ] **Step 3: Typecheck**

```bash
cd frontend/packages/web && pnpm run build; echo "BUILD=$?"
```

Expected: `BUILD=0`.

- [ ] **Step 4: Commit**

```bash
git add frontend/packages/shared/types/index.ts frontend/packages/shared/api/client.ts
git commit -m "feat(web): cliente y tipo del import de veterinarias"
```

---

## Task 7: `VetsAdminPage`

**Files:**
- Create: `frontend/packages/web/src/pages/admin/VetsAdminPage.tsx`
- Create: `frontend/packages/web/src/pages/admin/VetsAdminPage.test.tsx`
- Modify: `frontend/packages/web/src/pages/admin/AdminLayout.tsx:4-12`
- Modify: `frontend/packages/web/src/App.tsx:108-120`
- Modify: `frontend/packages/web/src/i18n/locales/{es,en,pt}.json`

- [ ] **Step 1: Add the i18n keys**

In `frontend/packages/web/src/i18n/locales/es.json`, add `"vets"` to the `admin.nav` object and a new `admin.vets` block:

```json
    "nav": {
      "abuseReports": "Denuncias",
      "stories": "Historias",
      "groups": "Grupos",
      "admins": "Administradores",
      "shelters": "Refugios",
      "fosterHomes": "Hogares transitorios",
      "impact": "Impacto",
      "vets": "Veterinarias"
    },
    "vets": {
      "title": "Veterinarias (OpenStreetMap)",
      "description": "Vuelve a leer las veterinarias de OpenStreetMap y da de baja las que ya no figuran ahí. Tarda unos segundos.",
      "run": "Importar ahora",
      "running": "Importando…",
      "resultTitle": "Última corrida",
      "scanned": "Leídas de OSM",
      "upserted": "Guardadas",
      "skippedNoCoords": "Sin coordenadas",
      "upsertFailed": "Fallaron al guardar",
      "swept": "Dadas de baja",
      "sweepSkippedTitle": "No se dio de baja nada",
      "sweepSkipped_below_threshold": "La respuesta de OpenStreetMap trajo muchas menos veterinarias de las que ya teníamos, así que no se borró nada. Probá de nuevo en un rato.",
      "sweepSkipped_upsert_failures": "Algunas veterinarias no se pudieron guardar, así que no se borró nada: una baja podría haber sido un error nuestro.",
      "error": "No se pudo completar la importación."
    }
```

In `en.json`:

```json
      "vets": "Veterinary clinics"
```

```json
    "vets": {
      "title": "Veterinary clinics (OpenStreetMap)",
      "description": "Re-reads veterinary clinics from OpenStreetMap and retires the ones it no longer lists. Takes a few seconds.",
      "run": "Import now",
      "running": "Importing…",
      "resultTitle": "Last run",
      "scanned": "Read from OSM",
      "upserted": "Saved",
      "skippedNoCoords": "Without coordinates",
      "upsertFailed": "Failed to save",
      "swept": "Retired",
      "sweepSkippedTitle": "Nothing was retired",
      "sweepSkipped_below_threshold": "OpenStreetMap returned far fewer clinics than we already had, so nothing was deleted. Try again later.",
      "sweepSkipped_upsert_failures": "Some clinics could not be saved, so nothing was deleted: a removal might have been our own fault.",
      "error": "The import could not be completed."
    }
```

In `pt.json`:

```json
      "vets": "Veterinárias"
```

```json
    "vets": {
      "title": "Veterinárias (OpenStreetMap)",
      "description": "Relê as veterinárias do OpenStreetMap e retira as que já não constam lá. Leva alguns segundos.",
      "run": "Importar agora",
      "running": "Importando…",
      "resultTitle": "Última execução",
      "scanned": "Lidas do OSM",
      "upserted": "Salvas",
      "skippedNoCoords": "Sem coordenadas",
      "upsertFailed": "Falharam ao salvar",
      "swept": "Retiradas",
      "sweepSkippedTitle": "Nada foi retirado",
      "sweepSkipped_below_threshold": "O OpenStreetMap devolveu bem menos veterinárias do que já tínhamos, então nada foi apagado. Tente de novo mais tarde.",
      "sweepSkipped_upsert_failures": "Algumas veterinárias não puderam ser salvas, então nada foi apagado: uma remoção poderia ter sido erro nosso.",
      "error": "Não foi possível concluir a importação."
    }
```

The `admin` namespace is already registered in `web/src/i18n/index.ts`, so rule #21 needs nothing here — adding keys is enough.

- [ ] **Step 2: Write the failing page test**

Create `frontend/packages/web/src/pages/admin/VetsAdminPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VetsAdminPage } from './VetsAdminPage';

const importVets = vi.fn();
vi.mock('@shared/api/client', () => ({ apiClient: { importVets: () => importVets() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VetsAdminPage />
    </QueryClientProvider>,
  );
}

describe('VetsAdminPage', () => {
  beforeEach(() => importVets.mockReset());

  it('shows the run counters after a successful import', async () => {
    importVets.mockResolvedValue({
      scanned: 183, upserted: 183, skipped_no_coords: 0, upsert_failed: 0, swept: 1,
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() => expect(screen.getByText('183')).toBeInTheDocument());
    expect(screen.getByText('vets.swept')).toBeInTheDocument();
  });

  // A blocked sweep reports swept: 0, exactly like a clean run with nothing stale.
  // If the page renders only the number, the operator cannot tell "nothing to do"
  // from "we refused to delete" — which is the whole reason the reason exists.
  it('explains a blocked sweep instead of showing a bare zero', async () => {
    importVets.mockResolvedValue({
      scanned: 2, upserted: 2, skipped_no_coords: 0, upsert_failed: 0,
      swept: 0, sweep_skipped: 'below_threshold',
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'vets.run' }));

    await waitFor(() =>
      expect(screen.getByText('vets.sweepSkipped_below_threshold')).toBeInTheDocument(),
    );
  });

  it('disables the button while the import is in flight', async () => {
    let resolve!: (v: unknown) => void;
    importVets.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();

    const button = screen.getByRole('button', { name: 'vets.run' });
    await userEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    resolve({ scanned: 1, upserted: 1, skipped_no_coords: 0, upsert_failed: 0, swept: 0 });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd frontend/packages/web && pnpm vitest run src/pages/admin/VetsAdminPage.test.tsx
```

Expected: FAIL — `Failed to resolve import "./VetsAdminPage"`.

- [ ] **Step 4: Write the page**

Create `frontend/packages/web/src/pages/admin/VetsAdminPage.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@shared/api/client';
import type { VetImportResult } from '@shared/types';

/** One labelled number from the run. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

export function VetsAdminPage() {
  const { t } = useTranslation('admin');
  const run = useMutation<VetImportResult>({ mutationFn: () => apiClient.importVets() });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('vets.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('vets.description')}</p>
      </div>

      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={run.isPending}
        className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-60"
      >
        {run.isPending ? t('vets.running') : t('vets.run')}
      </button>

      {run.isError && <p className="text-sm text-red-600">{t('vets.error')}</p>}

      {run.data && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('vets.resultTitle')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label={t('vets.scanned')} value={run.data.scanned} />
            <Stat label={t('vets.upserted')} value={run.data.upserted} />
            <Stat label={t('vets.swept')} value={run.data.swept} />
            <Stat label={t('vets.skippedNoCoords')} value={run.data.skipped_no_coords} />
            <Stat label={t('vets.upsertFailed')} value={run.data.upsert_failed} />
          </div>

          {/* A blocked sweep also reports swept: 0. Without this block the operator
              would read a refusal to delete as "there was nothing to delete". */}
          {run.data.sweep_skipped && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 px-3 py-2">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {t('vets.sweepSkippedTitle')}
              </div>
              <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                {t(`vets.sweepSkipped_${run.data.sweep_skipped}`)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd frontend/packages/web && pnpm vitest run src/pages/admin/VetsAdminPage.test.tsx
```

Expected: PASS, three tests.

- [ ] **Step 6: Add the route and the nav link**

In `frontend/packages/web/src/pages/admin/AdminLayout.tsx`, append to `navLinks`:

```tsx
  { to: '/admin/vets', labelKey: 'nav.vets' },
```

In `frontend/packages/web/src/App.tsx`, add the import next to the other admin pages:

```tsx
import { VetsAdminPage } from './pages/admin/VetsAdminPage';
```

and the route inside the `AdminLayout` block:

```tsx
              <Route path="vets" element={<VetsAdminPage />} />
```

- [ ] **Step 7: Full web verification**

Vitest does not typecheck; the build does, and CI runs both.

```bash
cd frontend/packages/web && pnpm test:run; echo "TEST=$?"
pnpm run build; echo "BUILD=$?"
```

Expected: `TEST=0` and `BUILD=0`.

- [ ] **Step 8: Commit**

```bash
git add frontend/packages/web/src/pages/admin/VetsAdminPage.tsx frontend/packages/web/src/pages/admin/VetsAdminPage.test.tsx frontend/packages/web/src/pages/admin/AdminLayout.tsx frontend/packages/web/src/App.tsx frontend/packages/web/src/i18n/locales/es.json frontend/packages/web/src/i18n/locales/en.json frontend/packages/web/src/i18n/locales/pt.json
git commit -m "feat(web): pagina de administracion para importar veterinarias de OSM"
```

---

## Task 8: End-to-end check against the real thing

- [ ] **Step 1: Run the full backend suite one more time**

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets_test?sslmode=disable" JWT_SECRET=test-secret go test ./... -count=1 > /tmp/bt.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 2: Drive the endpoint locally against real Overpass**

Start the server against the **development** database (`lostpets`, not `lostpets_test`), log in as the seeded admin (`admin@searchpet.local` / `admin1234`), and call the endpoint:

```bash
cd backend && DATABASE_URL="postgres://postgres:postgres@localhost:5433/lostpets?sslmode=disable" JWT_SECRET=test-secret go run ./cmd/server &
sleep 20
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@searchpet.local","password":"admin1234"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:8080/api/admin/vets/import -H "Authorization: Bearer $TOKEN" | tee /tmp/import.json
kill %1
```

Expected: a body with `scanned` and `upserted` around **183**, `upsert_failed: 0`, and either `swept` ≥ 0 with no `sweep_skipped`, or a `sweep_skipped` you can explain. If `scanned` is 0, Overpass rejected the request — check the server log for the status line.

- [ ] **Step 3: Confirm the sweep did what it claims**

```bash
docker exec lostpets-db psql -U postgres -d lostpets -c \
  "SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS vivas, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS bajas FROM vets;"
```

Expected: `vivas` matches the `upserted` from Step 2, and `bajas` matches `swept`. Numbers that disagree mean the cutoff or the `source` filter is wrong — do not open the PR.

- [ ] **Step 4: Open the PR**

Use the `searchpet-pr` skill. Before opening, confirm the branch did not pick up anything else (rule #30):

```bash
git fetch origin && git log --oneline origin/main..HEAD
```

Expected: only the commits from this plan.

---

## Notes for the implementer

- **`GOOSE`-style migrations are not involved.** Do not add a file to `backend/migrations/`; AutoMigrate creates `deleted_at`. Task 1 Step 6 is the proof, and it is not optional.
- **The threshold test must be seen red** (Task 4 Step 5). This project has been bitten three times by a check that passes when nothing was checked — rules #18, #40 and #41 all describe the same shape.
- **Do not "simplify" `sweepReason` into a single boolean.** The two guards answer different questions, and collapsing them loses the reason the operator reads in the panel.
- **Do not point `DATABASE_URL` at `lostpets` for tests.** Only Task 8 uses it, on purpose, and only to drive the server.
