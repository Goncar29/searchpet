package tests

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// ============================================================
// Mock repositories
// ============================================================

// mockUserReviewRepository implementa repository.UserReviewRepository para tests.
type mockUserReviewRepository struct {
	createFn                  func(ctx context.Context, review *domain.UserReview) error
	updateFn                  func(ctx context.Context, review *domain.UserReview) error
	findByRevieweeFn          func(ctx context.Context, revieweeID uuid.UUID, limit, offset int) ([]domain.UserReview, error)
	findByReviewerAndRevieweeFn func(ctx context.Context, reviewerID, revieweeID uuid.UUID) (*domain.UserReview, error)
	getAverageRatingFn        func(ctx context.Context, revieweeID uuid.UUID) (float64, int, error)
}

func (m *mockUserReviewRepository) Create(ctx context.Context, review *domain.UserReview) error {
	if m.createFn != nil {
		return m.createFn(ctx, review)
	}
	return nil
}

func (m *mockUserReviewRepository) Update(ctx context.Context, review *domain.UserReview) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, review)
	}
	return nil
}

func (m *mockUserReviewRepository) FindByReviewee(ctx context.Context, revieweeID uuid.UUID, limit, offset int) ([]domain.UserReview, error) {
	if m.findByRevieweeFn != nil {
		return m.findByRevieweeFn(ctx, revieweeID, limit, offset)
	}
	return []domain.UserReview{}, nil
}

func (m *mockUserReviewRepository) FindByReviewerAndReviewee(ctx context.Context, reviewerID, revieweeID uuid.UUID) (*domain.UserReview, error) {
	if m.findByReviewerAndRevieweeFn != nil {
		return m.findByReviewerAndRevieweeFn(ctx, reviewerID, revieweeID)
	}
	return nil, domain.ErrReviewNotFound
}

func (m *mockUserReviewRepository) GetAverageRating(ctx context.Context, revieweeID uuid.UUID) (float64, int, error) {
	if m.getAverageRatingFn != nil {
		return m.getAverageRatingFn(ctx, revieweeID)
	}
	return 0, 0, nil
}

// mockBlockedUserRepository implementa repository.BlockedUserRepository para tests.
type mockBlockedUserRepository struct {
	isBlockedFn func(ctx context.Context, userA, userB uuid.UUID) (bool, error)
}

func (m *mockBlockedUserRepository) Create(ctx context.Context, block *domain.BlockedUser) error {
	return nil
}

func (m *mockBlockedUserRepository) Delete(ctx context.Context, blockerID, blockedID uuid.UUID) error {
	return nil
}

func (m *mockBlockedUserRepository) IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error) {
	if m.isBlockedFn != nil {
		return m.isBlockedFn(ctx, userA, userB)
	}
	return false, nil
}

func (m *mockBlockedUserRepository) GetBlockedByUserID(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error) {
	return []domain.BlockedUser{}, nil
}

// mockUserRepository implementa repository.UserRepository para tests.
type mockUserRepository struct {
	getByIDFn func(ctx context.Context, id uuid.UUID) (*domain.User, error)
}

func (m *mockUserRepository) Create(ctx context.Context, user *domain.User) error { return nil }
func (m *mockUserRepository) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	return nil, nil
}
func (m *mockUserRepository) Update(ctx context.Context, user *domain.User) error { return nil }
func (m *mockUserRepository) Delete(ctx context.Context, id uuid.UUID) error      { return nil }

func (m *mockUserRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.User{ID: id, Name: "Test User"}, nil
}

// ============================================================
// Helper: build service with optional overrides
// ============================================================

func newTestReviewService(
	reviewRepo *mockUserReviewRepository,
	blockedRepo *mockBlockedUserRepository,
	userRepo *mockUserRepository,
) service.ReviewService {
	bus := event.NewEventBus()
	return service.NewReviewService(reviewRepo, blockedRepo, userRepo, bus)
}

// ============================================================
// Create tests
// ============================================================

func TestReviewService_Create(t *testing.T) {
	reviewerID := uuid.New()
	revieweeID := uuid.New()

	tests := []struct {
		name        string
		reviewRepo  *mockUserReviewRepository
		blockedRepo *mockBlockedUserRepository
		userRepo    *mockUserRepository
		req         dto.CreateReviewRequest
		wantErr     error
		wantNoDBCall bool
	}{
		{
			name: "happy path — create review",
			reviewRepo: &mockUserReviewRepository{
				findByReviewerAndRevieweeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.UserReview, error) {
					return nil, domain.ErrReviewNotFound // no existe aún
				},
				createFn: func(_ context.Context, r *domain.UserReview) error {
					r.ID = uuid.New() // simular asignación de ID
					return nil
				},
			},
			blockedRepo: &mockBlockedUserRepository{},
			userRepo:    &mockUserRepository{},
			req:         dto.CreateReviewRequest{Stars: 4, Text: "Great helper!"},
			wantErr:     nil,
		},
		{
			name:         "self-review — no DB call",
			reviewRepo:   &mockUserReviewRepository{},
			blockedRepo:  &mockBlockedUserRepository{},
			userRepo:     &mockUserRepository{},
			req:          dto.CreateReviewRequest{Stars: 5, Text: "I review myself"},
			wantErr:      domain.ErrSelfReview,
			wantNoDBCall: true,
		},
		{
			name: "duplicate review — ErrAlreadyReviewed",
			reviewRepo: &mockUserReviewRepository{
				findByReviewerAndRevieweeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.UserReview, error) {
					return &domain.UserReview{}, nil // ya existe
				},
			},
			blockedRepo: &mockBlockedUserRepository{},
			userRepo:    &mockUserRepository{},
			req:         dto.CreateReviewRequest{Stars: 3, Text: "Again"},
			wantErr:     domain.ErrAlreadyReviewed,
		},
		{
			name:        "invalid rating 0 — ErrInvalidInput",
			reviewRepo:  &mockUserReviewRepository{},
			blockedRepo: &mockBlockedUserRepository{},
			userRepo:    &mockUserRepository{},
			req:         dto.CreateReviewRequest{Stars: 0, Text: "No rating"},
			wantErr:     domain.ErrInvalidInput,
		},
		{
			name:        "invalid rating 6 — ErrInvalidInput",
			reviewRepo:  &mockUserReviewRepository{},
			blockedRepo: &mockBlockedUserRepository{},
			userRepo:    &mockUserRepository{},
			req:         dto.CreateReviewRequest{Stars: 6, Text: "Too high"},
			wantErr:     domain.ErrInvalidInput,
		},
		{
			name:        "empty body — ErrInvalidInput",
			reviewRepo:  &mockUserReviewRepository{},
			blockedRepo: &mockBlockedUserRepository{},
			userRepo:    &mockUserRepository{},
			req:         dto.CreateReviewRequest{Stars: 3, Text: ""},
			wantErr:     domain.ErrInvalidInput,
		},
		{
			name: "blocked user — ErrUserBlocked",
			reviewRepo: &mockUserReviewRepository{},
			blockedRepo: &mockBlockedUserRepository{
				isBlockedFn: func(_ context.Context, _, _ uuid.UUID) (bool, error) {
					return true, nil
				},
			},
			userRepo: &mockUserRepository{},
			req:      dto.CreateReviewRequest{Stars: 1, Text: "Blocked test"},
			wantErr:  domain.ErrUserBlocked,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			callerID := reviewerID
			targetID := revieweeID
			if tc.wantNoDBCall {
				// Self-review: use same ID
				callerID = reviewerID
				targetID = reviewerID
			}

			svc := newTestReviewService(tc.reviewRepo, tc.blockedRepo, tc.userRepo)
			resp, err := svc.Create(context.Background(), callerID, targetID, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				if resp != nil {
					t.Errorf("expected nil response on error, got %+v", resp)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if resp == nil {
				t.Error("expected response, got nil")
			}
		})
	}
}

// ============================================================
// Update tests
// ============================================================

func TestReviewService_Update(t *testing.T) {
	reviewerID := uuid.New()
	revieweeID := uuid.New()
	otherID := uuid.New()

	existingReview := &domain.UserReview{
		ID:         uuid.New(),
		ReviewerID: reviewerID,
		RevieweeID: revieweeID,
		Stars:      3,
		Text:       "ok",
	}

	newStars := 5
	newText := "Changed mind, great!"

	tests := []struct {
		name       string
		callerID   uuid.UUID
		reviewRepo *mockUserReviewRepository
		req        dto.UpdateReviewRequest
		wantErr    error
	}{
		{
			name:     "happy path — update own review",
			callerID: reviewerID,
			reviewRepo: &mockUserReviewRepository{
				findByReviewerAndRevieweeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.UserReview, error) {
					copy := *existingReview
					return &copy, nil
				},
				updateFn: func(_ context.Context, _ *domain.UserReview) error {
					return nil
				},
			},
			req:     dto.UpdateReviewRequest{Stars: &newStars, Text: &newText},
			wantErr: nil,
		},
		{
			name:     "review not found",
			callerID: otherID,
			reviewRepo: &mockUserReviewRepository{
				findByReviewerAndRevieweeFn: func(_ context.Context, _, _ uuid.UUID) (*domain.UserReview, error) {
					return nil, domain.ErrReviewNotFound
				},
			},
			req:     dto.UpdateReviewRequest{Stars: &newStars},
			wantErr: domain.ErrReviewNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestReviewService(
				tc.reviewRepo,
				&mockBlockedUserRepository{},
				&mockUserRepository{},
			)

			resp, err := svc.Update(context.Background(), tc.callerID, revieweeID, tc.req)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if resp == nil {
				t.Error("expected response, got nil")
			}
		})
	}
}
