package tests

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestVerificationTokenRepository_CreateAndGetByToken(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  "abc123hashvalue0000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(30 * time.Minute),
		Used:      false,
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// FindActiveByUser should return the token
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "email")
	if err != nil {
		t.Fatalf("FindActiveByUser: %v", err)
	}
	if got == nil {
		t.Fatal("want non-nil token, got nil")
	}
	if got.ID != token.ID {
		t.Errorf("want token ID %s, got %s", token.ID, got.ID)
	}
	if got.Channel != "email" {
		t.Errorf("want channel 'email', got %q", got.Channel)
	}
}

func TestVerificationTokenRepository_GetByToken_Expired(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Create an already-expired token
	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  "expiredhashvalue000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(-1 * time.Minute), // already expired
		Used:      false,
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// FindActiveByUser should return nil (expired token is not "active")
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "email")
	if err != nil {
		t.Fatalf("FindActiveByUser: %v", err)
	}
	if got != nil {
		t.Errorf("want nil for expired token, got token ID %s", got.ID)
	}
}

func TestVerificationTokenRepository_MarkUsed(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "sms",
		CodeHash:  "smshashabcdefg00000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(15 * time.Minute),
		Used:      false,
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := tokenRepo.MarkUsed(ctx, token.ID); err != nil {
		t.Fatalf("MarkUsed: %v", err)
	}

	// After marking used, FindActiveByUser should return nil (used=true)
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "sms")
	if err != nil {
		t.Fatalf("FindActiveByUser after MarkUsed: %v", err)
	}
	if got != nil {
		t.Errorf("want nil after MarkUsed, got token ID %s", got.ID)
	}
}

func TestVerificationTokenRepository_IncrementAttempts(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)
	token := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  "attempthashvalue000000000000000000000000000000000000000000000000",
		ExpiresAt: time.Now().Add(30 * time.Minute),
	}
	if err := tokenRepo.Create(ctx, token); err != nil {
		t.Fatalf("Create: %v", err)
	}

	count, err := tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		t.Fatalf("IncrementAttempts: %v", err)
	}
	if count != 1 {
		t.Errorf("want attempts=1 after first increment, got %d", count)
	}

	count2, err := tokenRepo.IncrementAttempts(ctx, token.ID)
	if err != nil {
		t.Fatalf("IncrementAttempts (2nd): %v", err)
	}
	if count2 != 2 {
		t.Errorf("want attempts=2 after second increment, got %d", count2)
	}
}

func TestVerificationTokenRepository_DeleteExpired(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	user := newTestUser(t, userRepo)

	// Create two expired + one valid token
	for i, dur := range []time.Duration{-2 * time.Minute, -1 * time.Minute} {
		tok := &domain.VerificationToken{
			ID:        uuid.New(),
			UserID:    user.ID,
			Channel:   "email",
			CodeHash:  generateTestHash(i),
			ExpiresAt: time.Now().Add(dur),
		}
		if err := tokenRepo.Create(ctx, tok); err != nil {
			t.Fatalf("Create expired token %d: %v", i, err)
		}
	}
	validToken := &domain.VerificationToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		Channel:   "email",
		CodeHash:  generateTestHash(99),
		ExpiresAt: time.Now().Add(30 * time.Minute),
	}
	if err := tokenRepo.Create(ctx, validToken); err != nil {
		t.Fatalf("Create valid token: %v", err)
	}

	deleted, err := tokenRepo.DeleteExpired(ctx)
	if err != nil {
		t.Fatalf("DeleteExpired: %v", err)
	}
	if deleted < 2 {
		t.Errorf("want at least 2 deleted (expired tokens), got %d", deleted)
	}

	// Valid token should still be retrievable
	got, err := tokenRepo.FindActiveByUser(ctx, user.ID, "email")
	if err != nil {
		t.Fatalf("FindActiveByUser after DeleteExpired: %v", err)
	}
	if got == nil {
		t.Error("valid token should still exist after DeleteExpired")
	}
}

// generateTestHash returns a 64-char hex string safe as a CodeHash.
func generateTestHash(i int) string {
	return fmt.Sprintf("%063d%d", 0, i%10)
}
