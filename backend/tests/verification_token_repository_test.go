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

// CountSince is the backbone of the daily quota. It runs against real Postgres
// because a wrong WHERE clause passes every mock-based test in the suite —
// mocks have no columns and no created_at semantics (rule #34).
func TestVerificationTokenRepository_CountSince(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	tokenRepo := repository.NewVerificationTokenRepository(gormDB)
	ctx := context.Background()

	alice := newTestUser(t, userRepo)
	bob := newTestUser(t, userRepo)

	mint := func(userID uuid.UUID, channel string, createdAt time.Time, used bool) {
		t.Helper()
		tok := &domain.VerificationToken{
			UserID:    userID,
			Channel:   channel,
			CodeHash:  "hash",
			ExpiresAt: createdAt.Add(10 * time.Minute),
			Used:      used,
		}
		if err := tokenRepo.Create(ctx, tok); err != nil {
			t.Fatalf("Create: %v", err)
		}
		// GORM stamps created_at on insert, so the backdating is a second write.
		if err := gormDB.Model(&domain.VerificationToken{}).
			Where("id = ?", tok.ID).UpdateColumn("created_at", createdAt).Error; err != nil {
			t.Fatalf("backdate: %v", err)
		}
	}

	now := time.Now()
	since := now.Add(-24 * time.Hour)

	mint(alice.ID, "password_reset", now.Add(-1*time.Hour), false)
	// USED, and inside the window. This row is the whole point: MarkAllUsedByUserExcept
	// marks previous codes used on every new request, so a CountSince that filtered
	// on `used` would make asking for a new code RESET the cap.
	mint(alice.ID, "password_reset", now.Add(-2*time.Hour), true)
	// Outside the window.
	mint(alice.ID, "password_reset", now.Add(-30*time.Hour), false)
	// Another channel — must not be counted.
	mint(alice.ID, "email", now.Add(-1*time.Hour), false)
	// Another user — counts globally, not for alice.
	mint(bob.ID, "password_reset", now.Add(-3*time.Hour), false)

	got, err := tokenRepo.CountSince(ctx, &alice.ID, "password_reset", since)
	if err != nil {
		t.Fatalf("CountSince(alice): %v", err)
	}
	if got != 2 {
		t.Fatalf("per-user count = %d, want 2 (one unused + one USED inside the window)", got)
	}

	global, err := tokenRepo.CountSince(ctx, nil, "password_reset", since)
	if err != nil {
		t.Fatalf("CountSince(global): %v", err)
	}
	if global != 3 {
		t.Fatalf("global count = %d, want 3 (alice's two plus bob's one)", global)
	}
}
