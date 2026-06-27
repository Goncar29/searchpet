// Package service_test — verifies that stray pets (no owner) can be managed by
// the user who reported them (ReporterID), mirroring the owner-only rule for
// owned pets. Regression guard for the class of bug where every owner-only
// authorization check locked strays out entirely.
package service_test

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// strayPet builds a stray pet (OwnerID nil, ReporterID set) for authz tests.
func strayPet(reporterID uuid.UUID, status string) *domain.Pet {
	return &domain.Pet{
		ID:         uuid.New(),
		OwnerID:    nil,
		ReporterID: &reporterID,
		Name:       "Callejero",
		Type:       "perro",
		Status:     status,
	}
}

func TestUpdatePet_StrayReporter_Allowed(t *testing.T) {
	reporterID := uuid.New()
	pet := strayPet(reporterID, domain.PetStatusStray)
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, event.NewEventBus(), nil, nil, nil)

	marron := "marrón"
	updated, err := svc.UpdatePet(reporterID.String(), pet.ID.String(), dto.UpdatePetRequest{Color: &marron})
	if err != nil {
		t.Fatalf("stray reporter should be allowed to update, got %v", err)
	}
	if updated.Color != "marrón" {
		t.Errorf("expected color updated to marrón, got %q", updated.Color)
	}
}

func TestUpdatePet_StrayNonReporter_Forbidden(t *testing.T) {
	reporterID := uuid.New()
	stranger := uuid.New()
	pet := strayPet(reporterID, domain.PetStatusStray)
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, event.NewEventBus(), nil, nil, nil)

	marron := "marrón"
	if _, err := svc.UpdatePet(stranger.String(), pet.ID.String(), dto.UpdatePetRequest{Color: &marron}); err != domain.ErrForbidden {
		t.Errorf("expected ErrForbidden for non-reporter, got %v", err)
	}
}

func TestDeletePet_StrayReporter_Allowed(t *testing.T) {
	reporterID := uuid.New()
	pet := strayPet(reporterID, domain.PetStatusStray)
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, event.NewEventBus(), nil, nil, nil)

	if err := svc.DeletePet(reporterID.String(), pet.ID.String()); err != nil {
		t.Fatalf("stray reporter should be allowed to delete, got %v", err)
	}
}

func TestDeletePet_StrayNonReporter_Forbidden(t *testing.T) {
	reporterID := uuid.New()
	stranger := uuid.New()
	pet := strayPet(reporterID, domain.PetStatusStray)
	repo := &mockPetRepo{pet: pet}
	svc := service.NewPetService(repo, event.NewEventBus(), nil, nil, nil)

	if err := svc.DeletePet(stranger.String(), pet.ID.String()); err != domain.ErrForbidden {
		t.Errorf("expected ErrForbidden for non-reporter, got %v", err)
	}
}
