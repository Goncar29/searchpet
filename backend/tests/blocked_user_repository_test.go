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

func TestBlockedUserRepository_BlockAndIsBlocked(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	blockRepo := repository.NewBlockedUserRepository(gormDB)
	ctx := context.Background()

	blocker := newTestUser(t, userRepo)
	blocked := newTestUser(t, userRepo)

	// Before block — not blocked
	isBlocked, err := blockRepo.IsBlocked(ctx, blocker.ID, blocked.ID)
	if err != nil {
		t.Fatalf("IsBlocked before: %v", err)
	}
	if isBlocked {
		t.Error("want IsBlocked=false before blocking")
	}

	// Block
	block := &domain.BlockedUser{
		ID:        uuid.New(),
		BlockerID: blocker.ID,
		BlockedID: blocked.ID,
	}
	if err := blockRepo.Create(ctx, block); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// After block
	isBlocked, err = blockRepo.IsBlocked(ctx, blocker.ID, blocked.ID)
	if err != nil {
		t.Fatalf("IsBlocked after: %v", err)
	}
	if !isBlocked {
		t.Error("want IsBlocked=true after blocking")
	}
}

func TestBlockedUserRepository_IsBlocked_Bidirectional(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	blockRepo := repository.NewBlockedUserRepository(gormDB)
	ctx := context.Background()

	userA := newTestUser(t, userRepo)
	userB := newTestUser(t, userRepo)

	// A blocks B
	if err := blockRepo.Create(ctx, &domain.BlockedUser{ID: uuid.New(), BlockerID: userA.ID, BlockedID: userB.ID}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Check both directions
	ab, err := blockRepo.IsBlocked(ctx, userA.ID, userB.ID)
	if err != nil {
		t.Fatalf("IsBlocked(A,B): %v", err)
	}
	ba, err := blockRepo.IsBlocked(ctx, userB.ID, userA.ID)
	if err != nil {
		t.Fatalf("IsBlocked(B,A): %v", err)
	}
	if !ab || !ba {
		t.Errorf("IsBlocked should be true in both directions: (A,B)=%v (B,A)=%v", ab, ba)
	}
}

func TestBlockedUserRepository_UnblockAndIsBlocked(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	blockRepo := repository.NewBlockedUserRepository(gormDB)
	ctx := context.Background()

	blocker := newTestUser(t, userRepo)
	blocked := newTestUser(t, userRepo)

	// Block
	if err := blockRepo.Create(ctx, &domain.BlockedUser{ID: uuid.New(), BlockerID: blocker.ID, BlockedID: blocked.ID}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Unblock
	if err := blockRepo.Delete(ctx, blocker.ID, blocked.ID); err != nil {
		t.Fatalf("Delete (unblock): %v", err)
	}

	isBlocked, err := blockRepo.IsBlocked(ctx, blocker.ID, blocked.ID)
	if err != nil {
		t.Fatalf("IsBlocked after unblock: %v", err)
	}
	if isBlocked {
		t.Error("want IsBlocked=false after unblocking")
	}
}

func TestBlockedUserRepository_Unblock_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	blockRepo := repository.NewBlockedUserRepository(gormDB)
	ctx := context.Background()

	u1 := newTestUser(t, userRepo)
	u2 := newTestUser(t, userRepo)

	err := blockRepo.Delete(ctx, u1.ID, u2.ID)
	if !errors.Is(err, domain.ErrBlockNotFound) {
		t.Errorf("want ErrBlockNotFound when deleting non-existent block, got %v", err)
	}
}

func TestBlockedUserRepository_GetBlockedByUser(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	blockRepo := repository.NewBlockedUserRepository(gormDB)
	ctx := context.Background()

	blocker := newTestUser(t, userRepo)
	b1 := newTestUser(t, userRepo)
	b2 := newTestUser(t, userRepo)

	for _, b := range []*domain.User{b1, b2} {
		if err := blockRepo.Create(ctx, &domain.BlockedUser{ID: uuid.New(), BlockerID: blocker.ID, BlockedID: b.ID}); err != nil {
			t.Fatalf("Create block for %s: %v", b.ID, err)
		}
	}

	blocks, err := blockRepo.GetBlockedByUserID(ctx, blocker.ID)
	if err != nil {
		t.Fatalf("GetBlockedByUserID: %v", err)
	}
	if len(blocks) < 2 {
		t.Errorf("want at least 2 blocks, got %d", len(blocks))
	}
}
