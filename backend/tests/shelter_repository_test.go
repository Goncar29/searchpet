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

func TestShelterRepository_GetAll(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	shelters := []*domain.Shelter{
		{ID: uuid.New(), Name: "Refugio A", City: "Montevideo", IsVerified: true},
		{ID: uuid.New(), Name: "Refugio B", City: "Montevideo", IsVerified: false},
		{ID: uuid.New(), Name: "Refugio C", City: "Buenos Aires", IsVerified: true},
	}
	for _, s := range shelters {
		if err := shelterRepo.Create(ctx, s); err != nil {
			t.Fatalf("Create shelter %q: %v", s.Name, err)
		}
	}

	// No filters — all 3
	all, err := shelterRepo.GetAll(ctx, "", nil)
	if err != nil {
		t.Fatalf("GetAll (no filter): %v", err)
	}
	if len(all) < 3 {
		t.Errorf("want at least 3 shelters, got %d", len(all))
	}

	// Filter by city
	byCityMVD, err := shelterRepo.GetAll(ctx, "Montevideo", nil)
	if err != nil {
		t.Fatalf("GetAll (Montevideo): %v", err)
	}
	if len(byCityMVD) < 2 {
		t.Errorf("want at least 2 Montevideo shelters, got %d", len(byCityMVD))
	}
	for _, s := range byCityMVD {
		if s.City != "Montevideo" {
			t.Errorf("unexpected city %q in Montevideo filter", s.City)
		}
	}

	// Filter by verified
	verified := true
	byVerified, err := shelterRepo.GetAll(ctx, "", &verified)
	if err != nil {
		t.Fatalf("GetAll (verified): %v", err)
	}
	for _, s := range byVerified {
		if !s.IsVerified {
			t.Errorf("unverified shelter %q appeared in verified filter", s.Name)
		}
	}
}

func TestShelterRepository_GetByID_Found(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	shelter := &domain.Shelter{
		ID:   uuid.New(),
		Name: "Refugio Test",
		City: "Montevideo",
	}
	if err := shelterRepo.Create(ctx, shelter); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := shelterRepo.GetByID(ctx, shelter.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != shelter.Name {
		t.Errorf("want name %q, got %q", shelter.Name, got.Name)
	}
}

func TestShelterRepository_GetByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	shelterRepo := repository.NewShelterRepository(gormDB)
	ctx := context.Background()

	_, err := shelterRepo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrShelterNotFound) {
		t.Errorf("want ErrShelterNotFound, got %v", err)
	}
}
