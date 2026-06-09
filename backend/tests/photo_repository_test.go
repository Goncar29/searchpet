package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestPhotoRepository_CreateAndGetByPetID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Photo Pet", Type: "gato", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	photo := &domain.Photo{
		ID:         uuid.New(),
		PetID:      pet.ID,
		URL:        "https://res.cloudinary.com/demo/image/upload/sample.jpg",
		PublicID:   "sample",
		UploadedBy: owner.ID,
		IsPrimary:  true,
	}
	if err := photoRepo.Create(photo); err != nil {
		t.Fatalf("Create photo: %v", err)
	}

	photos, err := photoRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID: %v", err)
	}
	if len(photos) != 1 {
		t.Fatalf("want 1 photo, got %d", len(photos))
	}
	if photos[0].URL != photo.URL {
		t.Errorf("want URL %q, got %q", photo.URL, photos[0].URL)
	}
}

func TestPhotoRepository_Delete(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Del Photo Pet", Type: "gato", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	photo := &domain.Photo{
		ID:         uuid.New(),
		PetID:      pet.ID,
		URL:        "https://example.com/del.jpg",
		UploadedBy: owner.ID,
		IsPrimary:  false,
	}
	if err := photoRepo.Create(photo); err != nil {
		t.Fatalf("Create photo: %v", err)
	}

	// DeleteByPetID removes all photos for a pet
	if err := photoRepo.DeleteByPetID(pet.ID.String()); err != nil {
		t.Fatalf("DeleteByPetID: %v", err)
	}

	photos, err := photoRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID after delete: %v", err)
	}
	if len(photos) != 0 {
		t.Errorf("want 0 photos after delete, got %d", len(photos))
	}
}

func TestPhotoRepository_SetPrimary(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Primary Pet", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Create two photos; first is primary
	p1 := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://example.com/p1.jpg", UploadedBy: owner.ID, IsPrimary: true}
	p2 := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://example.com/p2.jpg", UploadedBy: owner.ID, IsPrimary: false}
	for _, p := range []*domain.Photo{p1, p2} {
		if err := photoRepo.Create(p); err != nil {
			t.Fatalf("Create photo: %v", err)
		}
	}

	hasPrimary, err := photoRepo.HasPrimaryPhoto(pet.ID.String())
	if err != nil {
		t.Fatalf("HasPrimaryPhoto: %v", err)
	}
	if !hasPrimary {
		t.Error("want HasPrimaryPhoto=true after creating primary photo")
	}

	// Unset primaries, then verify no primary
	if err := photoRepo.UnsetPrimaryPhotos(pet.ID.String()); err != nil {
		t.Fatalf("UnsetPrimaryPhotos: %v", err)
	}

	hasPrimary2, err := photoRepo.HasPrimaryPhoto(pet.ID.String())
	if err != nil {
		t.Fatalf("HasPrimaryPhoto after unset: %v", err)
	}
	if hasPrimary2 {
		t.Error("want HasPrimaryPhoto=false after UnsetPrimaryPhotos")
	}
}

func TestPhotoRepository_CountByPetID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: ptrUUID(owner.ID), Name: "Count Pet", Type: "perro", Status: domain.PetStatusRegistered}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	for i := 0; i < 3; i++ {
		p := &domain.Photo{ID: uuid.New(), PetID: pet.ID, URL: "https://example.com/x.jpg", UploadedBy: owner.ID}
		if err := photoRepo.Create(p); err != nil {
			t.Fatalf("Create photo %d: %v", i, err)
		}
	}

	count, err := photoRepo.CountByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("CountByPetID: %v", err)
	}
	if count != 3 {
		t.Errorf("want count=3, got %d", count)
	}
}
