package tests

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// newTestUser creates and persists a minimal User for FK requirements.
func newTestUser(t *testing.T, db interface{ Create(context.Context, *domain.User) error }) *domain.User {
	t.Helper()
	u := &domain.User{
		ID:           uuid.New(),
		Email:        fmt.Sprintf("owner-%s@test.com", uuid.New().String()[:8]),
		PasswordHash: "hashed",
		Name:         "Test Owner",
	}
	if err := db.Create(context.Background(), u); err != nil {
		t.Fatalf("newTestUser: %v", err)
	}
	return u
}

func TestPetRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		ID:      uuid.New(),
		OwnerID: owner.ID,
		Name:    "Firulais",
		Type:    "perro",
		Status:  "active",
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.Name != pet.Name {
		t.Errorf("want name %q, got %q", pet.Name, got.Name)
	}
	if got.Type != pet.Type {
		t.Errorf("want type %q, got %q", pet.Type, got.Type)
	}
}

func TestPetRepository_FindByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	petRepo := repository.NewPetRepository(gormDB)

	_, err := petRepo.FindByID(uuid.New().String())
	if !errors.Is(err, domain.ErrPetNotFound) {
		t.Errorf("want ErrPetNotFound, got %v", err)
	}
}

func TestPetRepository_Search_ByType(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	// Insert two pets of different types
	dog := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Rex", Type: "perro", Status: "active"}
	cat := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Michi", Type: "gato", Status: "active"}
	for _, p := range []*domain.Pet{dog, cat} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}

	results, total, err := petRepo.Search(domain.PetSearchCriteria{Type: "perro", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if total < 1 {
		t.Errorf("want at least 1 result for type=perro, got %d", total)
	}
	for _, p := range results {
		if p.Type != "perro" {
			t.Errorf("unexpected type %q in perro search", p.Type)
		}
	}
}

func TestPetRepository_Search_ByStatus(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)

	active := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Active", Type: "perro", Status: "active"}
	found := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Found", Type: "perro", Status: "found"}
	for _, p := range []*domain.Pet{active, found} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create %s: %v", p.Name, err)
		}
	}

	results, _, err := petRepo.Search(domain.PetSearchCriteria{Status: "found", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("Search by status: %v", err)
	}
	for _, p := range results {
		if p.Status != "found" {
			t.Errorf("unexpected status %q in found search", p.Status)
		}
	}
}

func TestPetRepository_FindByOwnerID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)

	myPet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Mine", Type: "gato", Status: "active"}
	theirPet := &domain.Pet{ID: uuid.New(), OwnerID: other.ID, Name: "Theirs", Type: "gato", Status: "active"}
	for _, p := range []*domain.Pet{myPet, theirPet} {
		if err := petRepo.Create(p); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	pets, err := petRepo.FindByOwnerID(owner.ID.String())
	if err != nil {
		t.Fatalf("FindByOwnerID: %v", err)
	}
	if len(pets) < 1 {
		t.Fatal("expected at least 1 pet for owner")
	}
	for _, p := range pets {
		if p.OwnerID != owner.ID {
			t.Errorf("unexpected owner_id %s in results", p.OwnerID)
		}
	}
}

func TestPetRepository_UpdateStatus(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Status Pet", Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := petRepo.UpdateStatus(pet.ID.String(), "found"); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.Status != "found" {
		t.Errorf("want status 'found', got %q", got.Status)
	}
}

func TestPetRepository_Delete_Cascade(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)
	photoRepo := repository.NewPhotoRepository(gormDB)

	owner := newTestUser(t, userRepo)
	pet := &domain.Pet{ID: uuid.New(), OwnerID: owner.ID, Name: "Delete Me", Type: "perro", Status: "active"}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create pet: %v", err)
	}

	// Attach a photo so we can verify cascade
	photo := &domain.Photo{
		ID:         uuid.New(),
		PetID:      pet.ID,
		URL:        "https://example.com/photo.jpg",
		UploadedBy: owner.ID,
		IsPrimary:  true,
	}
	if err := photoRepo.Create(photo); err != nil {
		t.Fatalf("Create photo: %v", err)
	}

	if err := petRepo.Delete(pet.ID.String()); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Pet must be gone
	_, err := petRepo.FindByID(pet.ID.String())
	if !errors.Is(err, domain.ErrPetNotFound) {
		t.Errorf("want ErrPetNotFound after delete, got %v", err)
	}

	// Photos must be gone too
	photos, err := photoRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByPetID after delete: %v", err)
	}
	if len(photos) != 0 {
		t.Errorf("want 0 photos after cascade delete, got %d", len(photos))
	}
}
