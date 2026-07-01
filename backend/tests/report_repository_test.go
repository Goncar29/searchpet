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
	epRepo := repository.NewEpisodeRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Nearby Dog", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	ep, err := epRepo.Open(pet.ID.String())
	if err != nil {
		t.Fatalf("Open episode: %v", err)
	}

	// Place report exactly at Montevideo center, stamped with current episode.
	report := &domain.Report{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ReporterID: owner.ID,
		Status:     "lost",
		Latitude:   mvdLat,
		Longitude:  mvdLng,
		EpisodeID:  &ep.ID,
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
	epRepo := repository.NewEpisodeRepository(gormDB)

	owner := newTestUser(t, userRepo)

	pet1 := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Close Dog", Type: "perro", Status: domain.PetStatusLost}
	pet2 := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Far Dog", Type: "perro", Status: domain.PetStatusLost}
	for _, p := range []*domain.Pet{pet1, pet2} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create pet: %v", err)
		}
	}

	ep1, err := epRepo.Open(pet1.ID.String())
	if err != nil {
		t.Fatalf("Open episode pet1: %v", err)
	}
	ep2, err := epRepo.Open(pet2.ID.String())
	if err != nil {
		t.Fatalf("Open episode pet2: %v", err)
	}

	// close: ~111 m north of center
	close := &domain.Report{ID: uuid.New(), PetID: pet1.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat + 0.001, Longitude: mvdLng, EpisodeID: &ep1.ID}
	// far: ~555 m north of center
	far := &domain.Report{ID: uuid.New(), PetID: pet2.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat + 0.005, Longitude: mvdLng, EpisodeID: &ep2.ID}
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
	epRepo := repository.NewEpisodeRepository(gormDB)

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

	// Open episodes for the two visible pets so their reports satisfy the
	// episode-scope filter (reports.episode_id = pets.current_episode_id).
	// registeredPet and archivedPet are excluded by status filter regardless.
	epFound, err := epRepo.Open(foundPet.ID.String())
	if err != nil {
		t.Fatalf("Open episode foundPet: %v", err)
	}
	epLost, err := epRepo.Open(lostPet.ID.String())
	if err != nil {
		t.Fatalf("Open episode lostPet: %v", err)
	}

	// All reports sit at the exact same point — only the pet's current status
	// (and episode scope) determines visibility.
	hiddenRegistered := &domain.Report{ID: uuid.New(), PetID: registeredPet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	hiddenArchived := &domain.Report{ID: uuid.New(), PetID: archivedPet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng}
	visibleFound := &domain.Report{ID: uuid.New(), PetID: foundPet.ID, ReporterID: owner.ID, Status: "found", Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &epFound.ID}
	visibleLost := &domain.Report{ID: uuid.New(), PetID: lostPet.ID, ReporterID: owner.ID, Status: "lost", Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &epLost.ID}
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

// Deleting a report that an abuse report points at must succeed: the FK
// reports_abuse.target_report_id -> reports(id) cascades to NULL (migration
// 000014) instead of blocking the delete with a violation. The abuse report
// is an audit record and survives, just with a null target.
func TestReportRepository_Delete_NullsReferencingAbuseReport(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	reportRepo := repository.NewReportRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	reporter := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Reported", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}
	rep := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID, Status: "lost", Latitude: -34.9, Longitude: -56.16}
	if err := reportRepo.Create(rep); err != nil {
		t.Fatalf("Create report: %v", err)
	}

	abuse := &domain.ReportAbuse{
		ID:             uuid.New(),
		TargetReportID: ptrUUID(rep.ID),
		ReporterID:     reporter.ID,
		Reason:         "spam",
		Status:         "pending",
	}
	if err := gormDB.Create(abuse).Error; err != nil {
		t.Fatalf("Create abuse report: %v", err)
	}

	if err := reportRepo.Delete(ctx, rep.ID); err != nil {
		t.Fatalf("Delete report referenced by abuse report: %v", err)
	}

	var got domain.ReportAbuse
	if err := gormDB.First(&got, "id = ?", abuse.ID).Error; err != nil {
		t.Fatalf("abuse report should survive the delete: %v", err)
	}
	if got.TargetReportID != nil {
		t.Errorf("want target_report_id NULL after report delete, got %v", *got.TargetReportID)
	}
}

// A re-lost pet must show ONLY its current episode's reports on the map,
// not pins from a previous, resolved search episode.
func TestReportRepository_FindNearby_ScopesToCurrentEpisode(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	epRepo := repository.NewEpisodeRepository(db)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex",
		Type: "perro", Status: domain.PetStatusLost}
	petRepo.Create(pet)

	// Episode 1 (old) with a pin, then closed.
	ep1, _ := epRepo.Open(pet.ID.String())
	oldReport := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &ep1.ID}
	reportRepo.Create(oldReport)
	epRepo.CloseCurrent(pet.ID.String(), domain.PetStatusFound)

	// Episode 2 (current) with its own pin. Pet is lost again.
	ep2, _ := epRepo.Open(pet.ID.String())
	newReport := &domain.Report{ID: uuid.New(), PetID: pet.ID, ReporterID: owner.ID,
		Status: "lost", Latitude: mvdLat, Longitude: mvdLng, EpisodeID: &ep2.ID}
	reportRepo.Create(newReport)

	got, err := reportRepo.FindNearby(mvdLat, mvdLng, 50000)
	if err != nil {
		t.Fatalf("find nearby: %v", err)
	}
	for _, r := range got {
		if r.ID == oldReport.ID {
			t.Errorf("old-episode report must NOT appear on the map")
		}
	}
	foundNew := false
	for _, r := range got {
		if r.ID == newReport.ID {
			foundNew = true
		}
	}
	if !foundNew {
		t.Errorf("current-episode report must appear on the map")
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
