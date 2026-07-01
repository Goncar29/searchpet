package tests

import (
	"context"
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// TestPublishLostThenFound_RecordsLifetimeEvents_SurvivesDelete verifies that
// the lifetime impact ledger is written at each transition AND that hard-deleting
// the pet leaves those rows intact (the whole point of the no-FK ledger).
func TestPublishLostThenFound_RecordsLifetimeEvents_SurvivesDelete(t *testing.T) {
	db := testdb.SetupTestDB(t)
	ctx := context.Background()

	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	statRepo := repository.NewStatEventRepository(db)
	uow := repository.NewUnitOfWork(db)
	svc := service.NewPetService(petRepo, nil, nil, reportRepo, uow, statRepo, nil, nil)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{
		OwnerID: ptrUUID(owner.ID),
		Name:    "Repro",
		Type:    "perro",
		Status:  domain.PetStatusRegistered,
		Version: 1,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	if _, err := svc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{
		Latitude:  -34.9,
		Longitude: -56.1,
		Note:      "x",
	}); err != nil {
		t.Fatalf("publish lost: %v", err)
	}
	if _, err := svc.MarkAsFound(owner.ID.String(), pet.ID.String()); err != nil {
		t.Fatalf("mark found: %v", err)
	}

	searches, _ := statRepo.CountByType(ctx, domain.StatEventSearchStarted)
	reunited, _ := statRepo.CountDistinctPets(ctx, domain.StatEventPetFound)
	if searches != 1 || reunited != 1 {
		t.Fatalf("after publish+found: searches=%d reunited=%d, want 1/1", searches, reunited)
	}

	// Hard-delete the pet — lifetime counters must NOT change.
	if err := petRepo.Delete(pet.ID.String()); err != nil {
		t.Fatalf("delete pet: %v", err)
	}
	searches2, _ := statRepo.CountByType(ctx, domain.StatEventSearchStarted)
	reunited2, _ := statRepo.CountDistinctPets(ctx, domain.StatEventPetFound)
	if searches2 != 1 || reunited2 != 1 {
		t.Errorf("after delete: searches=%d reunited=%d, want unchanged 1/1", searches2, reunited2)
	}
}
