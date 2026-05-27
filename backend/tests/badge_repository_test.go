package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestBadgeRepository_CreateAndGetByUserID(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	badgeRepo := repository.NewBadgeRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	badge := &domain.Badge{
		ID:        uuid.New(),
		UserID:    user.ID,
		BadgeType: "first_helper",
	}
	if err := badgeRepo.Create(ctx, badge); err != nil {
		t.Fatalf("Create: %v", err)
	}

	badges, err := badgeRepo.FindByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(badges) != 1 {
		t.Fatalf("want 1 badge, got %d", len(badges))
	}
	if badges[0].BadgeType != "first_helper" {
		t.Errorf("want badgeType 'first_helper', got %q", badges[0].BadgeType)
	}
}

func TestBadgeRepository_HasBadge(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	badgeRepo := repository.NewBadgeRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	has, err := badgeRepo.HasBadge(ctx, user.ID, "pet_rescuer")
	if err != nil {
		t.Fatalf("HasBadge before create: %v", err)
	}
	if has {
		t.Error("want HasBadge=false before creating badge")
	}

	if err := badgeRepo.Create(ctx, &domain.Badge{ID: uuid.New(), UserID: user.ID, BadgeType: "pet_rescuer"}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	has, err = badgeRepo.HasBadge(ctx, user.ID, "pet_rescuer")
	if err != nil {
		t.Fatalf("HasBadge after create: %v", err)
	}
	if !has {
		t.Error("want HasBadge=true after creating badge")
	}
}

func TestBadgeRepository_DuplicateBadge_IsIdempotent(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	badgeRepo := repository.NewBadgeRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	badgeType := "social_butterfly"

	// Create first badge
	if err := badgeRepo.Create(ctx, &domain.Badge{ID: uuid.New(), UserID: user.ID, BadgeType: badgeType}); err != nil {
		t.Fatalf("First Create: %v", err)
	}

	// Duplicate insert — repository must handle unique constraint gracefully (idempotent: returns nil)
	if err := badgeRepo.Create(ctx, &domain.Badge{ID: uuid.New(), UserID: user.ID, BadgeType: badgeType}); err != nil {
		t.Errorf("Duplicate Create should be idempotent (return nil), got: %v", err)
	}

	// Only one badge should exist
	badges, err := badgeRepo.FindByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(badges) != 1 {
		t.Errorf("want 1 badge after idempotent duplicate, got %d", len(badges))
	}
}

func TestBadgeRepository_MultipleBadgeTypes(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	badgeRepo := repository.NewBadgeRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	types := []string{"first_helper", "verified_finder", "social_butterfly"}
	for _, bt := range types {
		if err := badgeRepo.Create(ctx, &domain.Badge{ID: uuid.New(), UserID: user.ID, BadgeType: bt}); err != nil {
			t.Fatalf("Create badge %q: %v", bt, err)
		}
	}

	badges, err := badgeRepo.FindByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(badges) != 3 {
		t.Errorf("want 3 badges, got %d", len(badges))
	}
}
