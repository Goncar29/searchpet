package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/service"
)

// ============================================================
// Mock repositories
// ============================================================

type mockBadgeRepository struct {
	createFn          func(ctx context.Context, badge *domain.Badge) error
	hasBadgeFn        func(ctx context.Context, userID uuid.UUID, badgeType string) (bool, error)
	findByUserIDFn    func(ctx context.Context, userID uuid.UUID) ([]domain.Badge, error)
	findByUserIDsFn   func(ctx context.Context, userIDs []uuid.UUID) ([]domain.Badge, error)
}

func (m *mockBadgeRepository) Create(ctx context.Context, badge *domain.Badge) error {
	if m.createFn != nil {
		return m.createFn(ctx, badge)
	}
	return nil
}

func (m *mockBadgeRepository) HasBadge(ctx context.Context, userID uuid.UUID, badgeType string) (bool, error) {
	if m.hasBadgeFn != nil {
		return m.hasBadgeFn(ctx, userID, badgeType)
	}
	return false, nil
}

func (m *mockBadgeRepository) FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.Badge, error) {
	if m.findByUserIDFn != nil {
		return m.findByUserIDFn(ctx, userID)
	}
	return []domain.Badge{}, nil
}

func (m *mockBadgeRepository) FindByUserIDs(ctx context.Context, userIDs []uuid.UUID) ([]domain.Badge, error) {
	if m.findByUserIDsFn != nil {
		return m.findByUserIDsFn(ctx, userIDs)
	}
	return []domain.Badge{}, nil
}

type mockUserPointsRepository struct {
	upsertFn          func(ctx context.Context, userID uuid.UUID, pointsDelta int, field string) (*domain.UserPoints, error)
	getByUserIDFn     func(ctx context.Context, userID uuid.UUID) (*domain.UserPoints, error)
	findLeaderboardFn func(ctx context.Context, city string, limit int) ([]domain.UserPoints, error)
}

func (m *mockUserPointsRepository) Upsert(ctx context.Context, userID uuid.UUID, pointsDelta int, field string) (*domain.UserPoints, error) {
	if m.upsertFn != nil {
		return m.upsertFn(ctx, userID, pointsDelta, field)
	}
	return &domain.UserPoints{UserID: userID, Points: pointsDelta, TotalReports: 1}, nil
}

func (m *mockUserPointsRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.UserPoints, error) {
	if m.getByUserIDFn != nil {
		return m.getByUserIDFn(ctx, userID)
	}
	return &domain.UserPoints{UserID: userID, Points: 10}, nil
}

func (m *mockUserPointsRepository) FindLeaderboard(ctx context.Context, city string, limit int) ([]domain.UserPoints, error) {
	if m.findLeaderboardFn != nil {
		return m.findLeaderboardFn(ctx, city, limit)
	}
	return []domain.UserPoints{}, nil
}

// mockGamificationUserRepository is a local alias to avoid name clash with
// mockUserRepository defined in review_service_test.go.
// Because both live in package tests we reuse mockUserRepository directly.

// mockGamificationReviewRepository provides avg rating for GetPublicProfile.
type mockGamificationReviewRepository struct {
	getAverageRatingFn func(ctx context.Context, revieweeID uuid.UUID) (float64, int, error)
}

func (m *mockGamificationReviewRepository) Create(ctx context.Context, review *domain.UserReview) error {
	return nil
}
func (m *mockGamificationReviewRepository) Update(ctx context.Context, review *domain.UserReview) error {
	return nil
}
func (m *mockGamificationReviewRepository) FindByReviewee(ctx context.Context, revieweeID uuid.UUID, limit, offset int) ([]domain.UserReview, error) {
	return []domain.UserReview{}, nil
}
func (m *mockGamificationReviewRepository) FindByReviewerAndReviewee(ctx context.Context, reviewerID, revieweeID uuid.UUID) (*domain.UserReview, error) {
	return nil, domain.ErrReviewNotFound
}
func (m *mockGamificationReviewRepository) GetAverageRating(ctx context.Context, revieweeID uuid.UUID) (float64, int, error) {
	if m.getAverageRatingFn != nil {
		return m.getAverageRatingFn(ctx, revieweeID)
	}
	return 0, 0, nil
}

func (m *mockGamificationReviewRepository) Delete(ctx context.Context, reviewerID, revieweeID uuid.UUID) error {
	return nil
}

// ============================================================
// Helpers
// ============================================================

func newTestGamificationService(
	badgeRepo *mockBadgeRepository,
	pointsRepo *mockUserPointsRepository,
	userRepo *mockUserRepository,
	reviewRepo *mockGamificationReviewRepository,
) service.GamificationService {
	return service.NewGamificationService(badgeRepo, pointsRepo, userRepo, reviewRepo)
}

// waitForEvent blocks until ch receives a value or the timeout elapses.
// Returns true if a value was received in time.
func waitForEvent(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	case <-time.After(500 * time.Millisecond):
		return false
	}
}

// ============================================================
// Event-driven tests (async)
// ============================================================

func TestGamificationService_OnReportCreated_AwardsFirstHelperBadge(t *testing.T) {
	reporterID := uuid.New()

	badgeCreated := make(chan struct{}, 1)
	pointsUpserted := make(chan struct{}, 1)

	badgeRepo := &mockBadgeRepository{
		hasBadgeFn: func(_ context.Context, _ uuid.UUID, _ string) (bool, error) {
			return false, nil // no tiene el badge aún
		},
		createFn: func(_ context.Context, b *domain.Badge) error {
			if b.BadgeType == "first_helper" {
				badgeCreated <- struct{}{}
			}
			return nil
		},
	}
	pointsRepo := &mockUserPointsRepository{
		upsertFn: func(_ context.Context, _ uuid.UUID, delta int, field string) (*domain.UserPoints, error) {
			if delta == 5 && field == "total_reports" {
				pointsUpserted <- struct{}{}
			}
			return &domain.UserPoints{UserID: reporterID, Points: 5, TotalReports: 1}, nil
		},
	}

	svc := newTestGamificationService(badgeRepo, pointsRepo, &mockUserRepository{}, &mockGamificationReviewRepository{})

	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("report.created", event.ReportCreatedEvent{
		ReportID:   uuid.New(),
		PetID:      uuid.New(),
		ReporterID: reporterID,
	})

	if !waitForEvent(pointsUpserted) {
		t.Error("expected points upsert to be called within 500ms")
	}
	if !waitForEvent(badgeCreated) {
		t.Error("expected first_helper badge to be created within 500ms")
	}
}

func TestGamificationService_OnReportCreated_DoesNotReAwardFirstHelper(t *testing.T) {
	reporterID := uuid.New()

	badgeCreateCalled := make(chan struct{}, 1)

	badgeRepo := &mockBadgeRepository{
		hasBadgeFn: func(_ context.Context, _ uuid.UUID, _ string) (bool, error) {
			return true, nil // ya tiene el badge
		},
		createFn: func(_ context.Context, _ *domain.Badge) error {
			badgeCreateCalled <- struct{}{} // should NOT be called
			return nil
		},
	}
	pointsRepo := &mockUserPointsRepository{
		upsertFn: func(_ context.Context, _ uuid.UUID, _ int, _ string) (*domain.UserPoints, error) {
			return &domain.UserPoints{UserID: reporterID, Points: 10, TotalReports: 2}, nil
		},
	}

	svc := newTestGamificationService(badgeRepo, pointsRepo, &mockUserRepository{}, &mockGamificationReviewRepository{})
	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("report.created", event.ReportCreatedEvent{
		ReportID:   uuid.New(),
		PetID:      uuid.New(),
		ReporterID: reporterID,
	})

	// Give the goroutine time to process.
	time.Sleep(200 * time.Millisecond)

	select {
	case <-badgeCreateCalled:
		t.Error("badge Create should NOT be called when user already has first_helper")
	default:
		// correct — no badge created
	}
}

func TestGamificationService_OnPetFound_AwardsPetRescuerAndPoints(t *testing.T) {
	ownerID := uuid.New()

	badgeCreated := make(chan struct{}, 1)
	pointsUpserted := make(chan struct{}, 1)

	badgeRepo := &mockBadgeRepository{
		hasBadgeFn: func(_ context.Context, _ uuid.UUID, _ string) (bool, error) {
			return false, nil
		},
		createFn: func(_ context.Context, b *domain.Badge) error {
			if b.BadgeType == "pet_rescuer" {
				badgeCreated <- struct{}{}
			}
			return nil
		},
	}
	pointsRepo := &mockUserPointsRepository{
		upsertFn: func(_ context.Context, _ uuid.UUID, delta int, field string) (*domain.UserPoints, error) {
			if delta == 100 && field == "found_count" {
				pointsUpserted <- struct{}{}
			}
			return &domain.UserPoints{UserID: ownerID, Points: 100, FoundCount: 1}, nil
		},
	}

	svc := newTestGamificationService(badgeRepo, pointsRepo, &mockUserRepository{}, &mockGamificationReviewRepository{})
	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("pet.found", event.PetFoundEvent{
		PetID:   uuid.New(),
		OwnerID: ownerID,
		PetName: "Firulais",
	})

	if !waitForEvent(pointsUpserted) {
		t.Error("expected 100 points upsert within 500ms")
	}
	if !waitForEvent(badgeCreated) {
		t.Error("expected pet_rescuer badge to be created within 500ms")
	}
}

func TestGamificationService_OnUserVerified_AwardsVerifiedFinderBadge(t *testing.T) {
	userID := uuid.New()

	badgeCreated := make(chan struct{}, 1)

	badgeRepo := &mockBadgeRepository{
		hasBadgeFn: func(_ context.Context, _ uuid.UUID, _ string) (bool, error) {
			return false, nil
		},
		createFn: func(_ context.Context, b *domain.Badge) error {
			if b.BadgeType == "verified_finder" {
				badgeCreated <- struct{}{}
			}
			return nil
		},
	}

	svc := newTestGamificationService(badgeRepo, &mockUserPointsRepository{}, &mockUserRepository{}, &mockGamificationReviewRepository{})
	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("user.verified", event.UserVerifiedEvent{UserID: userID})

	if !waitForEvent(badgeCreated) {
		t.Error("expected verified_finder badge to be created within 500ms")
	}
}

func TestGamificationService_OnShareCreated_AwardsSocialButterfly(t *testing.T) {
	userID := uuid.New()

	badgeCreated := make(chan struct{}, 1)
	pointsUpserted := make(chan struct{}, 1)

	badgeRepo := &mockBadgeRepository{
		hasBadgeFn: func(_ context.Context, _ uuid.UUID, _ string) (bool, error) {
			return false, nil
		},
		createFn: func(_ context.Context, b *domain.Badge) error {
			if b.BadgeType == "social_butterfly" {
				badgeCreated <- struct{}{}
			}
			return nil
		},
	}
	pointsRepo := &mockUserPointsRepository{
		upsertFn: func(_ context.Context, _ uuid.UUID, delta int, field string) (*domain.UserPoints, error) {
			if delta == 2 && field == "share_count" {
				pointsUpserted <- struct{}{}
			}
			return &domain.UserPoints{UserID: userID, Points: 2, ShareCount: 1}, nil
		},
	}

	svc := newTestGamificationService(badgeRepo, pointsRepo, &mockUserRepository{}, &mockGamificationReviewRepository{})
	bus := event.NewEventBus()
	svc.RegisterListeners(bus)

	bus.Publish("share.created", event.ShareCreatedEvent{
		UserID: userID,
		PetID:  uuid.New(),
	})

	if !waitForEvent(pointsUpserted) {
		t.Error("expected 2 points upsert within 500ms")
	}
	if !waitForEvent(badgeCreated) {
		t.Error("expected social_butterfly badge to be created within 500ms")
	}
}

// ============================================================
// Synchronous service method tests
// ============================================================

func TestGamificationService_GetPublicProfile(t *testing.T) {
	userID := uuid.New()

	tests := []struct {
		name        string
		userRepo    *mockUserRepository
		pointsRepo  *mockUserPointsRepository
		badgeRepo   *mockBadgeRepository
		reviewRepo  *mockGamificationReviewRepository
		wantErr     error
		wantPoints  int
		wantBadges  int
	}{
		{
			name: "happy path — user with points and badges",
			userRepo: &mockUserRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
					return &domain.User{ID: id, Name: "Tester", City: "Montevideo"}, nil
				},
			},
			pointsRepo: &mockUserPointsRepository{
				getByUserIDFn: func(_ context.Context, _ uuid.UUID) (*domain.UserPoints, error) {
					return &domain.UserPoints{
						UserID:       userID,
						Points:       42,
						TotalReports: 3,
						FoundCount:   1,
					}, nil
				},
			},
			badgeRepo: &mockBadgeRepository{
				findByUserIDFn: func(_ context.Context, _ uuid.UUID) ([]domain.Badge, error) {
					return []domain.Badge{
						{ID: uuid.New(), UserID: userID, BadgeType: "first_helper", EarnedAt: time.Now()},
					}, nil
				},
			},
			reviewRepo:  &mockGamificationReviewRepository{},
			wantErr:     nil,
			wantPoints:  42,
			wantBadges:  1,
		},
		{
			name: "user with no points yet — returns zeros gracefully",
			userRepo: &mockUserRepository{
				getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.User, error) {
					return &domain.User{ID: id, Name: "New User"}, nil
				},
			},
			pointsRepo: &mockUserPointsRepository{
				getByUserIDFn: func(_ context.Context, _ uuid.UUID) (*domain.UserPoints, error) {
					return nil, domain.ErrPointsNotFound
				},
			},
			badgeRepo:  &mockBadgeRepository{},
			reviewRepo: &mockGamificationReviewRepository{},
			wantErr:    nil,
			wantPoints: 0,
			wantBadges: 0,
		},
		{
			name: "user not found — propagates error",
			userRepo: &mockUserRepository{
				getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.User, error) {
					return nil, domain.ErrUserNotFound
				},
			},
			pointsRepo: &mockUserPointsRepository{},
			badgeRepo:  &mockBadgeRepository{},
			reviewRepo: &mockGamificationReviewRepository{},
			wantErr:    domain.ErrUserNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestGamificationService(tc.badgeRepo, tc.pointsRepo, tc.userRepo, tc.reviewRepo)
			resp, err := svc.GetPublicProfile(context.Background(), userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp == nil {
				t.Fatal("expected response, got nil")
			}
			if resp.TotalPoints != tc.wantPoints {
				t.Errorf("TotalPoints: want %d, got %d", tc.wantPoints, resp.TotalPoints)
			}
			if len(resp.Badges) != tc.wantBadges {
				t.Errorf("Badges count: want %d, got %d", tc.wantBadges, len(resp.Badges))
			}
		})
	}
}

func TestGamificationService_GetLeaderboard(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()

	tests := []struct {
		name       string
		city       string
		limit      int
		pointsRepo *mockUserPointsRepository
		wantLen    int
		wantErr    error
	}{
		{
			name:  "happy path — returns sorted entries",
			city:  "Montevideo",
			limit: 10,
			pointsRepo: &mockUserPointsRepository{
				findLeaderboardFn: func(_ context.Context, city string, limit int) ([]domain.UserPoints, error) {
					if city != "Montevideo" || limit != 10 {
						return nil, errors.New("unexpected args")
					}
					return []domain.UserPoints{
						{UserID: userA, Points: 100, User: domain.User{ID: userA, Name: "Alice", City: "Montevideo"}},
						{UserID: userB, Points: 50, User: domain.User{ID: userB, Name: "Bob", City: "Montevideo"}},
					}, nil
				},
			},
			wantLen: 2,
			wantErr: nil,
		},
		{
			name:  "limit 0 defaults to 10",
			city:  "",
			limit: 0,
			pointsRepo: &mockUserPointsRepository{
				findLeaderboardFn: func(_ context.Context, _ string, limit int) ([]domain.UserPoints, error) {
					if limit != 10 {
						return nil, errors.New("expected default limit 10")
					}
					return []domain.UserPoints{}, nil
				},
			},
			wantLen: 0,
			wantErr: nil,
		},
		{
			name:  "limit > 50 clamped to 50",
			city:  "",
			limit: 200,
			pointsRepo: &mockUserPointsRepository{
				findLeaderboardFn: func(_ context.Context, _ string, limit int) ([]domain.UserPoints, error) {
					if limit != 50 {
						return nil, errors.New("expected clamped limit 50")
					}
					return []domain.UserPoints{}, nil
				},
			},
			wantLen: 0,
			wantErr: nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestGamificationService(
				&mockBadgeRepository{},
				tc.pointsRepo,
				&mockUserRepository{},
				&mockGamificationReviewRepository{},
			)

			entries, err := svc.GetLeaderboard(context.Background(), tc.city, tc.limit)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(entries) != tc.wantLen {
				t.Errorf("expected %d entries, got %d", tc.wantLen, len(entries))
			}

			// Verify rank is 1-based and ordered
			for i, entry := range entries {
				if entry.Rank != i+1 {
					t.Errorf("entry %d: want rank %d, got %d", i, i+1, entry.Rank)
				}
			}
		})
	}
}

func TestGamificationService_GetLeaderboard_BadgesPopulated(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()

	pointsRepo := &mockUserPointsRepository{
		findLeaderboardFn: func(_ context.Context, _ string, _ int) ([]domain.UserPoints, error) {
			return []domain.UserPoints{
				{UserID: userA, Points: 100, User: domain.User{ID: userA, Name: "Alice", City: "Montevideo"}},
				{UserID: userB, Points: 50, User: domain.User{ID: userB, Name: "Bob", City: "Montevideo"}},
			}, nil
		},
	}

	badgeRepo := &mockBadgeRepository{
		findByUserIDsFn: func(_ context.Context, userIDs []uuid.UUID) ([]domain.Badge, error) {
			if len(userIDs) != 2 {
				return nil, errors.New("expected exactly 2 userIDs in batch query")
			}
			return []domain.Badge{
				{UserID: userA, BadgeType: "first_helper"},
				{UserID: userA, BadgeType: "pet_rescuer"},
				{UserID: userB, BadgeType: "verified_finder"},
			}, nil
		},
	}

	svc := newTestGamificationService(badgeRepo, pointsRepo, &mockUserRepository{}, &mockGamificationReviewRepository{})
	entries, err := svc.GetLeaderboard(context.Background(), "Montevideo", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	// userA should have 2 badges
	entryA := entries[0]
	if entryA.UserID != userA {
		t.Errorf("expected first entry to be userA")
	}
	if len(entryA.Badges) != 2 {
		t.Errorf("expected 2 badges for userA, got %d: %v", len(entryA.Badges), entryA.Badges)
	}

	// userB should have 1 badge
	entryB := entries[1]
	if entryB.UserID != userB {
		t.Errorf("expected second entry to be userB")
	}
	if len(entryB.Badges) != 1 {
		t.Errorf("expected 1 badge for userB, got %d: %v", len(entryB.Badges), entryB.Badges)
	}
	if entryB.Badges[0] != "verified_finder" {
		t.Errorf("expected verified_finder badge for userB, got %s", entryB.Badges[0])
	}
}

func TestGamificationService_GetMyBadges(t *testing.T) {
	userID := uuid.New()

	tests := []struct {
		name      string
		badgeRepo *mockBadgeRepository
		wantLen   int
		wantErr   error
	}{
		{
			name: "returns all user badges",
			badgeRepo: &mockBadgeRepository{
				findByUserIDFn: func(_ context.Context, _ uuid.UUID) ([]domain.Badge, error) {
					return []domain.Badge{
						{ID: uuid.New(), UserID: userID, BadgeType: "first_helper"},
						{ID: uuid.New(), UserID: userID, BadgeType: "pet_rescuer"},
					}, nil
				},
			},
			wantLen: 2,
			wantErr: nil,
		},
		{
			name:      "user with no badges returns empty slice",
			badgeRepo: &mockBadgeRepository{},
			wantLen:   0,
			wantErr:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestGamificationService(
				tc.badgeRepo,
				&mockUserPointsRepository{},
				&mockUserRepository{},
				&mockGamificationReviewRepository{},
			)

			badges, err := svc.GetMyBadges(context.Background(), userID)

			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Errorf("expected error %v, got %v", tc.wantErr, err)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			var _ []dto.BadgeResponse = badges // type assertion to confirm correct return type
			if len(badges) != tc.wantLen {
				t.Errorf("expected %d badges, got %d", tc.wantLen, len(badges))
			}
		})
	}
}
