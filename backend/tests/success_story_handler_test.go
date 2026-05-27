package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: SuccessStoryService
// ============================================================

type mockSuccessStoryService struct {
	createFn      func(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error)
	getByIDFn     func(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error)
	getByPetIDFn  func(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error)
	listFn        func(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error)
	likeFn        func(ctx context.Context, id uuid.UUID) error
	setFeaturedFn func(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error
	deleteFn      func(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error
}

func (m *mockSuccessStoryService) Create(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error) {
	if m.createFn != nil {
		return m.createFn(ctx, userID, req)
	}
	return &domain.SuccessStory{ID: uuid.New(), UserID: userID}, nil
}

func (m *mockSuccessStoryService) GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.SuccessStory{ID: id}, nil
}

func (m *mockSuccessStoryService) GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error) {
	if m.getByPetIDFn != nil {
		return m.getByPetIDFn(ctx, petID)
	}
	return &domain.SuccessStory{ID: uuid.New(), PetID: petID}, nil
}

func (m *mockSuccessStoryService) List(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error) {
	if m.listFn != nil {
		return m.listFn(ctx, featured, limit, offset)
	}
	return []domain.SuccessStory{}, nil
}

func (m *mockSuccessStoryService) Like(ctx context.Context, id uuid.UUID) error {
	if m.likeFn != nil {
		return m.likeFn(ctx, id)
	}
	return nil
}

func (m *mockSuccessStoryService) SetFeatured(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error {
	if m.setFeaturedFn != nil {
		return m.setFeaturedFn(ctx, id, featured, adminID)
	}
	return nil
}

func (m *mockSuccessStoryService) Delete(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id, callerID, isAdmin)
	}
	return nil
}

// Ensure interface compliance at compile time.
var _ service.SuccessStoryService = (*mockSuccessStoryService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupStoryRouter(h *handler.SuccessStoryHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/stories", injectUserID(callerID), h.Create)
	r.GET("/api/stories", h.List)
	r.GET("/api/stories/:id", h.GetByID)
	r.POST("/api/stories/:id/like", injectUserID(callerID), h.Like)
	r.DELETE("/api/stories/:id", injectUserID(callerID), h.Delete)
	return r
}

// injectAdmin adds both userID and isAdmin=true to the context.
func injectAdmin(id uuid.UUID) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("userID", id)
		c.Set("isAdmin", true)
		c.Next()
	}
}

// ============================================================
// Create tests
// ============================================================

func TestStoryHandler_Create_OK(t *testing.T) {
	callerID := uuid.New()
	petID := uuid.New()

	svc := &mockSuccessStoryService{
		createFn: func(_ context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: uuid.New(), UserID: userID, PetID: req.PetID, Body: req.Body}, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	body, _ := json.Marshal(map[string]interface{}{
		"pet_id": petID.String(),
		"title":  "Historia de éxito",
		"body":   "Encontramos a Luna sana y salva.",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/stories", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStoryHandler_Create_NoAuth(t *testing.T) {
	// Without injectUserID, getUserUUID returns uuid.Nil.
	// Missing required body fields should return 400.
	svc := &mockSuccessStoryService{}
	h := handler.NewSuccessStoryHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/stories", h.Create) // no auth middleware

	req := httptest.NewRequest(http.MethodPost, "/api/stories", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// pet_id and body are required — expect 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing required fields, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// List tests
// ============================================================

func TestStoryHandler_List_OK(t *testing.T) {
	stories := []domain.SuccessStory{
		{ID: uuid.New(), Body: "Historia 1"},
		{ID: uuid.New(), Body: "Historia 2"},
	}

	svc := &mockSuccessStoryService{
		listFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.SuccessStory, error) {
			return stories, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/stories", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []dto.StoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 stories, got %d", len(resp))
	}
}

// ============================================================
// GetByID tests
// ============================================================

func TestStoryHandler_GetByID_Found(t *testing.T) {
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: id, Body: "Encontramos a Pepe"}, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/stories/"+storyID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStoryHandler_GetByID_NotFound(t *testing.T) {
	svc := &mockSuccessStoryService{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.SuccessStory, error) {
			return nil, domain.ErrStoryNotFound
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/stories/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Like tests
// ============================================================

func TestStoryHandler_Like_OK(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		likeFn: func(_ context.Context, id uuid.UUID) error {
			return nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/stories/"+storyID.String()+"/like", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStoryHandler_Like_NoAuth_StillWorks(t *testing.T) {
	// Like handler uses the story ID, not the callerID — it's callable without auth.
	// The route in production may or may not require JWT. We test behavior directly.
	storyID := uuid.New()
	svc := &mockSuccessStoryService{
		likeFn: func(_ context.Context, _ uuid.UUID) error { return nil },
	}
	h := handler.NewSuccessStoryHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/stories/:id/like", h.Like)

	req := httptest.NewRequest(http.MethodPost, "/api/stories/"+storyID.String()+"/like", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Delete tests
// ============================================================

func TestStoryHandler_Delete_OwnerCanDelete(t *testing.T) {
	ownerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		deleteFn: func(_ context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error {
			// Simulate ownership check pass
			if callerID == ownerID {
				return nil
			}
			return domain.ErrForbidden
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, ownerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/stories/"+storyID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for owner delete, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStoryHandler_Delete_NonOwnerNonAdmin_Returns403(t *testing.T) {
	otherUserID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		deleteFn: func(_ context.Context, _ uuid.UUID, _ uuid.UUID, isAdmin bool) error {
			return domain.ErrForbidden
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, otherUserID)

	req := httptest.NewRequest(http.MethodDelete, "/api/stories/"+storyID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for non-owner non-admin, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStoryHandler_Delete_AdminCanDelete(t *testing.T) {
	adminID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		deleteFn: func(_ context.Context, _ uuid.UUID, _ uuid.UUID, isAdmin bool) error {
			if isAdmin {
				return nil
			}
			return domain.ErrForbidden
		},
	}
	h := handler.NewSuccessStoryHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.DELETE("/api/stories/:id", injectAdmin(adminID), h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/api/stories/"+storyID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for admin delete, got %d: %s", w.Code, w.Body.String())
	}
}
