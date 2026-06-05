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
		OwnerID: ownerID,
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
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "active")}
	bus := event.NewEventBus()

	svc := service.NewPetService(repo, bus, nil, nil)
	pet, err := svc.MarkAsFound(ownerID.String(), repo.pet.ID.String())

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if pet.Status != "found" {
		t.Errorf("expected status 'found', got %q", pet.Status)
	}
	if len(repo.statusCalls) != 1 || repo.statusCalls[0] != "found" {
		t.Errorf("expected UpdateStatus called with 'found', got %v", repo.statusCalls)
	}
}

func TestMarkAsFound_NonOwner_Returns403(t *testing.T) {
	ownerID := uuid.New()
	anotherUser := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "active")}
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

func TestMarkAsFound_ArchivedPet_Returns409(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "archived")}
	bus := event.NewEventBus()

	svc := service.NewPetService(repo, bus, nil, nil)
	_, err := svc.MarkAsFound(ownerID.String(), repo.pet.ID.String())

	if err == nil {
		t.Fatal("expected error for archived pet, got nil")
	}
	if err != domain.ErrPetArchived {
		t.Errorf("expected ErrPetArchived, got %v", err)
	}
}

func TestMarkAsFound_PublishesEvent(t *testing.T) {
	ownerID := uuid.New()
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "active")}
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
	// Note: UpdatePet will hit ErrPetStatusLocked (found/archived guard) if we try
	// to change status on a "lost" pet to "found" via UpdatePet.
	// Instead test a transition that is NOT "→ lost": "active" → "active" (name-only update).
	repo := &mockPetRepo{pet: petWithStatus(ownerID, "active")}
	bus := event.NewEventBus()

	eventPublished := make(chan struct{}, 1)
	bus.Subscribe("pet.lost", func(_ interface{}) {
		eventPublished <- struct{}{}
	})

	svc := service.NewPetService(repo, bus, nil, nil)
	petID := repo.pet.ID

	// Update name only — status stays "active", no pet.lost event.
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
