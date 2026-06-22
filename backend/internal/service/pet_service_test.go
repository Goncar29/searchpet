package service_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: PetRepository
// ============================================================

type mockPetRepo struct {
	pet         *domain.Pet
	findErr     error
	updateErr   error
	statusCalls []string // últimos statuses pasados a UpdateStatus
}

func (m *mockPetRepo) Create(pet *domain.Pet) error        { return nil }
func (m *mockPetRepo) FindByID(_ string) (*domain.Pet, error) {
	return m.pet, m.findErr
}
func (m *mockPetRepo) FindByOwnerID(_ string) ([]domain.Pet, error)    { return nil, nil }
func (m *mockPetRepo) FindByReporterID(_ string) ([]domain.Pet, error) { return nil, nil }
func (m *mockPetRepo) Update(_ *domain.Pet) error                   { return m.updateErr }
func (m *mockPetRepo) UpdateStatus(_ string, status string) error {
	m.statusCalls = append(m.statusCalls, status)
	return m.updateErr
}
func (m *mockPetRepo) Delete(_ string) error { return nil }
func (m *mockPetRepo) Search(_ domain.PetSearchCriteria) ([]domain.Pet, int64, error) {
	return nil, 0, nil
}

// ============================================================
// Helpers
// ============================================================

func petWithStatus(ownerID uuid.UUID, status string) *domain.Pet {
	return &domain.Pet{
		ID:      uuid.New(),
		OwnerID: &ownerID,
		Name:    "Rex",
		Type:    "perro",
		Status:  status,
	}
}

// ============================================================
// Tests: MarkAsFound
// ============================================================

func TestMarkAsFound_HappyPath(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusLost)}
	bus := event.NewEventBus()

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	pet, err := svc.MarkAsFound(ownerID.String(), repo.pet.ID.String())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if pet.Status != domain.PetStatusFound {
		t.Errorf("expected status %q, got %q", domain.PetStatusFound, pet.Status)
	}
	if len(repo.statusCalls) != 1 || repo.statusCalls[0] != domain.PetStatusFound {
		t.Errorf("expected UpdateStatus called with %q, got %v", domain.PetStatusFound, repo.statusCalls)
	}
}

func TestMarkAsFound_NonOwner_Returns403(t *testing.T) {
	ownerID := uuid.New()
	anotherUser := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusLost)}
	bus := event.NewEventBus()

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	_, err := svc.MarkAsFound(anotherUser.String(), repo.pet.ID.String())

	if err == nil {
		t.Fatal("expected error for non-owner, got nil")
	}
	if err.Error() != domain.ErrForbidden.Error() {
		t.Errorf("expected ErrForbidden, got %v", err)
	}
	if len(repo.statusCalls) != 0 {
		t.Error("UpdateStatus should NOT have been called for non-owner")
	}
}

func TestMarkAsFound_AlreadyFound_IsIdempotent(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "found")}
	bus := event.NewEventBus()

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	pet, err := svc.MarkAsFound(ownerID.String(), repo.pet.ID.String())

	if err != nil {
		t.Fatalf("expected no error for idempotent call, got %v", err)
	}
	if pet.Status != "found" {
		t.Errorf("expected status 'found', got %q", pet.Status)
	}
	if len(repo.statusCalls) != 0 {
		t.Error("UpdateStatus should NOT have been called when already found")
	}
}

func TestMarkAsFound_ArchivedPet_ReturnsInvalidTransition(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusArchived)}
	bus := event.NewEventBus()

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	_, err := svc.MarkAsFound(ownerID.String(), repo.pet.ID.String())

	if err == nil {
		t.Fatal("expected error for archived pet, got nil")
	}
	if err != domain.ErrInvalidStatusTransition {
		t.Errorf("expected ErrInvalidStatusTransition, got %v", err)
	}
}

func TestMarkAsFound_PublishesEvent(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusLost)}
	bus := event.NewEventBus()

	eventReceived := make(chan event.PetFoundEvent, 1)
	bus.Subscribe("pet.found", func(payload interface{}) {
		if e, ok := payload.(event.PetFoundEvent); ok {
			eventReceived <- e
		}
	})

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	_, err := svc.MarkAsFound(ownerID.String(), repo.pet.ID.String())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// El evento se publica en una goroutine; esperamos hasta 500ms
	select {
	case e := <-eventReceived:
		if e.OwnerID != ownerID {
			t.Errorf("event OwnerID mismatch: got %v, want %v", e.OwnerID, ownerID)
		}
		if e.PetName != "Rex" {
			t.Errorf("event PetName mismatch: got %q, want %q", e.PetName, "Rex")
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout waiting for pet.found event")
	}
}

// ============================================================
// Tests: UpdatePet → pet.lost event
// ============================================================

func TestUpdatePet_PublishesPetLostEvent(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "registered")}
	bus := event.NewEventBus()

	eventReceived := make(chan event.PetLostEvent, 1)
	bus.Subscribe("pet.lost", func(payload interface{}) {
		if e, ok := payload.(event.PetLostEvent); ok {
			eventReceived <- e
		}
	})

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	petID := repo.pet.ID

	_, err := svc.UpdatePet(ownerID.String(), petID.String(), dto.UpdatePetRequest{Status: "lost"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case e := <-eventReceived:
		if e.PetID != petID {
			t.Errorf("event PetID mismatch: got %v, want %v", e.PetID, petID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout: pet.lost event was not published after status transition to 'lost'")
	}
}

func TestUpdatePet_DoesNotPublishPetLostWhenAlreadyLost(t *testing.T) {
	ownerID := uuid.New()
	// Pet is already lost — updating to "lost" again should NOT re-publish the event.
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "lost")}
	bus := event.NewEventBus()

	eventPublished := make(chan struct{}, 1)
	bus.Subscribe("pet.lost", func(_ interface{}) {
		eventPublished <- struct{}{}
	})

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	petID := repo.pet.ID

	_, err := svc.UpdatePet(ownerID.String(), petID.String(), dto.UpdatePetRequest{Status: "lost"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case <-eventPublished:
		t.Error("pet.lost event should NOT be published when status was already 'lost'")
	case <-time.After(200 * time.Millisecond):
		// Expected: no event fired within 200ms.
	}
}

func TestUpdatePet_DoesNotPublishPetLostForOtherTransitions(t *testing.T) {
	ownerID := uuid.New()
	// Status is "lost" — transitioning to "found" must NOT fire pet.lost again.
	// Instead test a name-only update on a registered pet — no status change, no pet.lost event.
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusRegistered)}
	bus := event.NewEventBus()

	eventPublished := make(chan struct{}, 1)
	bus.Subscribe("pet.lost", func(_ interface{}) {
		eventPublished <- struct{}{}
	})

	svc := service.NewPetService(repo, bus, nil, nil, nil)
	petID := repo.pet.ID

	// Update name only — status stays "registered", no pet.lost event.
	_, err := svc.UpdatePet(ownerID.String(), petID.String(), dto.UpdatePetRequest{Name: "Rex Updated"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case <-eventPublished:
		t.Error("pet.lost event should NOT be published for non-lost status transitions")
	case <-time.After(200 * time.Millisecond):
		// Expected: no event fired.
	}
}

// ============================================================
// Phase 6.2 — CreatePet, UpdatePet, stray auth, concurrency
// ============================================================

// capturingPetRepo extends mockPetRepo so Create stores the pet and FindByID can return it.
type capturingPetRepo struct {
	mockPetRepo
	createdPet *domain.Pet
}

func (m *capturingPetRepo) Create(pet *domain.Pet) error {
	m.createdPet = pet
	m.mockPetRepo.pet = pet
	return nil
}

func TestCreatePet_DefaultsToRegistered(t *testing.T) {
	ownerID := uuid.New()
	repo := &capturingPetRepo{}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	_, err := svc.CreatePet(ownerID.String(), dto.CreatePetRequest{Name: "Rex", Type: "perro"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.createdPet.Status != domain.PetStatusRegistered {
		t.Errorf("expected status %q, got %q", domain.PetStatusRegistered, repo.createdPet.Status)
	}
	if repo.createdPet.OwnerID == nil || *repo.createdPet.OwnerID != ownerID {
		t.Errorf("expected OwnerID %v, got %v", ownerID, repo.createdPet.OwnerID)
	}
	if repo.createdPet.Version != 1 {
		t.Errorf("expected Version=1, got %d", repo.createdPet.Version)
	}
}

func TestCreatePet_StrayHasNilOwnerAndReporter(t *testing.T) {
	reporterID := uuid.New()
	repo := &capturingPetRepo{}
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	svc := service.NewPetService(repo, nil, nil, reportRepo, uow)

	_, err := svc.CreatePet(reporterID.String(), dto.CreatePetRequest{
		Name: "Stray Cat", Type: "gato", Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{Latitude: -34.9011, Longitude: -56.1645},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.createdPet.OwnerID != nil {
		t.Errorf("stray pet OwnerID should be nil, got %v", repo.createdPet.OwnerID)
	}
	if repo.createdPet.ReporterID == nil || *repo.createdPet.ReporterID != reporterID {
		t.Errorf("expected ReporterID %v, got %v", reporterID, repo.createdPet.ReporterID)
	}
	if repo.createdPet.Status != domain.PetStatusStray {
		t.Errorf("expected status %q, got %q", domain.PetStatusStray, repo.createdPet.Status)
	}
}

func TestCreatePet_StrayPersistsReporterContactPublicFlag(t *testing.T) {
	reporterID := uuid.New()
	repo := &capturingPetRepo{}
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	svc := service.NewPetService(repo, nil, nil, reportRepo, uow)

	_, err := svc.CreatePet(reporterID.String(), dto.CreatePetRequest{
		Name: "Stray Cat", Type: "gato", Status: domain.PetStatusStray,
		ReporterContactPublic: true,
		InitialReport:         &dto.InitialReportRequest{Latitude: -34.9011, Longitude: -56.1645},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !repo.createdPet.ReporterContactPublic {
		t.Error("expected ReporterContactPublic=true to be persisted on the stray pet")
	}
}

func TestCreatePet_RegisteredIgnoresReporterContactPublicFlag(t *testing.T) {
	ownerID := uuid.New()
	repo := &capturingPetRepo{}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	// A registered (owned) pet has no reporter; the opt-in must never leak onto it.
	_, err := svc.CreatePet(ownerID.String(), dto.CreatePetRequest{
		Name: "Rex", Type: "perro", ReporterContactPublic: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repo.createdPet.ReporterContactPublic {
		t.Error("registered pet must not carry ReporterContactPublic=true")
	}
}

func TestCreatePet_StrayPublishesPetStrayEvent(t *testing.T) {
	reporterID := uuid.New()
	repo := &capturingPetRepo{}
	bus := event.NewEventBus()

	eventReceived := make(chan event.PetStrayEvent, 1)
	bus.Subscribe("pet.stray", func(payload interface{}) {
		if e, ok := payload.(event.PetStrayEvent); ok {
			eventReceived <- e
		}
	})

	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	_, err := svc.CreatePet(reporterID.String(), dto.CreatePetRequest{
		Name: "Stray Cat", Type: "gato", Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{Latitude: -34.9011, Longitude: -56.1645},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case e := <-eventReceived:
		if e.PetID != repo.createdPet.ID {
			t.Errorf("event PetID mismatch: got %v, want %v", e.PetID, repo.createdPet.ID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout: pet.stray event was not published after creating a stray pet")
	}
}

func TestCreatePet_RegisteredDoesNotPublishPetStrayEvent(t *testing.T) {
	ownerID := uuid.New()
	repo := &capturingPetRepo{}
	bus := event.NewEventBus()

	eventPublished := make(chan struct{}, 1)
	bus.Subscribe("pet.stray", func(_ interface{}) {
		eventPublished <- struct{}{}
	})

	svc := service.NewPetService(repo, bus, nil, nil, nil)

	_, err := svc.CreatePet(ownerID.String(), dto.CreatePetRequest{Name: "Rex", Type: "perro"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case <-eventPublished:
		t.Error("pet.stray event should NOT be published when creating a registered pet")
	case <-time.After(200 * time.Millisecond):
		// Expected: no event fired within 200ms.
	}
}

func TestCreatePet_RejectsInvalidCreationStatuses(t *testing.T) {
	ownerID := uuid.New()
	svc := service.NewPetService(&capturingPetRepo{}, nil, nil, nil, nil)

	for _, status := range []string{domain.PetStatusLost, domain.PetStatusFound, domain.PetStatusArchived} {
		t.Run(status, func(t *testing.T) {
			_, err := svc.CreatePet(ownerID.String(), dto.CreatePetRequest{
				Name: "Rex", Type: "perro", Status: status,
			})
			if err == nil {
				t.Errorf("expected error for creation with status %q, got nil", status)
			}
		})
	}
}

func TestUpdatePet_RejectsInvalidTransition(t *testing.T) {
	ownerID := uuid.New()
	// registered → found is not an allowed edge
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusRegistered)}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	_, err := svc.UpdatePet(ownerID.String(), repo.pet.ID.String(), dto.UpdatePetRequest{Status: domain.PetStatusFound})
	if err != domain.ErrInvalidStatusTransition {
		t.Errorf("expected ErrInvalidStatusTransition, got %v", err)
	}
}

func TestUpdatePet_VersionIncrementsOnStatusChange(t *testing.T) {
	ownerID := uuid.New()
	pet := petWithStatus(ownerID, domain.PetStatusRegistered)
	pet.Version = 1
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	updated, err := svc.UpdatePet(ownerID.String(), pet.ID.String(), dto.UpdatePetRequest{Status: domain.PetStatusLost})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.Version != 2 {
		t.Errorf("expected Version=2 after status change, got %d", updated.Version)
	}
}

func TestUpdatePet_VersionNotIncrementedOnNameOnlyChange(t *testing.T) {
	ownerID := uuid.New()
	pet := petWithStatus(ownerID, domain.PetStatusRegistered)
	pet.Version = 3
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	updated, err := svc.UpdatePet(ownerID.String(), pet.ID.String(), dto.UpdatePetRequest{Name: "New Name"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.Version != 3 {
		t.Errorf("expected Version to remain 3 on name-only update, got %d", updated.Version)
	}
}

func TestUpdatePet_ConcurrentVersionMismatch_ReturnsConflict(t *testing.T) {
	ownerID := uuid.New()
	pet := petWithStatus(ownerID, domain.PetStatusRegistered)
	pet.Version = 5
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	// Client sends Version=3 but server is at Version=5 — conflict
	_, err := svc.UpdatePet(ownerID.String(), pet.ID.String(), dto.UpdatePetRequest{
		Status:  domain.PetStatusLost,
		Version: 3,
	})
	if err != domain.ErrConflict {
		t.Errorf("expected ErrConflict on version mismatch, got %v", err)
	}
}

func TestUpdatePet_ZeroVersionBypassesConcurrencyCheck(t *testing.T) {
	ownerID := uuid.New()
	pet := petWithStatus(ownerID, domain.PetStatusRegistered)
	pet.Version = 5
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	// Version=0 means "don't check" — should succeed regardless of server version
	_, err := svc.UpdatePet(ownerID.String(), pet.ID.String(), dto.UpdatePetRequest{
		Status:  domain.PetStatusLost,
		Version: 0,
	})
	if err != nil {
		t.Errorf("expected no error when Version=0, got %v", err)
	}
}

func TestMarkAsFound_StrayReporterCanMarkFound(t *testing.T) {
	reporterID := uuid.New()
	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: &reporterID,
		Status:     domain.PetStatusStray,
		Name:       "Stray",
		Version:    1,
	}
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	result, err := svc.MarkAsFound(reporterID.String(), pet.ID.String())
	if err != nil {
		t.Fatalf("reporter should be allowed to mark stray as found, got: %v", err)
	}
	if result.Status != domain.PetStatusFound {
		t.Errorf("expected status %q, got %q", domain.PetStatusFound, result.Status)
	}
}

func TestMarkAsFound_NonReporterCannotMarkStrayFound(t *testing.T) {
	reporterID := uuid.New()
	otherUser := uuid.New()
	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: &reporterID,
		Status:     domain.PetStatusStray,
		Name:       "Stray",
	}
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	_, err := svc.MarkAsFound(otherUser.String(), pet.ID.String())
	if err != domain.ErrForbidden {
		t.Errorf("expected ErrForbidden for non-reporter, got %v", err)
	}
}

// A stray that was already marked found (status no longer "stray", owner still
// nil) must remain manageable by its reporter — the idempotent retry should not
// be locked out. Regression guard for the canManagePet refactor of MarkAsFound.
func TestMarkAsFound_AlreadyFoundStray_ReporterIdempotent(t *testing.T) {
	reporterID := uuid.New()
	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: &reporterID,
		Status:     domain.PetStatusFound, // already found, no owner
		Name:       "Stray",
	}
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	result, err := svc.MarkAsFound(reporterID.String(), pet.ID.String())
	if err != nil {
		t.Fatalf("reporter should be allowed to retry on an already-found stray, got: %v", err)
	}
	if result.Status != domain.PetStatusFound {
		t.Errorf("expected status %q, got %q", domain.PetStatusFound, result.Status)
	}
	if len(repo.statusCalls) != 0 {
		t.Error("UpdateStatus should NOT be called when already found (idempotent)")
	}
}

func TestDeletePet_NilOwnerNosPanic(t *testing.T) {
	// Stray pet has nil OwnerID — delete should return ErrForbidden (not panic)
	anyUser := uuid.New()
	pet := &domain.Pet{
		ID:     uuid.New(),
		Status: domain.PetStatusStray,
		Name:   "Stray",
	}
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, nil, nil, nil, nil)

	err := svc.DeletePet(anyUser.String(), pet.ID.String())
	if err != domain.ErrForbidden {
		t.Errorf("expected ErrForbidden when deleting stray (nil owner), got %v", err)
	}
}

// ============================================================
// Mock: UnitOfWork
// ============================================================

// mockUnitOfWork is an in-memory UnitOfWork — it invokes fn with the given
// transaction-scoped repos (typically mocks) without any real database or
// rollback semantics. If fn returns an error, mockUnitOfWork additionally
// resets the pet repo's captured state to simulate a rollback, mirroring the
// "pet creation rolled back" guarantee that the real GORM-backed UnitOfWork
// provides via db.Transaction.
type mockUnitOfWork struct {
	repos repository.UnitOfWorkRepos
}

func (m *mockUnitOfWork) Execute(fn func(repos repository.UnitOfWorkRepos) error) error {
	err := fn(m.repos)
	if err != nil {
		// Simulate rollback: undo whatever the pet repo captured.
		if cap, ok := m.repos.Pets.(*capturingPetRepo); ok {
			cap.createdPet = nil
			cap.mockPetRepo.pet = nil
		}
	}
	return err
}

// ============================================================
// Tests: CreatePet — initial_report validation (stray)
// ============================================================

func TestCreatePet_Stray_RequiresInitialReport(t *testing.T) {
	repo := &mockPetRepo{}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{}, nil)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		// InitialReport intentionally omitted
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error for stray without initial_report, got nil")
	}
	if err.Error() != domain.ErrInitialReportRequired.Error() {
		t.Errorf("expected ErrInitialReportRequired, got %v", err)
	}
}

func TestCreatePet_Stray_WithInitialReport_CreatesPetAndReport(t *testing.T) {
	petRepo := &capturingPetRepo{}
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: petRepo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
			Note:      "Visto cerca de la plaza",
		},
	}

	pet, err := svc.CreatePet(ownerID.String(), req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if pet.Status != domain.PetStatusStray {
		t.Errorf("expected status %q, got %q", domain.PetStatusStray, pet.Status)
	}
	if reportRepo.createdCount != 1 {
		t.Fatalf("expected 1 report created, got %d", reportRepo.createdCount)
	}
	if reportRepo.lastReport.Status != "sighting" {
		t.Errorf("expected report status 'sighting', got %q", reportRepo.lastReport.Status)
	}
	if reportRepo.lastReport.LocationDescription != "Visto cerca de la plaza" {
		t.Errorf("expected location_description to carry the note, got %q", reportRepo.lastReport.LocationDescription)
	}
	if reportRepo.lastReport.PetID != pet.ID {
		t.Errorf("expected report.pet_id == pet.id")
	}
}

func TestCreatePet_Registered_RejectsInitialReport(t *testing.T) {
	repo := &mockPetRepo{}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{}, nil)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Rex",
		Type:   "perro",
		Status: domain.PetStatusRegistered,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
		},
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error for registered pet with initial_report, got nil")
	}
	if err.Error() != domain.ErrInitialReportNotAllowed.Error() {
		t.Errorf("expected ErrInitialReportNotAllowed, got %v", err)
	}
}

func TestCreatePet_Stray_ReportCreationFails_RollsBackPet(t *testing.T) {
	petRepo := &capturingPetRepo{}
	reportRepo := &mockReportRepo{createErr: domain.ErrInternal}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: petRepo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(petRepo, bus, nil, reportRepo, uow)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
		},
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err == nil {
		t.Fatal("expected error when report creation fails, got nil")
	}
	if petRepo.mockPetRepo.pet != nil {
		t.Error("expected pet creation to be rolled back when report creation fails")
	}
}

func TestCreatePet_Stray_NoUnitOfWork_ReturnsInternalError(t *testing.T) {
	repo := &capturingPetRepo{}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{}, nil)

	ownerID := uuid.New()
	req := dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:  -34.9011,
			Longitude: -56.1645,
		},
	}

	_, err := svc.CreatePet(ownerID.String(), req)
	if err != domain.ErrInternal {
		t.Errorf("expected ErrInternal when uow is nil, got %v", err)
	}
}

// ============================================================
// Tests: PublishLost
// ============================================================

func TestPublishLost_HappyPath_TransitionsAndCreatesReport(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusRegistered)}
	repo.pet.Version = 1
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645, Note: "Se escapó del jardín"}

	updated, err := svc.PublishLost(ownerID.String(), repo.pet.ID.String(), req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if updated.Status != domain.PetStatusLost {
		t.Errorf("expected status %q, got %q", domain.PetStatusLost, updated.Status)
	}
	if len(repo.statusCalls) != 1 || repo.statusCalls[0] != domain.PetStatusLost {
		t.Errorf("expected UpdateStatus called with %q, got %v", domain.PetStatusLost, repo.statusCalls)
	}
	if reportRepo.createdCount != 1 {
		t.Fatalf("expected 1 report created, got %d", reportRepo.createdCount)
	}
	if reportRepo.lastReport.Status != "lost" {
		t.Errorf("expected report status 'lost', got %q", reportRepo.lastReport.Status)
	}
	if reportRepo.lastReport.LocationDescription != "Se escapó del jardín" {
		t.Errorf("expected location_description to carry the note, got %q", reportRepo.lastReport.LocationDescription)
	}
	if reportRepo.lastReport.PetID != repo.pet.ID {
		t.Errorf("expected report.pet_id == pet.id")
	}
}

func TestPublishLost_NonOwner_Returns403(t *testing.T) {
	ownerID := uuid.New()
	otherUserID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusRegistered)}
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(otherUserID.String(), repo.pet.ID.String(), req)
	if err == nil {
		t.Fatal("expected error for non-owner, got nil")
	}
	if err.Error() != domain.ErrForbidden.Error() {
		t.Errorf("expected ErrForbidden, got %v", err)
	}
	if reportRepo.createdCount != 0 {
		t.Error("expected no report to be created for a forbidden publish-lost")
	}
	if len(repo.statusCalls) != 0 {
		t.Error("UpdateStatus should NOT have been called for non-owner")
	}
}

func TestPublishLost_InvalidTransition_Returns422(t *testing.T) {
	ownerID := uuid.New()
	// "found" -> "lost" is not in AllowedTransitions for PetStatusFound
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusFound)}
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(ownerID.String(), repo.pet.ID.String(), req)
	if err == nil {
		t.Fatal("expected error for invalid transition, got nil")
	}
	if err.Error() != domain.ErrInvalidStatusTransition.Error() {
		t.Errorf("expected ErrInvalidStatusTransition, got %v", err)
	}
	if reportRepo.createdCount != 0 {
		t.Error("expected no report to be created for an invalid transition")
	}
}

func TestPublishLost_ReportCreationFails_StatusUnchanged(t *testing.T) {
	ownerID := uuid.New()
	pet := petWithStatus(ownerID, domain.PetStatusRegistered)
	pet.Version = 1
	repo := &mockPetRepo{pet: pet}
	reportRepo := &mockReportRepo{createErr: domain.ErrInternal}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(ownerID.String(), pet.ID.String(), req)
	if err == nil {
		t.Fatal("expected error when report creation fails, got nil")
	}

	// The pet's in-memory status is only mutated by the service after a
	// successful uow.Execute — on error it must remain unchanged, mirroring
	// the rollback guarantee the real GORM-backed UnitOfWork provides.
	if pet.Status != domain.PetStatusRegistered {
		t.Errorf("expected status to remain %q after rollback, got %q", domain.PetStatusRegistered, pet.Status)
	}
}

func TestPublishLost_NoUnitOfWork_ReturnsInternalError(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusRegistered)}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, &mockReportRepo{}, nil)

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645}

	_, err := svc.PublishLost(ownerID.String(), repo.pet.ID.String(), req)
	if err != domain.ErrInternal {
		t.Errorf("expected ErrInternal when uow is nil, got %v", err)
	}
}

// ============================================================
// Follow-up: report.created payload assertion for CreatePet stray path
// ============================================================

func TestCreatePet_StrayPublishesReportCreatedEventWithCorrectPayload(t *testing.T) {
	reporterID := uuid.New()
	repo := &capturingPetRepo{}
	bus := event.NewEventBus()

	eventReceived := make(chan event.ReportCreatedEvent, 1)
	bus.Subscribe("report.created", func(payload interface{}) {
		if e, ok := payload.(event.ReportCreatedEvent); ok {
			eventReceived <- e
		}
	})

	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	_, err := svc.CreatePet(reporterID.String(), dto.CreatePetRequest{
		Name: "Stray Cat", Type: "gato", Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{Latitude: -34.9011, Longitude: -56.1645},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	select {
	case e := <-eventReceived:
		if e.Lat != -34.9011 {
			t.Errorf("event Lat mismatch: got %v, want %v", e.Lat, -34.9011)
		}
		if e.Lng != -56.1645 {
			t.Errorf("event Lng mismatch: got %v, want %v", e.Lng, -56.1645)
		}
		if e.PetID != repo.createdPet.ID {
			t.Errorf("event PetID mismatch: got %v, want %v", e.PetID, repo.createdPet.ID)
		}
		if e.ReporterID != reporterID {
			t.Errorf("event ReporterID mismatch: got %v, want %v", e.ReporterID, reporterID)
		}
		if e.Status != "sighting" {
			t.Errorf("event Status mismatch: got %q, want %q", e.Status, "sighting")
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout: report.created event was not published after creating a stray pet")
	}
}

// ============================================================
// Follow-up: event payload assertions for PublishLost
// ============================================================

func TestPublishLost_PublishesEventsWithCorrectPayload(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, domain.PetStatusRegistered)}
	reportRepo := &mockReportRepo{}
	uow := &mockUnitOfWork{repos: repository.UnitOfWorkRepos{Pets: repo, Reports: reportRepo}}
	bus := event.NewEventBus()
	svc := service.NewPetService(repo, bus, nil, reportRepo, uow)

	petLostReceived := make(chan event.PetLostEvent, 1)
	bus.Subscribe("pet.lost", func(payload interface{}) {
		if e, ok := payload.(event.PetLostEvent); ok {
			petLostReceived <- e
		}
	})

	reportCreatedReceived := make(chan event.ReportCreatedEvent, 1)
	bus.Subscribe("report.created", func(payload interface{}) {
		if e, ok := payload.(event.ReportCreatedEvent); ok {
			reportCreatedReceived <- e
		}
	})

	req := dto.PublishLostRequest{Latitude: -34.9011, Longitude: -56.1645, Note: "Se escapó del jardín"}

	updated, err := svc.PublishLost(ownerID.String(), repo.pet.ID.String(), req)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	select {
	case e := <-petLostReceived:
		if e.PetID != updated.ID {
			t.Errorf("pet.lost PetID mismatch: got %v, want %v", e.PetID, updated.ID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout: pet.lost event was not published after PublishLost")
	}

	select {
	case e := <-reportCreatedReceived:
		if e.PetID != updated.ID {
			t.Errorf("report.created PetID mismatch: got %v, want %v", e.PetID, updated.ID)
		}
		if e.ReportID == uuid.Nil {
			t.Error("report.created ReportID is zero, expected a generated UUID")
		}
		if e.ReporterID != ownerID {
			t.Errorf("report.created ReporterID mismatch: got %v, want %v", e.ReporterID, ownerID)
		}
		if e.PetOwnerID != ownerID {
			t.Errorf("report.created PetOwnerID mismatch: got %v, want %v", e.PetOwnerID, ownerID)
		}
		if e.Lat != req.Latitude {
			t.Errorf("report.created Lat mismatch: got %v, want %v", e.Lat, req.Latitude)
		}
		if e.Lng != req.Longitude {
			t.Errorf("report.created Lng mismatch: got %v, want %v", e.Lng, req.Longitude)
		}
		if e.Status != "lost" {
			t.Errorf("report.created Status mismatch: got %q, want %q", e.Status, "lost")
		}
	case <-time.After(500 * time.Millisecond):
		t.Error("timeout: report.created event was not published after PublishLost")
	}
}
