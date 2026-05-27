package tests

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestDeviceTokenRepository_Register(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewDeviceTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	rawToken := fmt.Sprintf("fcm-token-%s", uuid.New().String())

	dt := &domain.DeviceToken{
		ID:       uuid.New(),
		UserID:   user.ID,
		Token:    rawToken,
		Platform: "android",
	}
	if err := tokenRepo.Upsert(ctx, dt); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	tokens, err := tokenRepo.FindByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(tokens) != 1 {
		t.Fatalf("want 1 token, got %d", len(tokens))
	}
	if tokens[0].Token != rawToken {
		t.Errorf("want token %q, got %q", rawToken, tokens[0].Token)
	}
	if tokens[0].Platform != "android" {
		t.Errorf("want platform 'android', got %q", tokens[0].Platform)
	}
}

func TestDeviceTokenRepository_GetByUserID_Multiple(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewDeviceTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	for i, platform := range []string{"android", "ios"} {
		dt := &domain.DeviceToken{
			ID:       uuid.New(),
			UserID:   user.ID,
			Token:    fmt.Sprintf("token-%d-%s", i, uuid.New().String()),
			Platform: platform,
		}
		if err := tokenRepo.Upsert(ctx, dt); err != nil {
			t.Fatalf("Upsert %s: %v", platform, err)
		}
	}

	tokens, err := tokenRepo.FindByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindByUserID: %v", err)
	}
	if len(tokens) != 2 {
		t.Errorf("want 2 tokens, got %d", len(tokens))
	}
}

func TestDeviceTokenRepository_Delete(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewDeviceTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	rawToken := fmt.Sprintf("del-token-%s", uuid.New().String())

	dt := &domain.DeviceToken{
		ID:       uuid.New(),
		UserID:   user.ID,
		Token:    rawToken,
		Platform: "web",
	}
	if err := tokenRepo.Upsert(ctx, dt); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	if err := tokenRepo.DeleteByToken(ctx, rawToken); err != nil {
		t.Fatalf("DeleteByToken: %v", err)
	}

	tokens, err := tokenRepo.FindByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindByUserID after delete: %v", err)
	}
	if len(tokens) != 0 {
		t.Errorf("want 0 tokens after delete, got %d", len(tokens))
	}
}

func TestDeviceTokenRepository_Upsert_TokenReassignment(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewDeviceTokenRepository(gormDB)
	ctx := context.Background()

	user1 := newTestUser(t, userRepo)
	user2 := newTestUser(t, userRepo)
	rawToken := fmt.Sprintf("shared-token-%s", uuid.New().String())

	// Register for user1
	dt1 := &domain.DeviceToken{ID: uuid.New(), UserID: user1.ID, Token: rawToken, Platform: "ios"}
	if err := tokenRepo.Upsert(ctx, dt1); err != nil {
		t.Fatalf("Upsert user1: %v", err)
	}

	// Re-register same token for user2 (device changed owner)
	dt2 := &domain.DeviceToken{ID: uuid.New(), UserID: user2.ID, Token: rawToken, Platform: "ios"}
	if err := tokenRepo.Upsert(ctx, dt2); err != nil {
		t.Fatalf("Upsert user2: %v", err)
	}

	// Token must now belong to user2
	tokens2, err := tokenRepo.FindByUserID(ctx, user2.ID)
	if err != nil {
		t.Fatalf("FindByUserID user2: %v", err)
	}
	if len(tokens2) != 1 {
		t.Fatalf("want 1 token for user2 after reassignment, got %d", len(tokens2))
	}
}
