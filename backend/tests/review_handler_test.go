package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: ReviewService
// ============================================================

type mockReviewService struct {
	createFn       func(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.CreateReviewRequest) (*dto.ReviewResponse, error)
	updateFn       func(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.UpdateReviewRequest) (*dto.ReviewResponse, error)
	getByRevieweeFn func(ctx context.Context, revieweeID uuid.UUID, limit, offset int) (*dto.ReviewListResponse, error)
}

func (m *mockReviewService) Create(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.CreateReviewRequest) (*dto.ReviewResponse, error) {
	if m.createFn != nil {
		return m.createFn(ctx, reviewerID, revieweeID, req)
	}
	return &dto.ReviewResponse{ID: uuid.New(), ReviewerID: reviewerID, Stars: req.Stars}, nil
}

func (m *mockReviewService) Update(ctx context.Context, reviewerID, revieweeID uuid.UUID, req dto.UpdateReviewRequest) (*dto.ReviewResponse, error) {
	if m.updateFn != nil {
		return m.updateFn(ctx, reviewerID, revieweeID, req)
	}
	return &dto.ReviewResponse{ID: uuid.New(), ReviewerID: reviewerID}, nil
}

func (m *mockReviewService) GetByReviewee(ctx context.Context, revieweeID uuid.UUID, limit, offset int) (*dto.ReviewListResponse, error) {
	if m.getByRevieweeFn != nil {
		return m.getByRevieweeFn(ctx, revieweeID, limit, offset)
	}
	return &dto.ReviewListResponse{Reviews: []dto.ReviewResponse{}, Total: 0, Page: 1, PageSize: 20}, nil
}

// Ensure interface compliance at compile time.
var _ service.ReviewService = (*mockReviewService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupReviewRouter(h *handler.ReviewHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/users/:id/reviews", h.GetReviews)
	r.POST("/api/users/:id/reviews", injectUserID(callerID), h.CreateReview)
	r.PUT("/api/users/:id/reviews", injectUserID(callerID), h.UpdateReview)
	return r
}

// fixedReviewResponse returns a populated ReviewResponse for use in tests.
func fixedReviewResponse(reviewerID uuid.UUID, stars int) *dto.ReviewResponse {
	return &dto.ReviewResponse{
		ID:           uuid.New(),
		ReviewerID:   reviewerID,
		ReviewerName: "Test Reviewer",
		Stars:        stars,
		Text:         "Muy buen usuario",
		CreatedAt:    time.Now(),
	}
}

// ============================================================
// CreateReview tests
// ============================================================

func TestReviewHandler_CreateReview_OK(t *testing.T) {
	reviewerID := uuid.New()
	revieweeID := uuid.New()

	svc := &mockReviewService{
		createFn: func(_ context.Context, rID, _ uuid.UUID, req dto.CreateReviewRequest) (*dto.ReviewResponse, error) {
			return fixedReviewResponse(rID, req.Stars), nil
		},
	}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, reviewerID)

	body, _ := json.Marshal(map[string]interface{}{
		"stars": 5,
		"text":  "Excelente persona, muy confiable.",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/users/"+revieweeID.String()+"/reviews", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestReviewHandler_CreateReview_NoAuth(t *testing.T) {
	// Without injectUserID, missing required body should still fail at binding
	svc := &mockReviewService{}
	h := handler.NewReviewHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/users/:id/reviews", h.CreateReview) // no auth middleware

	req := httptest.NewRequest(http.MethodPost, "/api/users/"+uuid.New().String()+"/reviews", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// stars and text are binding:"required" — expect 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing required fields, got %d: %s", w.Code, w.Body.String())
	}
}

func TestReviewHandler_CreateReview_Duplicate_Returns409(t *testing.T) {
	reviewerID := uuid.New()
	revieweeID := uuid.New()

	svc := &mockReviewService{
		createFn: func(_ context.Context, _, _ uuid.UUID, _ dto.CreateReviewRequest) (*dto.ReviewResponse, error) {
			return nil, domain.ErrAlreadyReviewed
		},
	}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, reviewerID)

	body, _ := json.Marshal(map[string]interface{}{
		"stars": 4,
		"text":  "Segunda reseña — debería ser 409.",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/users/"+revieweeID.String()+"/reviews", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409 for duplicate review, got %d: %s", w.Code, w.Body.String())
	}
}

func TestReviewHandler_CreateReview_InvalidUUID(t *testing.T) {
	svc := &mockReviewService{}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, uuid.New())

	body, _ := json.Marshal(map[string]interface{}{
		"stars": 3,
		"text":  "OK",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/users/not-a-uuid/reviews", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid UUID, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// UpdateReview tests
// ============================================================

func TestReviewHandler_UpdateReview_Owner(t *testing.T) {
	reviewerID := uuid.New()
	revieweeID := uuid.New()

	svc := &mockReviewService{
		updateFn: func(_ context.Context, rID, _ uuid.UUID, _ dto.UpdateReviewRequest) (*dto.ReviewResponse, error) {
			return fixedReviewResponse(rID, 3), nil
		},
	}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, reviewerID)

	newStars := 3
	body, _ := json.Marshal(map[string]interface{}{
		"stars": newStars,
		"text":  "Actualizo mi reseña.",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/users/"+revieweeID.String()+"/reviews", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for owner update, got %d: %s", w.Code, w.Body.String())
	}
}

func TestReviewHandler_UpdateReview_NonOwner_Returns403(t *testing.T) {
	otherUserID := uuid.New()
	revieweeID := uuid.New()

	svc := &mockReviewService{
		updateFn: func(_ context.Context, _, _ uuid.UUID, _ dto.UpdateReviewRequest) (*dto.ReviewResponse, error) {
			return nil, domain.ErrForbidden
		},
	}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, otherUserID)

	stars := 2
	body, _ := json.Marshal(map[string]interface{}{
		"stars": stars,
		"text":  "No debería poder.",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/users/"+revieweeID.String()+"/reviews", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for non-owner update, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// GetReviews tests
// ============================================================

func TestReviewHandler_GetReviews_OK(t *testing.T) {
	revieweeID := uuid.New()
	reviews := []dto.ReviewResponse{
		*fixedReviewResponse(uuid.New(), 5),
		*fixedReviewResponse(uuid.New(), 4),
	}

	svc := &mockReviewService{
		getByRevieweeFn: func(_ context.Context, _ uuid.UUID, _, _ int) (*dto.ReviewListResponse, error) {
			return &dto.ReviewListResponse{
				Reviews:  reviews,
				Total:    2,
				Page:     1,
				PageSize: 20,
			}, nil
		},
	}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/users/"+revieweeID.String()+"/reviews", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ReviewListResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Total != 2 {
		t.Errorf("expected total=2, got %d", resp.Total)
	}
	if len(resp.Reviews) != 2 {
		t.Errorf("expected 2 reviews, got %d", len(resp.Reviews))
	}
}

func TestReviewHandler_GetReviews_InvalidUUID(t *testing.T) {
	svc := &mockReviewService{}
	h := handler.NewReviewHandler(svc)
	r := setupReviewRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/users/not-a-uuid/reviews", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid UUID, got %d: %s", w.Code, w.Body.String())
	}
}
