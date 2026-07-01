package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestEpisodeRepository_OpenSetsCurrentAndCloseResolves(t *testing.T) {
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	epRepo := repository.NewEpisodeRepository(db)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Fido",
		Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("create pet: %v", err)
	}

	ep, err := epRepo.Open(pet.ID.String())
	if err != nil {
		t.Fatalf("open episode: %v", err)
	}
	if ep.EndedAt != nil {
		t.Errorf("newly opened episode should have nil EndedAt")
	}

	reloaded, _ := petRepo.FindByID(pet.ID.String())
	if reloaded.CurrentEpisodeID == nil || *reloaded.CurrentEpisodeID != ep.ID {
		t.Fatalf("pet.CurrentEpisodeID = %v, want %v", reloaded.CurrentEpisodeID, ep.ID)
	}

	cur, err := epRepo.FindCurrent(pet.ID.String())
	if err != nil {
		t.Fatalf("find current: %v", err)
	}
	if cur == nil || cur.ID != ep.ID {
		t.Fatalf("FindCurrent = %v, want %v", cur, ep.ID)
	}

	if err := epRepo.CloseCurrent(pet.ID.String(), domain.PetStatusFound); err != nil {
		t.Fatalf("close: %v", err)
	}
	cur, _ = epRepo.FindCurrent(pet.ID.String())
	if cur.EndedAt == nil {
		t.Errorf("closed episode should have EndedAt set")
	}
	if cur.Resolution == nil || *cur.Resolution != domain.PetStatusFound {
		t.Errorf("resolution = %v, want %q", cur.Resolution, domain.PetStatusFound)
	}
}
