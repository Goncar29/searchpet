package tests

import (
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// episodeTestDeps bundles all repos and services needed for episode flow tests.
type episodeTestDeps struct {
	userRepo      repository.UserRepository
	petRepo       repository.PetRepository
	reportRepo    repository.ReportRepository
	episodeRepo   repository.EpisodeRepository
	petService    service.PetService
	reportService service.ReportService
}

func newEpisodeTestDeps(t *testing.T, db *gorm.DB) episodeTestDeps {
	t.Helper()
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	episodeRepo := repository.NewEpisodeRepository(db)
	uow := repository.NewUnitOfWork(db)
	statRepo := repository.NewStatEventRepository(db)
	bus := event.NewEventBus()
	episodeSvc := service.NewEpisodeService()
	// photoService is nil — episode flow tests don't exercise photo deletion.
	petSvc := service.NewPetService(petRepo, bus, nil, reportRepo, uow, statRepo, episodeSvc, episodeRepo)
	reportSvc := service.NewReportService(reportRepo, petRepo, bus, statRepo, episodeSvc, episodeRepo, uow)
	return episodeTestDeps{
		userRepo:      userRepo,
		petRepo:       petRepo,
		reportRepo:    reportRepo,
		episodeRepo:   episodeRepo,
		petService:    petSvc,
		reportService: reportSvc,
	}
}

// TestCreateReport_LostOpensEpisodeAndStampsReport verifies that a "lost" report
// on a registered pet opens a search episode and stamps the report with its ID.
func TestCreateReport_LostOpensEpisodeAndStampsReport(t *testing.T) {
	db := testdb.SetupTestDB(t)
	deps := newEpisodeTestDeps(t, db)
	owner := newTestUser(t, deps.userRepo)

	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex",
		Type: "perro", Status: domain.PetStatusRegistered}
	if err := deps.petRepo.Create(pet); err != nil {
		t.Fatalf("create pet: %v", err)
	}

	rep, err := deps.reportService.CreateReport(owner.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "lost", Latitude: mvdLat, Longitude: mvdLng,
	})
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	if rep.EpisodeID == nil {
		t.Fatalf("report should be stamped with an episode id")
	}
	cur, err := deps.episodeRepo.FindCurrent(pet.ID.String())
	if err != nil {
		t.Fatalf("find current episode: %v", err)
	}
	if cur == nil || *rep.EpisodeID != cur.ID {
		t.Fatalf("report episode %v must equal pet current episode %v", rep.EpisodeID, cur)
	}
	reloaded, err := deps.petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("reload pet: %v", err)
	}
	if reloaded.Status != domain.PetStatusLost {
		t.Fatalf("pet should be lost, got %s", reloaded.Status)
	}
}

// TestEpisodeFlow_ReLostPet_MapShowsOnlyCurrentEpisode is the end-to-end scenario:
// a pet lost, found, then re-lost through the services shows only the second
// episode's report on the nearby map.
func TestEpisodeFlow_ReLostPet_MapShowsOnlyCurrentEpisode(t *testing.T) {
	db := testdb.SetupTestDB(t)
	deps := newEpisodeTestDeps(t, db)
	owner := newTestUser(t, deps.userRepo)

	// Create the pet and publish as lost (episode 1).
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Rex",
		Type: "perro", Status: domain.PetStatusRegistered}
	if err := deps.petRepo.Create(pet); err != nil {
		t.Fatalf("create pet: %v", err)
	}
	_, err := deps.petService.PublishLost(owner.ID.String(), pet.ID.String(),
		dto.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng})
	if err != nil {
		t.Fatalf("publish lost: %v", err)
	}

	// Mark found → closes episode 1.
	if _, err := deps.petService.MarkAsFound(owner.ID.String(), pet.ID.String()); err != nil {
		t.Fatalf("mark found: %v", err)
	}
	// Reset to registered so we can publish lost again (found → lost is not in the state machine).
	if err := deps.petRepo.UpdateStatus(pet.ID.String(), domain.PetStatusRegistered); err != nil {
		t.Fatalf("reset to registered: %v", err)
	}

	// Re-publish lost (episode 2).
	_, err = deps.petService.PublishLost(owner.ID.String(), pet.ID.String(),
		dto.PublishLostRequest{Latitude: mvdLat, Longitude: mvdLng})
	if err != nil {
		t.Fatalf("re-publish lost: %v", err)
	}

	cur, err := deps.episodeRepo.FindCurrent(pet.ID.String())
	if err != nil {
		t.Fatalf("find current episode: %v", err)
	}
	if cur == nil {
		t.Fatal("expected a current episode after re-publish-lost")
	}
	if cur.EndedAt != nil {
		t.Fatalf("current episode after re-lost should be open, got EndedAt=%v", cur.EndedAt)
	}

	got, err := deps.reportRepo.FindNearby(mvdLat, mvdLng, 50000)
	if err != nil {
		t.Fatalf("find nearby: %v", err)
	}
	if len(got) == 0 {
		t.Errorf("expected the current-episode report to appear on the map")
	}
	// No report belonging to a non-current episode should appear.
	for _, r := range got {
		if r.PetID == pet.ID && (r.EpisodeID == nil || *r.EpisodeID != cur.ID) {
			t.Errorf("map shows report %s from a non-current episode (episodeID=%v, current=%s)",
				r.ID, r.EpisodeID, cur.ID)
		}
	}
}
