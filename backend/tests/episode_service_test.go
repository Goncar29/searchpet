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
	svc := service.NewEpisodeService()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Fido",
		Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("create pet: %v", err)
	}

	// registered -> lost : opens
	if err := svc.HandleTransition(epRepo, pet.ID.String(), domain.PetStatusRegistered, domain.PetStatusLost); err != nil {
		t.Fatalf("open transition: %v", err)
	}
	cur, err := epRepo.FindCurrent(pet.ID.String())
	if err != nil {
		t.Fatalf("find current: %v", err)
	}
	if cur == nil || cur.EndedAt != nil {
		t.Fatalf("expected one open episode, got %#v", cur)
	}
	firstEpisode := cur.ID

	// lost -> stray : active -> active, no-op (same open episode, not split)
	if err := svc.HandleTransition(epRepo, pet.ID.String(), domain.PetStatusLost, domain.PetStatusStray); err != nil {
		t.Fatalf("active->active transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID != firstEpisode || cur.EndedAt != nil {
		t.Fatalf("lost->stray must keep the same OPEN episode, got %#v", cur)
	}

	// stray -> found : closes with resolution=found
	if err := svc.HandleTransition(epRepo, pet.ID.String(), domain.PetStatusStray, domain.PetStatusFound); err != nil {
		t.Fatalf("close transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.EndedAt == nil || cur.Resolution == nil || *cur.Resolution != domain.PetStatusFound {
		t.Fatalf("expected closed found episode, got %#v", cur)
	}

	// found -> archived : no-op (no new episode, episode stays closed)
	if err := svc.HandleTransition(epRepo, pet.ID.String(), domain.PetStatusFound, domain.PetStatusArchived); err != nil {
		t.Fatalf("noop transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID != firstEpisode || cur.EndedAt == nil {
		t.Fatalf("found->archived must keep the same CLOSED episode, got %#v", cur)
	}

	// archived -> lost (re-lost) : opens a SECOND episode
	if err := svc.HandleTransition(epRepo, pet.ID.String(), domain.PetStatusArchived, domain.PetStatusLost); err != nil {
		t.Fatalf("re-lost transition: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.ID == firstEpisode || cur.EndedAt != nil {
		t.Fatalf("re-lost must open a new open episode, got %#v", cur)
	}
}
