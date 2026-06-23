# Local Test Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `backend/cmd/seed` Go command that populates a local DB with a rich, idempotent dataset (admin + users, pets across all statuses, PostGIS reports, community records, and image-search photos with real embeddings) for end-to-end local testing.

**Architecture:** Standalone Go command mirroring `backend/cmd/import-vets`. Pure fixture builders (fixed UUIDs) live in `fixtures.go` and are unit-tested; DB upserts and embedding generation live in `seed.go`; `main.go` wires config/DB, a production guard, and a `--reset` flag. Embeddings reuse `EmbeddingService.BackfillAll` (the production index path).

**Tech Stack:** Go 1.25, GORM, PostgreSQL+PostGIS+pgvector, Jina CLIP (`jina-clip-v2`), bcrypt, zap.

---

## File Structure

- Create `backend/cmd/seed/main.go` — entry point: config, logger, DB connect, AutoMigrate, `--reset`/`--force` flags, production guard, orchestration.
- Create `backend/cmd/seed/fixtures.go` — fixed UUIDs + pure builder funcs returning domain structs. No DB, no bcrypt-at-build (passwords are plaintext here; hashing happens in seed.go).
- Create `backend/cmd/seed/seed.go` — `Seed(db, embedder, opts)`: reset, upsert-by-PK, password hashing, then embeddings.
- Create `backend/cmd/seed/fixtures_test.go` — unit tests for builder invariants.
- Create `backend/cmd/seed/README.md` — admin credentials, how to run, self-match test procedure.
- Modify `Makefile` — add a `seed` target.

Shared constants used across files (declare in `fixtures.go`):

```go
// Fixed IDs so re-running upserts instead of duplicating.
var (
	adminID    = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	userAID    = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	userBID    = uuid.MustParse("00000000-0000-0000-0000-000000000003")
	userCID    = uuid.MustParse("00000000-0000-0000-0000-000000000004") // unverified
	montevideoLat = -34.9011
	montevideoLng = -56.1645
)

// SeedUser carries a plaintext password; seed.go hashes it at insert time.
type SeedUser struct {
	User     domain.User
	Password string
}
```

---

## Task 1: Scaffold command + production guard + Makefile

**Files:**
- Create: `backend/cmd/seed/main.go`
- Modify: `Makefile`

- [ ] **Step 1: Create `main.go` with flags, DB connect, production guard, and a no-op call**

```go
// Command seed populates a LOCAL database with a rich test dataset (users incl.
// an admin, pets across all statuses, PostGIS reports, community records, and
// image-search photos with real Jina embeddings). Idempotent: re-running
// upserts by fixed IDs. Local-only by intent — refuses non-local DATABASE_URL
// unless --force.
package main

import (
	"context"
	"flag"
	"net/url"
	"strings"

	"go.uber.org/zap"
	"lost-pets/config"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/pkg/database"
	"lost-pets/pkg/logger"
)

func main() {
	reset := flag.Bool("reset", false, "delete seed-managed rows before inserting")
	force := flag.Bool("force", false, "allow running against a non-local DATABASE_URL")
	// Embeddings are OPT-IN: Jina's free tier is tied to a single shared key (also
	// used in prod), so a normal seed must never touch Jina. Only this flag does.
	withEmbeddings := flag.Bool("with-embeddings", false, "generate image-search embeddings via Jina (uses the shared JINA_API_KEY)")
	flag.Parse()

	cfg := config.Load()
	log := logger.Init(cfg.Environment)
	defer log.Sync() //nolint:errcheck

	if !*force && !isLocalDB(cfg.DatabaseURL) {
		log.Fatal("seed: refusing to run against a non-local DATABASE_URL; pass --force to override",
			zap.String("hint", "this command is for local testing only"))
	}

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("seed: DB connect failed", zap.Error(err))
	}

	if err := db.AutoMigrate(
		&domain.User{}, &domain.Pet{}, &domain.Photo{}, &domain.Report{},
		&domain.BlockedUser{}, &domain.ReportAbuse{}, &domain.LocalGroup{},
		&domain.GroupMember{}, &domain.SuccessStory{}, &domain.UserPoints{},
		&domain.Badge{}, &domain.PetEmbedding{},
	); err != nil {
		log.Fatal("seed: AutoMigrate failed", zap.Error(err))
	}

	embedder := service.NewEmbeddingService(
		repository.NewPetEmbeddingRepository(db),
		repository.NewPetRepository(db),
		repository.NewPhotoRepository(db),
		cfg.JinaAPIKey,
	)
	if cfg.JinaEndpoint != "" {
		embedder.SetEndpoint(cfg.JinaEndpoint)
	}

	if err := Seed(context.Background(), db, embedder, SeedOptions{
		Reset:          *reset,
		WithEmbeddings: *withEmbeddings,
		JinaAPIKey:     cfg.JinaAPIKey,
		Logger:         log,
	}); err != nil {
		log.Fatal("seed: failed", zap.Error(err))
	}
	log.Info("seed: completed")
}

// isLocalDB returns true when the DATABASE_URL host is localhost/127.0.0.1.
func isLocalDB(dsn string) bool {
	u, err := url.Parse(dsn)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || strings.HasPrefix(host, "host.docker.internal")
}
```

- [ ] **Step 2: Add a temporary stub so the package compiles**

Create the minimal `Seed`/`SeedOptions` stub in `seed.go` (replaced in Task 6):

```go
package main

import (
	"context"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"lost-pets/internal/service"
)

type SeedOptions struct {
	Reset          bool
	WithEmbeddings bool
	JinaAPIKey     string
	Logger         *zap.Logger
}

func Seed(ctx context.Context, db *gorm.DB, embedder *service.EmbeddingService, opts SeedOptions) error {
	opts.Logger.Info("seed: stub — no data yet")
	return nil
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd backend && go build ./cmd/seed`
Expected: exits 0, no output.

- [ ] **Step 4: Add the Makefile target**

In `Makefile`, after the `db-shell` target, add:

```makefile
seed: ## Poblar la BD local con datos de prueba (idempotente). Usa --reset para limpiar.
	cd backend && go run ./cmd/seed $(ARGS)
```

- [ ] **Step 5: Verify the guard runs (no DB write yet)**

Run: `cd backend && DATABASE_URL='postgres://postgres:postgres@localhost:5432/lostpets?sslmode=disable' go run ./cmd/seed`
Expected: logs `seed: stub — no data yet` then `seed: completed` (Docker DB must be up).

- [ ] **Step 6: Commit**

```bash
git add backend/cmd/seed/main.go backend/cmd/seed/seed.go Makefile
git commit -m "feat(seed): scaffold local seed command with prod guard and make target"
```

---

## Task 2: User fixtures (admin + normals + blocked pair)

**Files:**
- Create: `backend/cmd/seed/fixtures.go`
- Test: `backend/cmd/seed/fixtures_test.go`

- [ ] **Step 1: Write the failing test**

```go
package main

import "testing"

func TestSeedUsers_adminAndVariety(t *testing.T) {
	users := SeedUsers()

	if len(users) < 4 {
		t.Fatalf("expected at least 4 users, got %d", len(users))
	}

	var admin *SeedUser
	verified, unverified := 0, 0
	for i := range users {
		u := &users[i]
		if u.User.ID == adminID {
			admin = u
		}
		if u.User.IsVerified {
			verified++
		} else {
			unverified++
		}
		if u.Password == "" {
			t.Errorf("user %s has empty password", u.User.Email)
		}
	}
	if admin == nil || !admin.User.IsAdmin {
		t.Fatal("expected an admin user with IsAdmin=true")
	}
	if verified == 0 || unverified == 0 {
		t.Errorf("expected both verified and unverified users, got v=%d u=%d", verified, unverified)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./cmd/seed -run TestSeedUsers`
Expected: FAIL — `SeedUsers` undefined.

- [ ] **Step 3: Implement `fixtures.go` with the shared vars and `SeedUsers`**

```go
package main

import (
	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

var (
	adminID = uuid.MustParse("00000000-0000-0000-0000-000000000001")
	userAID = uuid.MustParse("00000000-0000-0000-0000-000000000002")
	userBID = uuid.MustParse("00000000-0000-0000-0000-000000000003")
	userCID = uuid.MustParse("00000000-0000-0000-0000-000000000004")

	montevideoLat = -34.9011
	montevideoLng = -56.1645
)

// SeedUser carries a plaintext password; seed.go hashes it at insert time.
type SeedUser struct {
	User     domain.User
	Password string
}

// SeedUsers returns the fixed set of users: an admin, two verified normals
// (a blocked pair), and one unverified user.
func SeedUsers() []SeedUser {
	return []SeedUser{
		{
			User: domain.User{
				ID: adminID, Email: "admin@searchpet.local", Name: "Admin Local",
				IsAdmin: true, IsVerified: true, EmailVerified: true, City: "Montevideo",
			},
			Password: "admin1234",
		},
		{
			User: domain.User{
				ID: userAID, Email: "ana@searchpet.local", Name: "Ana", Phone: "+59899111111",
				IsVerified: true, EmailVerified: true, City: "Montevideo",
			},
			Password: "user1234",
		},
		{
			User: domain.User{
				ID: userBID, Email: "bruno@searchpet.local", Name: "Bruno", Phone: "+59899222222",
				IsVerified: true, EmailVerified: true, City: "Montevideo",
			},
			Password: "user1234",
		},
		{
			User: domain.User{
				ID: userCID, Email: "caro@searchpet.local", Name: "Caro",
				IsVerified: false, City: "Salto",
			},
			Password: "user1234",
		},
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./cmd/seed -run TestSeedUsers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/seed/fixtures.go backend/cmd/seed/fixtures_test.go
git commit -m "feat(seed): user fixtures (admin, verified pair, unverified)"
```

---

## Task 3: Pet + photo fixtures (all statuses, edge combos)

**Files:**
- Modify: `backend/cmd/seed/fixtures.go`
- Test: `backend/cmd/seed/fixtures_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestSeedPets_coversAllStatusesAndEdges(t *testing.T) {
	pets := SeedPets()
	statuses := map[string]bool{}
	var hasNoDescription, hasNoPhoto, hasStrayOwnerless bool

	photos := SeedPhotos()
	petIDsWithPhoto := map[uuid.UUID]bool{}
	for _, p := range photos {
		petIDsWithPhoto[p.PetID] = true
	}

	for _, p := range pets {
		statuses[p.Status] = true
		if p.Description == "" {
			hasNoDescription = true
		}
		if !petIDsWithPhoto[p.ID] {
			hasNoPhoto = true
		}
		if p.Status == domain.PetStatusStray && p.OwnerID == nil && p.ReporterID != nil {
			hasStrayOwnerless = true
		}
	}
	for _, s := range []string{"registered", "lost", "stray", "found", "archived"} {
		if !statuses[s] {
			t.Errorf("missing pet with status %q", s)
		}
	}
	if !hasNoDescription || !hasNoPhoto || !hasStrayOwnerless {
		t.Errorf("edge coverage missing: noDesc=%v noPhoto=%v strayOwnerless=%v",
			hasNoDescription, hasNoPhoto, hasStrayOwnerless)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./cmd/seed -run TestSeedPets`
Expected: FAIL — `SeedPets`/`SeedPhotos` undefined.

- [ ] **Step 3: Implement `SeedPets` and `SeedPhotos`**

Append to `fixtures.go`. Pet IDs are fixed. Image-search pets (`petLost1ID`, `petStray1ID`) use **stable public photo URLs** so embeddings can be generated and the self-match test can re-upload the same bytes.

```go
var (
	petLost1ID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a1") // lost, with photo (image-search)
	petLost2ID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a2") // lost, NO description, NO photo
	petStray1ID = uuid.MustParse("00000000-0000-0000-0000-0000000000a3") // stray, ownerless, with photo (image-search)
	petFoundID  = uuid.MustParse("00000000-0000-0000-0000-0000000000a4") // found
	petRegID    = uuid.MustParse("00000000-0000-0000-0000-0000000000a5") // registered
	petArchID   = uuid.MustParse("00000000-0000-0000-0000-0000000000a6") // archived

	photoLost1ID  = uuid.MustParse("00000000-0000-0000-0000-0000000000b1")
	photoStray1ID = uuid.MustParse("00000000-0000-0000-0000-0000000000b2")

	// Stable public images (Wikimedia Commons). Used for image-search embeddings;
	// download these exact URLs to run the self-match test.
	dogPhotoURL = "https://upload.wikimedia.org/wikipedia/commons/d/d9/Collage_of_Nine_Dogs.jpg"
	catPhotoURL = "https://upload.wikimedia.org/wikipedia/commons/1/15/Cat_August_2010-4.jpg"
)

func ptrUUID(id uuid.UUID) *uuid.UUID { return &id }

func SeedPets() []domain.Pet {
	return []domain.Pet{
		{ID: petLost1ID, OwnerID: ptrUUID(userAID), Name: "Firulais", Type: "perro",
			Breed: "Labrador", Color: "Negro", Description: "Collar rojo, muy amigable.",
			Status: domain.PetStatusLost},
		{ID: petLost2ID, OwnerID: ptrUUID(userBID), Name: "Michi", Type: "gato",
			Status: domain.PetStatusLost}, // no description, no photo
		{ID: petStray1ID, ReporterID: ptrUUID(userAID), Name: "Callejero Parque", Type: "perro",
			Color: "Marrón", Description: "Visto cerca del parque.",
			Status: domain.PetStatusStray, ReporterContactPublic: true},
		{ID: petFoundID, OwnerID: ptrUUID(userBID), Name: "Rex", Type: "perro",
			Breed: "Pastor", Status: domain.PetStatusFound},
		{ID: petRegID, OwnerID: ptrUUID(userAID), Name: "Luna", Type: "gato",
			Color: "Blanco", Status: domain.PetStatusRegistered},
		{ID: petArchID, OwnerID: ptrUUID(userCID), Name: "Toby", Type: "perro",
			Status: domain.PetStatusArchived},
	}
}

func SeedPhotos() []domain.Photo {
	return []domain.Photo{
		{ID: photoLost1ID, PetID: petLost1ID, URL: dogPhotoURL, UploadedBy: userAID, IsPrimary: true},
		{ID: photoStray1ID, PetID: petStray1ID, URL: catPhotoURL, UploadedBy: userAID, IsPrimary: true},
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./cmd/seed -run TestSeedPets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/seed/fixtures.go backend/cmd/seed/fixtures_test.go
git commit -m "feat(seed): pet and photo fixtures across all statuses and edge cases"
```

---

## Task 4: Report fixtures (PostGIS coords + dates)

**Files:**
- Modify: `backend/cmd/seed/fixtures.go`
- Test: `backend/cmd/seed/fixtures_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestSeedReports_coordsAndDescriptionMix(t *testing.T) {
	reports := SeedReports()
	if len(reports) < 3 {
		t.Fatalf("expected >=3 reports, got %d", len(reports))
	}
	var withDesc, withoutDesc bool
	for _, r := range reports {
		if r.Latitude == 0 || r.Longitude == 0 {
			t.Errorf("report %s has zero coordinates", r.ID)
		}
		if r.LocationDescription == "" {
			withoutDesc = true
		} else {
			withDesc = true
		}
	}
	if !withDesc || !withoutDesc {
		t.Errorf("expected reports with and without description (with=%v without=%v)", withDesc, withoutDesc)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./cmd/seed -run TestSeedReports`
Expected: FAIL — `SeedReports` undefined.

- [ ] **Step 3: Implement `SeedReports`**

```go
func offset(base, d float64) float64 { return base + d }

func SeedReports() []domain.Report {
	now := time.Now()
	older := now.Add(-72 * time.Hour)
	return []domain.Report{
		{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000c1"),
			PetID: petLost1ID, ReporterID: userAID, Status: "lost",
			Latitude: offset(montevideoLat, 0.004), Longitude: offset(montevideoLng, 0.004),
			LocationDescription: "Última vez en Pocitos.", OccurredAt: &older},
		{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000c2"),
			PetID: petLost1ID, ReporterID: userBID, Status: "sighting",
			Latitude: offset(montevideoLat, -0.006), Longitude: offset(montevideoLng, 0.002),
			OccurredAt: &now}, // no description
		{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000c3"),
			PetID: petStray1ID, ReporterID: userAID, Status: "lost",
			Latitude: offset(montevideoLat, 0.001), Longitude: offset(montevideoLng, -0.003),
			LocationDescription: "Cerca del Parque Rodó."},
	}
}
```

Add `"time"` to the `fixtures.go` import block.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./cmd/seed -run TestSeedReports`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/seed/fixtures.go backend/cmd/seed/fixtures_test.go
git commit -m "feat(seed): report fixtures with PostGIS coords and date variety"
```

---

## Task 5: Community fixtures (block, abuse, group, story, points/badge)

**Files:**
- Modify: `backend/cmd/seed/fixtures.go`
- Test: `backend/cmd/seed/fixtures_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestSeedCommunity_allKindsPresent(t *testing.T) {
	c := SeedCommunity()
	if len(c.Blocks) == 0 || len(c.Abuse) == 0 || len(c.Groups) == 0 ||
		len(c.Members) == 0 || len(c.Stories) == 0 || len(c.Points) == 0 || len(c.Badges) == 0 {
		t.Fatalf("community fixtures incomplete: %+v counts", c)
	}
	// The blocked pair must reference the two known users.
	if c.Blocks[0].BlockerID != userAID || c.Blocks[0].BlockedID != userBID {
		t.Errorf("expected block A->B, got %v->%v", c.Blocks[0].BlockerID, c.Blocks[0].BlockedID)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./cmd/seed -run TestSeedCommunity`
Expected: FAIL — `SeedCommunity` undefined.

- [ ] **Step 3: Implement `SeedCommunity`**

```go
type CommunityData struct {
	Blocks  []domain.BlockedUser
	Abuse   []domain.ReportAbuse
	Groups  []domain.LocalGroup
	Members []domain.GroupMember
	Stories []domain.SuccessStory
	Points  []domain.UserPoints
	Badges  []domain.Badge
}

func SeedCommunity() CommunityData {
	groupID := uuid.MustParse("00000000-0000-0000-0000-0000000000d1")
	return CommunityData{
		Blocks: []domain.BlockedUser{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e1"),
				BlockerID: userAID, BlockedID: userBID, Reason: "spam"},
		},
		Abuse: []domain.ReportAbuse{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e2"),
				ReporterID: userBID, TargetUserID: ptrUUID(userCID),
				Reason: "Perfil sospechoso", Status: "pending"},
		},
		Groups: []domain.LocalGroup{
			{ID: groupID, Name: "Rescatistas Montevideo", City: "Montevideo",
				Description: "Grupo de prueba", CreatedBy: adminID, MemberCount: 1},
		},
		Members: []domain.GroupMember{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e3"),
				GroupID: groupID, UserID: userAID},
		},
		Stories: []domain.SuccessStory{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e4"),
				PetID: petFoundID, UserID: userBID, Title: "¡Rex volvió a casa!",
				Body: "Gracias a la comunidad.", LikeCount: 3},
		},
		Points: []domain.UserPoints{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e5"),
				UserID: userAID, Points: 120, TotalReports: 5, FoundCount: 1},
		},
		Badges: []domain.Badge{
			{ID: uuid.MustParse("00000000-0000-0000-0000-0000000000e6"),
				UserID: userAID, BadgeType: "first_helper"},
		},
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./cmd/seed -run TestSeedCommunity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/seed/fixtures.go backend/cmd/seed/fixtures_test.go
git commit -m "feat(seed): community fixtures (block, abuse, group, story, points, badge)"
```

---

## Task 6: Seed logic (reset + upsert + password hashing)

**Files:**
- Modify: `backend/cmd/seed/seed.go` (replace the Task 1 stub)

- [ ] **Step 1: Replace the stub with the full implementation**

```go
package main

import (
	"context"

	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

type SeedOptions struct {
	Reset          bool
	WithEmbeddings bool
	JinaAPIKey     string
	Logger         *zap.Logger
}

func Seed(ctx context.Context, db *gorm.DB, embedder *service.EmbeddingService, opts SeedOptions) error {
	if opts.Reset {
		if err := resetSeedData(db); err != nil {
			return err
		}
		opts.Logger.Info("seed: reset done")
	}

	// Users (hash plaintext passwords here).
	for _, su := range SeedUsers() {
		hash, err := bcrypt.GenerateFromPassword([]byte(su.Password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		u := su.User
		u.PasswordHash = string(hash)
		if err := upsert(db, &u); err != nil {
			return err
		}
	}

	for _, p := range SeedPets() {
		p := p
		if err := upsert(db, &p); err != nil {
			return err
		}
	}
	for _, ph := range SeedPhotos() {
		ph := ph
		if err := upsert(db, &ph); err != nil {
			return err
		}
	}
	for _, r := range SeedReports() {
		r := r
		if err := upsert(db, &r); err != nil {
			return err
		}
	}

	c := SeedCommunity()
	for i := range c.Groups {
		if err := upsert(db, &c.Groups[i]); err != nil {
			return err
		}
	}
	for i := range c.Members {
		if err := upsert(db, &c.Members[i]); err != nil {
			return err
		}
	}
	for i := range c.Blocks {
		if err := upsert(db, &c.Blocks[i]); err != nil {
			return err
		}
	}
	for i := range c.Abuse {
		if err := upsert(db, &c.Abuse[i]); err != nil {
			return err
		}
	}
	for i := range c.Stories {
		if err := upsert(db, &c.Stories[i]); err != nil {
			return err
		}
	}
	for i := range c.Points {
		if err := upsert(db, &c.Points[i]); err != nil {
			return err
		}
	}
	for i := range c.Badges {
		if err := upsert(db, &c.Badges[i]); err != nil {
			return err
		}
	}
	opts.Logger.Info("seed: core records upserted")

	return seedEmbeddings(ctx, embedder, opts)
}

// upsert inserts or updates by primary key (records carry fixed UUIDs).
func upsert(db *gorm.DB, model interface{}) error {
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(model).Error
}

// resetSeedData deletes seed-managed rows in reverse-dependency order.
func resetSeedData(db *gorm.DB) error {
	// pet_embeddings first (FK to pets/photos), then dependents, then users.
	for _, m := range []interface{}{
		&domain.PetEmbedding{}, &domain.Report{}, &domain.Photo{},
		&domain.Badge{}, &domain.UserPoints{}, &domain.SuccessStory{},
		&domain.GroupMember{}, &domain.LocalGroup{}, &domain.ReportAbuse{},
		&domain.BlockedUser{}, &domain.Pet{}, &domain.User{},
	} {
		if err := db.Where("1 = 1").Delete(m).Error; err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 2: Verify it builds and unit tests still pass**

Run: `cd backend && go build ./cmd/seed && go test ./cmd/seed`
Expected: build ok; fixture tests PASS.

- [ ] **Step 3: Run against the local DB and verify rows**

Run: `make seed` (Docker DB up). Then:
`make db-shell` → `SELECT email, is_admin FROM users; SELECT status, count(*) FROM pets GROUP BY status;`
Expected: 4 users incl. `admin@searchpet.local` with `is_admin=t`; pets across all 5 statuses.

- [ ] **Step 4: Verify idempotency**

Run `make seed` again. Expected: no duplicate-key errors; counts unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/seed/seed.go
git commit -m "feat(seed): idempotent upsert of users, pets, reports and community data"
```

---

## Task 7: Image-search embeddings (BackfillAll, Jina-gated)

**Files:**
- Modify: `backend/cmd/seed/seed.go`

- [ ] **Step 1: Implement `seedEmbeddings`**

Append to `seed.go`:

```go
// seedEmbeddings indexes the lost/stray pets' photos using the SAME production
// path as the reindex endpoint (EmbeddingService.BackfillAll). OPT-IN only:
// Jina's free tier is tied to a single shared key (also used in prod), so a
// normal seed must never call Jina. Runs only with --with-embeddings AND a key.
func seedEmbeddings(ctx context.Context, embedder *service.EmbeddingService, opts SeedOptions) error {
	if !opts.WithEmbeddings {
		opts.Logger.Info("seed: skipping image-search embeddings",
			zap.String("hint", "pass --with-embeddings to generate them (uses the shared Jina key)"))
		return nil
	}
	if opts.JinaAPIKey == "" {
		opts.Logger.Warn("seed: --with-embeddings set but JINA_API_KEY is empty — skipping",
			zap.String("hint", "set JINA_API_KEY (the shared free-tier key) to enable photo search locally"))
		return nil
	}
	res := embedder.BackfillAll(ctx)
	opts.Logger.Info("seed: embeddings backfilled",
		zap.Int("pets_scanned", res.PetsScanned),
		zap.Int("photos_indexed", res.PhotosIndexed),
		zap.Int("photos_failed", res.PhotosFailed),
	)
	return nil
}
```

`BackfillResult` is defined in `backend/internal/service/embedding_service.go:236`
with fields `PetsScanned`, `PhotosIndexed`, `PhotosFailed` (all `int`).

- [ ] **Step 2: Verify it builds**

Run: `cd backend && go build ./cmd/seed`
Expected: build ok.

- [ ] **Step 3: Run with the opt-in flag + Jina key and verify embeddings**

Run: `cd backend && JINA_API_KEY=<shared-key> DATABASE_URL=<local> go run ./cmd/seed --with-embeddings`
Then `make db-shell` → `SELECT count(*) FROM pet_embeddings;`
Expected: ≥ 2 rows (the dog + cat photos). Logs show `photos_indexed >= 2`.
Also confirm a plain `go run ./cmd/seed` (no flag) logs `skipping image-search embeddings` and writes 0 embedding rows.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/seed/seed.go
git commit -m "feat(seed): generate image-search embeddings via BackfillAll when Jina is configured"
```

---

## Task 8: README (admin creds + run + self-match procedure)

**Files:**
- Create: `backend/cmd/seed/README.md`

- [ ] **Step 1: Write the README**

```markdown
# seed — local test data

Populates a LOCAL database with a rich, idempotent dataset for end-to-end testing.
Refuses to run against a non-local `DATABASE_URL` unless `--force`.

## Run

```bash
make seed                              # idempotent upsert (NO Jina calls)
make seed ARGS=--reset                 # wipe seed-managed rows first
make seed ARGS=--with-embeddings       # also generate image-search embeddings (opt-in)
```

Requires the local Postgres+PostGIS container (`make db-up`).

**Image search is opt-in.** Jina's free tier is tied to a single shared key (the
same one used in prod — a new key is not free). A normal `make seed` never calls
Jina. Only `--with-embeddings` does, and only when `JINA_API_KEY` is set. The seed
indexes just 2 photos, so the token draw on the shared quota is negligible.

## Accounts

| Role  | Email                   | Password   |
|-------|-------------------------|------------|
| Admin | admin@searchpet.local   | admin1234  |
| User  | ana@searchpet.local     | user1234   |
| User  | bruno@searchpet.local   | user1234   |
| User  | caro@searchpet.local    | user1234   |

`ana` blocks `bruno` (test bidirectional block in chat).

## Image-search self-match test (#2)

1. Seed with `make seed ARGS=--with-embeddings` and `JINA_API_KEY` set so embeddings exist.
2. Download the exact photo of a seeded lost/stray pet from its URL (see
   `dogPhotoURL` / `catPhotoURL` in `fixtures.go`).
3. Upload that downloaded file via the app's photo search.
4. Expected: the matching pet appears with high similarity. A low score points at
   index-time vs query-time byte divergence (see the design doc).
```

- [ ] **Step 2: Commit**

```bash
git add backend/cmd/seed/README.md
git commit -m "docs(seed): document accounts, run instructions and self-match test"
```

---

## Self-Review

**Spec coverage:**
- General dataset → Tasks 2–5. ✅
- Edge cases (no desc / no photo / ownerless stray / all statuses) → Task 3 (+ Task 4 report description mix). ✅
- Image search `#2` (real embeddings, public URLs, self-match doc) → Tasks 3, 7, 8. ✅
- Admin role → Task 2 (admin user) + Task 8 (creds). ✅
- Idempotency + `--reset` + Makefile → Tasks 1, 6. ✅
- Embeddings opt-in (`--with-embeddings`) + `JINA_API_KEY`-gated, single shared key → Tasks 1, 7. ✅
- Local-only guard → Task 1. ✅

**Placeholder scan:** None. `BackfillResult` field names were verified against source (`PetsScanned`/`PhotosIndexed`/`PhotosFailed`).

**Type consistency:** `SeedUser`, `SeedUsers`, `SeedPets`, `SeedPhotos`, `SeedReports`, `SeedCommunity`/`CommunityData`, `upsert`, `Seed`/`SeedOptions`, fixed `*ID` vars, and `ptrUUID` are used consistently across tasks. `domain.PetStatus*` constants match `backend/internal/domain/pet_status.go`.

## Out of Scope (carried from spec)
Production/staging seeding, Cloudinary uploads, fixing `#2`, frontend changes.
