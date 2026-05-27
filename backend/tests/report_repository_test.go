package tests

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// Montevideo coordinates used as a stable anchor for PostGIS tests.
const (
	mvdLat = -34.9011
	mvdLng = -56.1645
)

func TestReportRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Lost Dog", Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	report := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: owner.ID,
		Status:     "lost",
		Latitude:   mvdLat,
		Longitude:  mvdLng,
	}
	if err := reportRepo.Create(report); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	got, err := reportRepo.FindByID(report.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.PetID != report.PetID {
		t.Errorf("want petID %s, got %s", report.PetID, got.PetID)
	}
	if got.Status != "lost" {
		t.Errorf("want status 'lost', got %q", got.Status)
	}
}

func TestReportRepository_FindByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	reportRepo := repository.NewReportRepository(gormDB)

	_, err := reportRepo.FindByID(uuid.New().String())
	if !errors.Is(err, domain.ErrReportNotFound) {
		t.Errorf("want ErrReportNotFound, got %v", err)
	}
}

func TestReportRepository_FindNearby_Found(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Nearby Dog", Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Place report exactly at Montevideo center
	report := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: owner.ID,
		Status:     "lost",
		Latitude:   mvdLat,
		Longitude:  mvdLng,
	}
	if err := reportRepo.Create(report); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	// Query with 1000 m radius centered on the same point — must find the report
	results, err := reportRepo.FindNearby(mvdLat, mvdLng, 1000)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}

	found := false
	for _, r := range results {
		if r.ID == report.ID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected report %s to appear in FindNearby results", report.ID)
	}
}

func TestReportRepository_FindNearby_NotFound_OutsideRadius(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Far Dog", Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Place report ~111 km north of Montevideo (approx 1 degree latitude offset)
	report := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: owner.ID,
		Status:     "lost",
		Latitude:   mvdLat + 1.0, // ~111 km away
		Longitude:  mvdLng,
	}
	if err := reportRepo.Create(report); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	// Query with 1000 m radius at Montevideo center — must NOT find the far report
	results, err := reportRepo.FindNearby(mvdLat, mvdLng, 1000)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}

	for _, r := range results {
		if r.ID == report.ID {
			t.Errorf("did not expect report %s (far away) to appear in FindNearby with 1 km radius", report.ID)
		}
	}
}

func TestReportRepository_FindByPetID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: fmt.Sprintf("Pet-%s", uuid.New().String()[:6]), Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	r1 := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	r2 := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID, Status: "sighting", Latitude: mvdLat + 0.001, Longitude: mvdLng}
	for _, r := range []*domain.Report{r1, r2} {
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report: %v", err)
		}
	}

	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID: %v", err)
	}
	if len(reports) < 2 {
		t.Errorf("want at least 2 reports, got %d", len(reports))
	}
}

func TestReportRepository_FindNearby_OrderedByDistance(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)

	pet1 := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Close Dog", Type: "perro", Status: "active"}
	pet2 := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Far Dog", Type: "perro", Status: "active"}
	for _, p := range []*domain.Pet{pet1, pet2} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create pet: %v", err)
		}
	}

	// close: ~111 m north of center
	close := &domain.Report{ID: uuid.New(), PetID: pet1.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat + 0.001, Longitude: mvdLng}
	// far: ~555 m north of center
	far := &domain.Report{ID: uuid.New(), PetID: pet2.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat + 0.005, Longitude: mvdLng}
	for _, r := range []*domain.Report{far, close} { // insert far first to rule out insertion order
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report: %v", err)
		}
	}

	results, err := reportRepo.FindNearby(mvdLat, mvdLng, 2000)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}

	// Find positions of close and far in the result slice
	closeIdx, farIdx := -1, -1
	for i, r := range results {
		if r.ID == close.ID {
			closeIdx = i
		}
		if r.ID == far.ID {
			farIdx = i
		}
	}
	if closeIdx == -1 || farIdx == -1 {
		t.Fatalf("both reports must appear in results (closeIdx=%d, farIdx=%d)", closeIdx, farIdx)
	}
	if closeIdx > farIdx {
		t.Errorf("closer report (idx=%d) should appear before farther report (idx=%d)", closeIdx, farIdx)
	}
}

func TestReportRepository_UpdateVerified(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Verify Pet", Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	report := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: owner.ID,
		Status:     "sighting",
		Latitude:   mvdLat,
		Longitude:  mvdLng,
	}
	if err := reportRepo.Create(report); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	adminID := uuid.New()
	if err := reportRepo.UpdateVerified(ctx, report.ID, adminID); err != nil {
		t.Fatalf("UpdateVerified: %v", err)
	}

	got, err := reportRepo.FindByID(report.ID.String())
	if err != nil {
		t.Fatalf("FindByID after UpdateVerified: %v", err)
	}
	if !got.IsVerified {
		t.Error("want IsVerified=true after UpdateVerified")
	}
}
