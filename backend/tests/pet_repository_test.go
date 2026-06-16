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

// newTestUser creates and persists a minimal User for FK requirements.
func newTestUser(t *testing.T, db interface{ Create(context.Context, *domain.User) error }) *domain.User {
	t.Helper()
	u := &domain.User{
		ID:           uuid.New(),
		Email:        fmt.Sprintf("owner-%s@test.com", uuid.New().String()[:8]),
		PasswordHash: "hashed",
		Name:         "Test Owner",
	}
	if err := db.Create(context.Background(), u); err != nil {
		t.Fatalf("newTestUser: %v", err)
	}
	return u
}


func TestPetRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		ID:      uuid.New(),
		OwnerID: ptrUUID(owner.ID),
		Name:    "Firulais",
		Type:    "perro",
		Status:  domain.PetStatusRegistered,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.Name != pet.Name {
		t.Errorf("want name %q, got %q", pet.Name, got.Name)
	}
	if got.Type != pet.Type {
		t.Errorf("want type %q, got %q", pet.Type, got.Type)
	}
}

func TestPetRepository_FindByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	_, err := petRepo.FindByID(uuid.New().String())
	if !errors.Is(err, domain.ErrPetNotFound) {
		t.Errorf("want ErrPetNotFound, got %v", err)
	}
}

func TestPetRepository_Search_ByType(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	// Insert two pets of different types with lost status (visible in feed)
	dog := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex", Type: "perro", Status: domain.PetStatusLost}
	cat := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Michi", Type: "gato", Status: domain.PetStatusLost}
	for _, p := range []*domain.Pet{dog, cat} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}

	// Search by type — no status filter → defaults to lost+stray feed
	results, total, err := petRepo.Search(domain.PetSearchCriteria{Type: "perro", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if total < 1 {
		t.Errorf("want at least 1 result for type=perro, got %d", total)
	}
	for _, p := range results {
		if p.Type != "perro" {
			t.Errorf("unexpected type %q in perro search", p.Type)
		}
	}
}

// The optional geo filter matches pets that have at least one report within
// the given radius, and excludes pets whose reports are all outside it.
func TestPetRepository_Search_GeoRadius(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test — requires PostGIS")
	}
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)

	nearDog := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Near Dog", Type: "perro", Status: domain.PetStatusLost}
	farDog := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Far Dog", Type: "perro", Status: domain.PetStatusLost}
	for _, p := range []*domain.Pet{nearDog, farDog} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create pet: %v", err)
		}
	}

	near := &domain.Report{ID: uuid.New(), PetID: nearDog.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	far := &domain.Report{ID: uuid.New(), PetID: farDog.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat + 1.0, Longitude: mvdLng} // ~111 km north
	for _, r := range []*domain.Report{near, far} {
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report: %v", err)
		}
	}

	lat, lng, radius := mvdLat, mvdLng, 1000.0
	results, total, err := petRepo.Search(domain.PetSearchCriteria{Lat: &lat, Lng: &lng, RadiusMeters: &radius, Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search geo: %v", err)
	}

	has := func(id uuid.UUID) bool {
		for _, p := range results {
			if p.ID == id {
				return true
			}
		}
		return false
	}
	if !has(nearDog.ID) {
		t.Error("a pet with a report inside the radius must match")
	}
	if has(farDog.ID) {
		t.Error("a pet whose only report is outside the radius must NOT match")
	}
	if total != 1 {
		t.Errorf("expected total=1 (one pet inside radius), got total=%d", total)
	}
}

// TestPetRepository_Search_GeoRadius_DistinctCount guards against total being
// inflated when a single pet has multiple reports that all fall inside the radius.
// Before the fix, GORM's COUNT over a multi-column DISTINCT string produced
// count(*) which counted each matching row — so two reports → total=2 for one pet.
func TestPetRepository_Search_GeoRadius_DistinctCount(t *testing.T) {
	if testing.Short() {
		t.Skip("integration test — requires PostGIS")
	}
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)

	owner := newTestUser(t, userRepo)

	// One pet with TWO reports, both inside the 1 km radius around Montevideo.
	dog := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Multi-Report Dog", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(dog); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	report1 := &domain.Report{ID: uuid.New(), PetID: dog.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	report2 := &domain.Report{ID: uuid.New(), PetID: dog.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat + 0.001, Longitude: mvdLng} // ~111 m north, still inside 1 km
	for _, r := range []*domain.Report{report1, report2} {
		if err := reportRepo.Create(r); err != nil {
			t.Fatalf("Create report: %v", err)
		}
	}

	lat, lng, radius := mvdLat, mvdLng, 1000.0
	results, total, err := petRepo.Search(domain.PetSearchCriteria{Lat: &lat, Lng: &lng, RadiusMeters: &radius, Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search geo: %v", err)
	}

	if len(results) != 1 {
		t.Errorf("expected exactly 1 pet in results slice, got %d", len(results))
	}
	if total != 1 {
		// If total != 1 the COUNT bug is present: GORM used count(*) instead of
		// COUNT(DISTINCT pets.id), counting each matching report row separately.
		t.Errorf("expected total=1 (one distinct pet), got total=%d — COUNT(*) bug still present", total)
	}
}

func TestPetRepository_Search_ByStatus(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	registered := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Registered", Type: "perro", Status: domain.PetStatusRegistered}
	found := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Found", Type: "perro", Status: domain.PetStatusFound}
	for _, p := range []*domain.Pet{registered, found} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}

	results, _, err := petRepo.Search(domain.PetSearchCriteria{Statuses: []string{domain.PetStatusFound}, Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("Search by status: %v", err)
	}
	for _, p := range results {
		if p.Status != domain.PetStatusFound {
			t.Errorf("unexpected status %q in found search", p.Status)
		}
	}
}

func TestPetRepository_Search_DefaultFeedStatuses(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	// Create one pet for each status
	lostID := ptrUUID(owner.ID)
	strayPetReporter := owner.ID
	lost := &domain.Pet{ID: uuid.New(), OwnerID: lostID, Name: "Lost", Type: "perro", Status: domain.PetStatusLost}
	stray := &domain.Pet{ID: uuid.New(), ReporterID: ptrUUID(strayPetReporter), Name: "Stray", Type: "perro", Status: domain.PetStatusStray}
	registered := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Registered", Type: "perro", Status: domain.PetStatusRegistered}
	for _, p := range []*domain.Pet{lost, stray, registered} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}

	// Empty Statuses → defaults to lost+stray
	results, _, err := petRepo.Search(domain.PetSearchCriteria{Page: 1, Limit: 100})
	if err != nil {
		t.Fatalf("Search default: %v", err)
	}
	for _, p := range results {
		if p.Status != domain.PetStatusLost && p.Status != domain.PetStatusStray {
			t.Errorf("feed returned non-feed pet with status %q", p.Status)
		}
	}
}

func TestPetRepository_Search_ActiveReturnsEmpty(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	// Querying for "active" (legacy/invalid) should return 0 results since
	// the migration maps active→registered and there are no "active" rows.
	results, _, err := petRepo.Search(domain.PetSearchCriteria{Statuses: []string{"active"}, Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("Search active: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results for status=active, got %d", len(results))
	}
}

func TestPetRepository_FindByOwnerID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)

	myPet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Mine", Type: "gato", Status: domain.PetStatusRegistered}
	theirPet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(other.ID), Name: "Theirs", Type: "gato", Status: domain.PetStatusRegistered}
	for _, p := range []*domain.Pet{myPet, theirPet} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	pets, err := petRepo.FindByOwnerID(owner.ID.String())
	if err != nil {
		t.Fatalf("FindByOwnerID: %v", err)
	}
	if len(pets) < 1 {
		t.Fatal("expected at least 1 pet for owner")
	}
	for _, p := range pets {
		if p.OwnerID == nil || *p.OwnerID != owner.ID {
			t.Errorf("unexpected owner_id in results")
		}
	}
}

func TestPetRepository_UpdateStatus(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Status Pet", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := petRepo.UpdateStatus(pet.ID.String(), domain.PetStatusFound); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.Status != domain.PetStatusFound {
		t.Errorf("want status 'found', got %q", got.Status)
	}
}

func TestPetRepository_Delete_Cascade(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Delete Me", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Attach a photo so we can verify cascade
	photo := &domain.Photo{
		ID:         uuid.New(),
		PetID:      pet.ID,
		URL:        "https://example.com/photo.jpg",
		UploadedBy: owner.ID,
		IsPrimary:  true,
	}
	if err := photoRepo.Create(photo); err != nil {
		t.Fatalf("Create photo: %v", err)
	}

	if err := petRepo.Delete(pet.ID.String()); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Pet must be gone
	_, err := petRepo.FindByID(pet.ID.String())
	if !errors.Is(err, domain.ErrPetNotFound) {
		t.Errorf("want ErrPetNotFound after delete, got %v", err)
	}

	// Photos must be gone too
	photos, err := photoRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID after delete: %v", err)
	}
	if len(photos) != 0 {
		t.Errorf("want 0 photos after cascade delete, got %d", len(photos))
	}
}
