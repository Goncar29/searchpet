package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// Photos must come back ordered by created_at ASC (first uploaded first) from the
// pet preloads, so every surface (feed, detail, my pets, share, PDF) shows the
// same first photo regardless of Postgres heap order. Backlog #17.
func TestPetRepository_FindByID_PhotosOrderedByCreatedAtAsc(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Order Pet", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	base := time.Now().Add(-time.Hour).UTC()
	first := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/first.jpg", UploadedBy: owner.ID, CreatedAt: base}
	second := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/second.jpg", UploadedBy: owner.ID, CreatedAt: base.Add(time.Minute)}
	third := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://cdn/third.jpg", UploadedBy: owner.ID, CreatedAt: base.Add(2 * time.Minute)}

	// Insert out of chronological order to prove ordering is by created_at, not insertion.
	for _, p := range []*domain.Photo{third, first, second} {
		if err := photoRepo.Create(p); err != nil {
			t.Fatalf("Create photo: %v", err)
		}
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	want := []string{"https://cdn/first.jpg", "https://cdn/second.jpg", "https://cdn/third.jpg"}
	if len(got.Photos) != len(want) {
		t.Fatalf("want %d photos, got %d", len(want), len(got.Photos))
	}
	for i, w := range want {
		if got.Photos[i].URL != w {
			t.Errorf("photo[%d].URL = %q, want %q", i, got.Photos[i].URL, w)
		}
	}
}
