package service_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ============================================================
// Tests: CreatePet — adoption status (Task B3)
// ============================================================

func TestCreatePetAdoption(t *testing.T) {
	ownerID := uuid.New()
	repo := &capturingPetRepo{}
	svc := service.NewPetService(repo, nil, nil, nil, nil, nil, nil, nil)

	req := dto.CreatePetRequest{Name: "Michi", Type: "gato", Status: domain.PetStatusAdoption, City: "Salto"}
	pet, err := svc.CreatePet(ownerID.String(), req)
	if err != nil {
		t.Fatalf("adoption create failed: %v", err)
	}
	if pet.Status != domain.PetStatusAdoption {
		t.Errorf("status = %q, want adoption", pet.Status)
	}
	if pet.City != "Salto" {
		t.Errorf("city = %q, want Salto", pet.City)
	}
	if pet.OwnerID == nil {
		t.Error("adoption pet must have an owner")
	}
}

func TestCreatePetAdoptionRejectsInitialReport(t *testing.T) {
	ownerID := uuid.New()
	repo := &capturingPetRepo{}
	svc := service.NewPetService(repo, nil, nil, nil, nil, nil, nil, nil)

	req := dto.CreatePetRequest{Name: "Michi", Type: "gato", Status: domain.PetStatusAdoption,
		InitialReport: &dto.InitialReportRequest{Latitude: -34.9, Longitude: -56.1}}
	_, err := svc.CreatePet(ownerID.String(), req)
	if !errors.Is(err, domain.ErrInitialReportNotAllowed) {
		t.Errorf("want ErrInitialReportNotAllowed, got %v", err)
	}
}
