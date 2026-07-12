package tests

import (
	"context"
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

func TestConversationHideRepository_UpsertCreatesAndRefreshes(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	hideRepo := repository.NewConversationHideRepository(gormDB)
	ctx := context.Background()

	me := newTestUser(t, userRepo)
	other := newTestUser(t, userRepo)

	// First hide creates the row
	if err := hideRepo.Upsert(ctx, me.ID, other.ID); err != nil {
		t.Fatalf("first Upsert: %v", err)
	}

	var hide domain.ConversationHide
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).First(&hide).Error; err != nil {
		t.Fatalf("hide row not found: %v", err)
	}
	firstHiddenAt := hide.HiddenAt

	// Second hide refreshes hidden_at instead of failing on the PK
	time.Sleep(50 * time.Millisecond)
	if err := hideRepo.Upsert(ctx, me.ID, other.ID); err != nil {
		t.Fatalf("second Upsert: %v", err)
	}
	if err := gormDB.Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).First(&hide).Error; err != nil {
		t.Fatalf("hide row not found after re-hide: %v", err)
	}
	if !hide.HiddenAt.After(firstHiddenAt) {
		t.Errorf("want hidden_at refreshed: first=%v second=%v", firstHiddenAt, hide.HiddenAt)
	}

	// Only one row exists for the pair
	var count int64
	gormDB.Model(&domain.ConversationHide{}).
		Where("user_id = ? AND other_user_id = ?", me.ID, other.ID).Count(&count)
	if count != 1 {
		t.Errorf("want 1 hide row, got %d", count)
	}
}
