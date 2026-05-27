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

func TestUserReviewRepository_CreateAndGetByReviewedUser(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	reviewRepo := repository.NewUserReviewRepository(gormDB)
	ctx := context.Background()

	reviewer := newTestUser(t, userRepo)
	reviewee := newTestUser(t, userRepo)

	review := &domain.UserReview{
		ID:         uuid.New(),
		ReviewerID: reviewer.ID,
		RevieweeID: reviewee.ID,
		Stars:      5,
		Text:       "Excelente persona, muy confiable.",
	}
	if err := reviewRepo.Create(ctx, review); err != nil {
		t.Fatalf("Create: %v", err)
	}

	reviews, err := reviewRepo.FindByReviewee(ctx, reviewee.ID, 20, 0)
	if err != nil {
		t.Fatalf("FindByReviewee: %v", err)
	}
	if len(reviews) != 1 {
		t.Fatalf("want 1 review, got %d", len(reviews))
	}
	if reviews[0].Stars != 5 {
		t.Errorf("want stars=5, got %d", reviews[0].Stars)
	}
}

func TestUserReviewRepository_Update(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	reviewRepo := repository.NewUserReviewRepository(gormDB)
	ctx := context.Background()

	reviewer := newTestUser(t, userRepo)
	reviewee := newTestUser(t, userRepo)

	review := &domain.UserReview{
		ID:         uuid.New(),
		ReviewerID: reviewer.ID,
		RevieweeID: reviewee.ID,
		Stars:      3,
		Text:       "Original text",
	}
	if err := reviewRepo.Create(ctx, review); err != nil {
		t.Fatalf("Create: %v", err)
	}

	review.Stars = 4
	review.Text = "Updated text"
	if err := reviewRepo.Update(ctx, review); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := reviewRepo.FindByReviewerAndReviewee(ctx, reviewer.ID, reviewee.ID)
	if err != nil {
		t.Fatalf("FindByReviewerAndReviewee: %v", err)
	}
	if got.Stars != 4 {
		t.Errorf("want stars=4 after update, got %d", got.Stars)
	}
	if got.Text != "Updated text" {
		t.Errorf("want text 'Updated text', got %q", got.Text)
	}
}

func TestUserReviewRepository_DuplicateReview_ReturnsErrAlreadyReviewed(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	reviewRepo := repository.NewUserReviewRepository(gormDB)
	ctx := context.Background()

	reviewer := newTestUser(t, userRepo)
	reviewee := newTestUser(t, userRepo)

	r1 := &domain.UserReview{ID: uuid.New(), ReviewerID: reviewer.ID, RevieweeID: reviewee.ID, Stars: 4, Text: "First"}
	if err := reviewRepo.Create(ctx, r1); err != nil {
		t.Fatalf("Create first: %v", err)
	}

	r2 := &domain.UserReview{ID: uuid.New(), ReviewerID: reviewer.ID, RevieweeID: reviewee.ID, Stars: 5, Text: "Duplicate"}
	err := reviewRepo.Create(ctx, r2)
	if !errors.Is(err, domain.ErrAlreadyReviewed) {
		t.Errorf("want ErrAlreadyReviewed for duplicate (reviewer, reviewee) pair, got %v", err)
	}
}

func TestUserReviewRepository_FindByReviewerAndReviewee_NotFound(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	reviewRepo := repository.NewUserReviewRepository(gormDB)
	ctx := context.Background()

	u1 := newTestUser(t, userRepo)
	u2 := newTestUser(t, userRepo)

	_, err := reviewRepo.FindByReviewerAndReviewee(ctx, u1.ID, u2.ID)
	if !errors.Is(err, domain.ErrReviewNotFound) {
		t.Errorf("want ErrReviewNotFound, got %v", err)
	}
}

func TestUserReviewRepository_GetAverageRating(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	reviewRepo := repository.NewUserReviewRepository(gormDB)
	ctx := context.Background()

	reviewee := newTestUser(t, userRepo)

	// Two reviewers give 4 and 2 stars → average = 3.0
	for _, stars := range []int{4, 2} {
		reviewer := newTestUser(t, userRepo)
		r := &domain.UserReview{ID: uuid.New(), ReviewerID: reviewer.ID, RevieweeID: reviewee.ID, Stars: stars, Text: "test"}
		if err := reviewRepo.Create(ctx, r); err != nil {
			t.Fatalf("Create review (%d stars): %v", stars, err)
		}
	}

	avg, count, err := reviewRepo.GetAverageRating(ctx, reviewee.ID)
	if err != nil {
		t.Fatalf("GetAverageRating: %v", err)
	}
	if count != 2 {
		t.Errorf("want count=2, got %d", count)
	}
	if avg != 3.0 {
		t.Errorf("want avg=3.0, got %f", avg)
	}
}
