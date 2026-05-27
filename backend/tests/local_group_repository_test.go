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

func TestLocalGroupRepository_CreateAndGetByID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)

	// Use unique city to avoid constraint conflicts between test runs
	city := fmt.Sprintf("TestCity-%s", uuid.New().String()[:8])
	group := &domain.LocalGroup{
		ID:          uuid.New(),
		Name:        "Grupo Prueba",
		City:        city,
		Description: "Test group",
		CreatedBy:   creator.ID,
		MemberCount: 1,
	}
	if err := groupRepo.Create(ctx, group); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := groupRepo.GetByID(ctx, group.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.City != city {
		t.Errorf("want city %q, got %q", city, got.City)
	}
	if got.Name != "Grupo Prueba" {
		t.Errorf("want name 'Grupo Prueba', got %q", got.Name)
	}
}

func TestLocalGroupRepository_GetByID_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	ctx := context.Background()

	_, err := groupRepo.GetByID(ctx, uuid.New())
	if !errors.Is(err, domain.ErrGroupNotFound) {
		t.Errorf("want ErrGroupNotFound, got %v", err)
	}
}

func TestLocalGroupRepository_List(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)

	suffix := uuid.New().String()[:8]
	for i := 0; i < 3; i++ {
		g := &domain.LocalGroup{
			ID:        uuid.New(),
			Name:      fmt.Sprintf("Group %d", i),
			City:      fmt.Sprintf("UniqueCity-%s-%d", suffix, i),
			CreatedBy: creator.ID,
		}
		if err := groupRepo.Create(ctx, g); err != nil {
			t.Fatalf("Create group %d: %v", i, err)
		}
	}

	groups, err := groupRepo.GetAll(ctx, "", 20, 0)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if len(groups) < 3 {
		t.Errorf("want at least 3 groups, got %d", len(groups))
	}
}

func TestLocalGroupRepository_DuplicateCity_ReturnsErrCityGroupExists(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	groupRepo := repository.NewLocalGroupRepository(gormDB)
	ctx := context.Background()

	creator := newTestUser(t, userRepo)
	city := fmt.Sprintf("UniqueCity-%s", uuid.New().String()[:8])

	g1 := &domain.LocalGroup{ID: uuid.New(), Name: "First", City: city, CreatedBy: creator.ID}
	if err := groupRepo.Create(ctx, g1); err != nil {
		t.Fatalf("Create first: %v", err)
	}

	g2 := &domain.LocalGroup{ID: uuid.New(), Name: "Second", City: city, CreatedBy: creator.ID}
	err := groupRepo.Create(ctx, g2)
	if !errors.Is(err, domain.ErrCityGroupExists) {
		t.Errorf("want ErrCityGroupExists for duplicate city, got %v", err)
	}
}
