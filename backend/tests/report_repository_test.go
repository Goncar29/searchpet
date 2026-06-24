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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Lost Dog", Type: "perro", Status: domain.PetStatusRegistered}
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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Nearby Dog", Type: "perro", Status: domain.PetStatusLost}
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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Far Dog", Type: "perro", Status: domain.PetStatusLost}
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
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: fmt.Sprintf("Pet-%s", uuid.New().String()[:6]), Type: "perro", Status: domain.PetStatusRegistered}
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

	pet1 := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Close Dog", Type: "perro", Status: domain.PetStatusLost}
	pet2 := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Far Dog", Type: "perro", Status: domain.PetStatusLost}
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

// FindNearby must filter on the pet's CURRENT status (MapVisibleStatuses),
// not just geography. A pet that was lost and is now registered/archived must
// NOT leak its stale reports, but a found pet's report SHOULD still show — a
// fresh "found here" marker tells trackers the pet was recovered.
func TestReportRepository_FindNearby_FiltersByPetStatus(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)

	registeredPet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Reunited Dog", Type: "perro", Status: domain.PetStatusRegistered}
	archivedPet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Closed Dog", Type: "perro", Status: domain.PetStatusArchived}
	foundPet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Found Dog", Type: "perro", Status: domain.PetStatusFound}
	lostPet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Still Lost Dog", Type: "perro", Status: domain.PetStatusLost}
	for _, p := range []*domain.Pet{registeredPet, archivedPet, foundPet, lostPet} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create pet: %v", err)
		}
	}

	// All reports sit at the exact same point — only the pet's current status
	// should determine visibility.
	hiddenRegistered := &domain.Report{ID: uuid.New(), PetID: registeredPet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	hiddenArchived := &domain.Report{ID: uuid.New(), PetID: archivedPet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	visibleFound := &domain.Report{ID: uuid.New(), PetID: foundPet.ID, ReporterID: owner.ID, Status: "found", Latitude: mvdLat, Longitude: mvdLng}
	visibleLost := &domain.Report{ID: uuid.New(), PetID: lostPet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	for _, r := range []*domain.Report{hiddenRegistered, hiddenArchived, visibleFound, visibleLost} {
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report: %v", err)
		}
	}

	results, err := reportRepo.FindNearby(mvdLat, mvdLng, 1000)
	if err != nil {
		t.Fatalf("FindNearby: %v", err)
	}

	inResults := func(id uuid.UUID) bool {
		for _, r := range results {
			if r.ID == id {
				return true
			}
		}
		return false
	}
	if inResults(hiddenRegistered.ID) {
		t.Error("registered pet's stale report must NOT appear in the nearby feed")
	}
	if inResults(hiddenArchived.ID) {
		t.Error("archived pet's stale report must NOT appear in the nearby feed")
	}
	if !inResults(visibleFound.ID) {
		t.Error("a found pet's report MUST appear in the nearby feed (recovery signal)")
	}
	if !inResults(visibleLost.ID) {
		t.Error("a currently-lost pet's report MUST appear in the nearby feed")
	}
}

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

func TestReportRepository_UpdateVerified(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Verify Pet", Type: "perro", Status: domain.PetStatusRegistered}
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
