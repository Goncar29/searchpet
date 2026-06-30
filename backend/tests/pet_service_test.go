package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// TestUpdatePet_TransitionToFound_PublishesPetFound verifies that marking a pet
// as "found" via UpdatePet (the path used by the PetCard status dropdown)
// publishes the pet.found event — so gamification and embedding cleanup run.
// Regression: previously only MarkAsFound published it, so the dropdown path
// silently skipped the event (most visibly for strays, now manageable by reporters).
func TestUpdatePet_TransitionToFound_PublishesPetFound(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()

	stray := &domain.Pet{
		ID:         petID,
		Name:       "Callejero",
		Status:     domain.PetStatusStray,
		ReporterID: &reporterID, // stray: no owner, managed by reporter
	}

	repo := &mockPetRepoForService{
		findByIDFn: func(id string) (*domain.Pet, error) { return stray, nil },
	}

	bus := event.NewEventBus()
	received := make(chan event.PetFoundEvent, 1)
	bus.Subscribe("pet.found", func(payload interface{}) {
		if e, ok := payload.(event.PetFoundEvent); ok {
			received <- e
		}
	})

	svc := service.NewPetService(repo, bus, nil, nil, nil, nil)

	_, err := svc.UpdatePet(reporterID.String(), petID.String(), dto.UpdatePetRequest{
		Status: domain.PetStatusFound,
	})
	if err != nil {
		t.Fatalf("UpdatePet returned error: %v", err)
	}

	select {
	case e := <-received:
		if e.PetID != petID {
			t.Errorf("PetFoundEvent.PetID = %v, want %v", e.PetID, petID)
		}
		if e.PetName != "Callejero" {
			t.Errorf("PetFoundEvent.PetName = %q, want %q", e.PetName, "Callejero")
		}
	case <-time.After(time.Second):
		t.Fatal("expected pet.found event, none received within 1s")
	}
}
