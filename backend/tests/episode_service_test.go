package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

func TestEpisodeService_HandleTransition_OpensAndCloses(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	epRepo := repository.NewEpisodeRepository(db)
	svc := service.NewEpisodeService(epRepo)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Fido",
		Type: "perro", Status: domain.PetStatusRegistered}
	petRepo.Create(pet)

	// registered -> lost : opens
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusRegistered, domain.PetStatusLost); err != nil {
		t.Fatalf("open transition: %v", err)
	}
	cur, _ := epRepo.FindCurrent(pet.ID.String())
	if cur == nil || cur.EndedAt != nil {
		t.Fatalf("expected one open episode, got %#v", cur)
	}
	firstEpisode := cur.ID

	// lost -> found : closes with resolution=found
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusLost, domain.PetStatusFound); err != nil {
		t.Fatalf("close transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.EndedAt == nil || cur.Resolution == nil || *cur.Resolution != domain.PetStatusFound {
		t.Fatalf("expected closed found episode, got %#v", cur)
	}

	// found -> archived : no-op (no new episode, still same closed one)
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusFound, domain.PetStatusArchived); err != nil {
		t.Fatalf("noop transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID != firstEpisode {
		t.Fatalf("found->archived must not create a new episode")
	}

	// archived -> lost (re-lost) : opens a SECOND episode
	if err := svc.HandleTransition(pet.ID.String(), domain.PetStatusArchived, domain.PetStatusLost); err != nil {
		t.Fatalf("re-lost transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID == firstEpisode || cur.EndedAt != nil {
		t.Fatalf("re-lost must open a new open episode, got %#v", cur)
	}
}
