package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/event"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: GamificationService
// ============================================================

type mockGamificationService struct {
	getPublicProfileFn func(ctx context.Context, userID uuid.UUID) (*dto.UserProfileResponse, error)
	getLeaderboardFn   func(ctx context.Context, city string, limit int) ([]dto.LeaderboardEntry, error)
	getMyBadgesFn      func(ctx context.Context, userID uuid.UUID) ([]dto.BadgeResponse, error)
}

func (m *mockGamificationService) RegisterListeners(bus *event.EventBus) {}

func (m *mockGamificationService) AwardBadgeIfEligible(ctx context.Context, userID uuid.UUID, badgeType string) error {
	return nil
}

func (m *mockGamificationService) GetPublicProfile(ctx context.Context, userID uuid.UUID) (*dto.UserProfileResponse, error) {
	if m.getPublicProfileFn != nil {
		return m.getPublicProfileFn(ctx, userID)
	}
	return &dto.UserProfileResponse{}, nil
}

func (m *mockGamificationService) GetLeaderboard(ctx context.Context, city string, limit int) ([]dto.LeaderboardEntry, error) {
	if m.getLeaderboardFn != nil {
		return m.getLeaderboardFn(ctx, city, limit)
	}
	return []dto.LeaderboardEntry{}, nil
}

func (m *mockGamificationService) GetMyBadges(ctx context.Context, userID uuid.UUID) ([]dto.BadgeResponse, error) {
	if m.getMyBadgesFn != nil {
		return m.getMyBadgesFn(ctx, userID)
	}
	return []dto.BadgeResponse{}, nil
}

// Ensure interface compliance at compile time.
var _ service.GamificationService = (*mockGamificationService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupGamificationRouter(h *handler.GamificationHandler, userID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/users/:id/profile", h.GetPublicProfile)
	r.GET("/api/leaderboard", h.GetLeaderboard)
	r.GET("/api/users/me/badges", injectUserID(userID), h.GetMyBadges)
	return r
}

// ============================================================
// GetPublicProfile tests
// ============================================================

func TestGamificationHandler_GetPublicProfile_OK(t *testing.T) {
	targetID := uuid.New()
	expected := &dto.UserProfileResponse{
		ID:          targetID,
		Name:        "Carlos",
		City:        "Montevideo",
		TotalPoints: 120,
		Badges:      []dto.BadgeResponse{},
	}

	svc := &mockGamificationService{
		getPublicProfileFn: func(_ context.Context, id uuid.UUID) (*dto.UserProfileResponse, error) {
			return expected, nil
		},
	}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/users/"+targetID.String()+"/profile", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp dto.UserProfileResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if resp.ID != targetID {
		t.Errorf("expected user ID %s, got %s", targetID, resp.ID)
	}
	if resp.Name != "Carlos" {
		t.Errorf("expected name 'Carlos', got '%s'", resp.Name)
	}
}

func TestGamificationHandler_GetPublicProfile_InvalidUUID(t *testing.T) {
	svc := &mockGamificationService{}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/users/not-a-uuid/profile", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestGamificationHandler_GetPublicProfile_NotFound(t *testing.T) {
	targetID := uuid.New()

	svc := &mockGamificationService{
		getPublicProfileFn: func(_ context.Context, _ uuid.UUID) (*dto.UserProfileResponse, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/users/"+targetID.String()+"/profile", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// ============================================================
// GetLeaderboard tests
// ============================================================

func TestGamificationHandler_GetLeaderboard_OK(t *testing.T) {
	entries := []dto.LeaderboardEntry{
		{UserID: uuid.New(), Name: "Ana", City: "Montevideo", TotalPoints: 500, Rank: 1},
		{UserID: uuid.New(), Name: "Luis", City: "Montevideo", TotalPoints: 300, Rank: 2},
	}

	svc := &mockGamificationService{
		getLeaderboardFn: func(_ context.Context, city string, limit int) ([]dto.LeaderboardEntry, error) {
			return entries, nil
		},
	}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/leaderboard?city=Montevideo", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp []dto.LeaderboardEntry
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 entries, got %d", len(resp))
	}
}

func TestGamificationHandler_GetLeaderboard_MissingCity(t *testing.T) {
	svc := &mockGamificationService{}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/leaderboard", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 when city missing, got %d", w.Code)
	}
}

func TestGamificationHandler_GetLeaderboard_InvalidLimit(t *testing.T) {
	svc := &mockGamificationService{}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/leaderboard?city=Montevideo&limit=abc", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid limit, got %d", w.Code)
	}
}

func TestGamificationHandler_GetLeaderboard_LimitClamped(t *testing.T) {
	var capturedLimit int
	svc := &mockGamificationService{
		getLeaderboardFn: func(_ context.Context, _ string, limit int) ([]dto.LeaderboardEntry, error) {
			capturedLimit = limit
			return []dto.LeaderboardEntry{}, nil
		},
	}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, uuid.New())

	// Requesting 200 should be clamped to 50.
	req := httptest.NewRequest(http.MethodGet, "/api/leaderboard?city=Montevideo&limit=200", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if capturedLimit != 50 {
		t.Errorf("expected limit clamped to 50, got %d", capturedLimit)
	}
}

// ============================================================
// GetMyBadges tests
// ============================================================

func TestGamificationHandler_GetMyBadges_Authenticated(t *testing.T) {
	callerID := uuid.New()
	badges := []dto.BadgeResponse{
		{ID: uuid.New(), BadgeType: "first_helper"},
	}

	svc := &mockGamificationService{
		getMyBadgesFn: func(_ context.Context, id uuid.UUID) ([]dto.BadgeResponse, error) {
			return badges, nil
		},
	}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/users/me/badges", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp []dto.BadgeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if len(resp) != 1 {
		t.Errorf("expected 1 badge, got %d", len(resp))
	}
	if resp[0].BadgeType != "first_helper" {
		t.Errorf("expected badge_type 'first_helper', got '%s'", resp[0].BadgeType)
	}
}

func TestGamificationHandler_GetMyBadges_EmptyList(t *testing.T) {
	callerID := uuid.New()

	svc := &mockGamificationService{
		getMyBadgesFn: func(_ context.Context, _ uuid.UUID) ([]dto.BadgeResponse, error) {
			return []dto.BadgeResponse{}, nil
		},
	}
	h := handler.NewGamificationHandler(svc)
	r := setupGamificationRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/users/me/badges", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp []dto.BadgeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if resp == nil {
		t.Error("expected non-nil array, got null")
	}
}
