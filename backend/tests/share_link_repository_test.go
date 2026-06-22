package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestShareLinkRepository_CreateAndGetByToken(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	linkRepo := repository.NewShareLinkRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Share Pet", Type: "gato", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	token := uuid.New().String()[:16]
	link := &domain.ShareLink{
		ID:         uuid.New(),
		PetID:      pet.ID,
		ShareToken: token,
		Platform:   "whatsapp",
	}
	if err := linkRepo.Create(ctx, link); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := linkRepo.GetByToken(ctx, token)
	if err != nil {
		t.Fatalf("GetByToken: %v", err)
	}
	if got.ShareToken != token {
		t.Errorf("want token %q, got %q", token, got.ShareToken)
	}
	if got.PetID != pet.ID {
		t.Errorf("want petID %s, got %s", pet.ID, got.PetID)
	}
}

func TestShareLinkRepository_GetOrCreateForPet_Idempotent(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	linkRepo := repository.NewShareLinkRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Idem Pet", Type: "perro", Status: domain.PetStatusLost}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	build := func() (*domain.ShareLink, error) {
		return &domain.ShareLink{PetID: pet.ID, ShareToken: uuid.New().String()[:16]}, nil
	}

	first, err := linkRepo.GetOrCreateForPet(ctx, pet.ID, build)
	if err != nil {
		t.Fatalf("first GetOrCreateForPet: %v", err)
	}
	second, err := linkRepo.GetOrCreateForPet(ctx, pet.ID, build)
	if err != nil {
		t.Fatalf("second GetOrCreateForPet: %v", err)
	}

	// Repeat calls must return the same link and never create a second row.
	if first.ShareToken != second.ShareToken {
		t.Errorf("expected the same link on repeat calls, got %q then %q", first.ShareToken, second.ShareToken)
	}
	links, err := linkRepo.GetByPetID(ctx, pet.ID)
	if err != nil {
		t.Fatalf("GetByPetID: %v", err)
	}
	if len(links) != 1 {
		t.Errorf("expected exactly 1 share link row for the pet, got %d", len(links))
	}
}

func TestShareLinkRepository_GetByToken_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	linkRepo := repository.NewShareLinkRepository(gormDB)
	ctx := context.Background()

	_, err := linkRepo.GetByToken(ctx, "nonexistent-token")
	if !errors.Is(err, domain.ErrShareLinkNotFound) {
		t.Errorf("want ErrShareLinkNotFound, got %v", err)
	}
}

func TestShareLinkRepository_IncrementViews(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	linkRepo := repository.NewShareLinkRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Views Pet", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	token := "view-token-" + uuid.New().String()[:8]
	link := &domain.ShareLink{ID: uuid.New(), PetID: pet.ID, ShareToken: token}
	if err := linkRepo.Create(ctx, link); err != nil {
		t.Fatalf("Create: %v", err)
	}

	for i := 0; i < 3; i++ {
		if err := linkRepo.IncrementViewCount(ctx, link.ID); err != nil {
			t.Fatalf("IncrementViewCount (call %d): %v", i+1, err)
		}
	}

	got, err := linkRepo.GetByToken(ctx, token)
	if err != nil {
		t.Fatalf("GetByToken: %v", err)
	}
	if got.ViewCount != 3 {
		t.Errorf("want ViewCount=3, got %d", got.ViewCount)
	}
}

func TestShareLinkRepository_TrackContact(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	linkRepo := repository.NewShareLinkRepository(gormDB)
	ctx := context.Background()

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Contact Pet", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	token := "contact-token-" + uuid.New().String()[:8]
	link := &domain.ShareLink{ID: uuid.New(), PetID: pet.ID, ShareToken: token}
	if err := linkRepo.Create(ctx, link); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := linkRepo.IncrementClickedContact(ctx, link.ID); err != nil {
		t.Fatalf("IncrementClickedContact: %v", err)
	}
	if err := linkRepo.IncrementClickedContact(ctx, link.ID); err != nil {
		t.Fatalf("IncrementClickedContact (2nd): %v", err)
	}

	got, err := linkRepo.GetByToken(ctx, token)
	if err != nil {
		t.Fatalf("GetByToken: %v", err)
	}
	if got.ClickedContact != 2 {
		t.Errorf("want ClickedContact=2, got %d", got.ClickedContact)
	}
}
