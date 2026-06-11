package service_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
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
func (m *mockPetRepo) FindByOwnerID(_ string) ([]domain.Pet, error) { return nil, nil }
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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

	svc := service.NewPetService(repo, bus, nil, nil)
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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

	_, err := svc.CreatePet(reporterID.String(), dto.CreatePetRequest{Name: "Stray Cat", Type: "gato", Status: domain.PetStatusStray})
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

	svc := service.NewPetService(repo, bus, nil, nil)

	_, err := svc.CreatePet(reporterID.String(), dto.CreatePetRequest{Name: "Stray Cat", Type: "gato", Status: domain.PetStatusStray})
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

	svc := service.NewPetService(repo, bus, nil, nil)

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
	svc := service.NewPetService(&capturingPetRepo{}, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

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
	svc := service.NewPetService(repo, nil, nil, nil)

	_, err := svc.MarkAsFound(otherUser.String(), pet.ID.String())
	if err != domain.ErrForbidden {
		t.Errorf("expected ErrForbidden for non-reporter, got %v", err)
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
	svc := service.NewPetService(repo, nil, nil, nil)

	err := svc.DeletePet(anyUser.String(), pet.ID.String())
	if err != domain.ErrForbidden {
		t.Errorf("expected ErrForbidden when deleting stray (nil owner), got %v", err)
	}
}
