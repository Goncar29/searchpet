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
	createFn        func(ctx context.Context, userID uuid.UUID, req dto.CreateStoryRequest) (*domain.SuccessStory, error)
	getByIDFn       func(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error)
	getByPetIDFn    func(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error)
	listFn          func(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error)
	countVal        int64
	countFn         func(ctx context.Context, featured *bool) (int64, error)
	likeFn          func(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error)
	unlikeFn        func(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error)
	likedStoryIDsFn func(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error)
	setFeaturedFn   func(ctx context.Context, id uuid.UUID, featured bool, adminID uuid.UUID) error
	deleteFn        func(ctx context.Context, id uuid.UUID, callerID uuid.UUID, isAdmin bool) error
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

func (m *mockSuccessStoryService) Count(ctx context.Context, featured *bool) (int64, error) {
	if m.countFn != nil {
		return m.countFn(ctx, featured)
	}
	return m.countVal, nil
}

func (m *mockSuccessStoryService) Like(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error) {
	if m.likeFn != nil {
		return m.likeFn(ctx, storyID, userID)
	}
	return 1, true, nil
}

func (m *mockSuccessStoryService) Unlike(ctx context.Context, storyID, userID uuid.UUID) (int, bool, error) {
	if m.unlikeFn != nil {
		return m.unlikeFn(ctx, storyID, userID)
	}
	return 0, false, nil
}

func (m *mockSuccessStoryService) LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	if m.likedStoryIDsFn != nil {
		return m.likedStoryIDsFn(ctx, userID, storyIDs)
	}
	return map[uuid.UUID]bool{}, nil
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
	r.GET("/api/stories", injectUserID(callerID), h.List)
	r.GET("/api/stories/pet/:petId", injectUserID(callerID), h.GetByPetID)
	r.GET("/api/stories/:id", injectUserID(callerID), h.GetByID)
	r.POST("/api/stories/:id/like", injectUserID(callerID), h.Like)
	r.DELETE("/api/stories/:id/like", injectUserID(callerID), h.Unlike)
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

func TestStoryHandler_List_SetsTotalCountHeader(t *testing.T) {
	svc := &mockSuccessStoryService{
		listFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.SuccessStory, error) {
			return []domain.SuccessStory{{ID: uuid.New()}}, nil
		},
		countVal: 17,
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/stories?limit=20&offset=0&count=true", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("X-Total-Count"); got != "17" {
		t.Errorf("expected X-Total-Count=17, got %q", got)
	}
}

// Without ?count=true (the public feed path) the handler must skip the COUNT query
// and omit the header, so homepage/mobile callers don't pay for it.
func TestStoryHandler_List_OmitsTotalCountWithoutOptIn(t *testing.T) {
	counted := false
	svc := &mockSuccessStoryService{
		listFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.SuccessStory, error) {
			return []domain.SuccessStory{{ID: uuid.New()}}, nil
		},
		countFn: func(_ context.Context, _ *bool) (int64, error) {
			counted = true
			return 17, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/stories?limit=20&offset=0", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("X-Total-Count"); got != "" {
		t.Errorf("expected no X-Total-Count header, got %q", got)
	}
	if counted {
		t.Error("Count should not run without ?count=true")
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
		likeFn: func(_ context.Context, id, userID uuid.UUID) (int, bool, error) {
			return 1, true, nil
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

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["like_count"] != float64(1) {
		t.Errorf("expected like_count=1, got %v", resp["like_count"])
	}
	if resp["liked"] != true {
		t.Errorf("expected liked=true, got %v", resp["liked"])
	}
}

func TestStoryHandler_Like_RepeatLike_Idempotent(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		likeFn: func(_ context.Context, id, userID uuid.UUID) (int, bool, error) {
			// Repeated like: count stays at 1, liked remains true.
			return 1, true, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/stories/"+storyID.String()+"/like", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("like #%d: expected 200, got %d: %s", i+1, w.Code, w.Body.String())
		}

		var resp map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp["like_count"] != float64(1) {
			t.Errorf("like #%d: expected like_count=1, got %v", i+1, resp["like_count"])
		}
		if resp["liked"] != true {
			t.Errorf("like #%d: expected liked=true, got %v", i+1, resp["liked"])
		}
	}
}

func TestStoryHandler_Like_StoryNotFound_Returns404(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		likeFn: func(_ context.Context, _, _ uuid.UUID) (int, bool, error) {
			return 0, false, domain.ErrStoryNotFound
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/stories/"+storyID.String()+"/like", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Unlike tests
// ============================================================

func TestStoryHandler_Unlike_WasLiked_OK(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		unlikeFn: func(_ context.Context, _, _ uuid.UUID) (int, bool, error) {
			return 0, false, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/stories/"+storyID.String()+"/like", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["like_count"] != float64(0) {
		t.Errorf("expected like_count=0, got %v", resp["like_count"])
	}
	if resp["liked"] != false {
		t.Errorf("expected liked=false, got %v", resp["liked"])
	}
}

func TestStoryHandler_Unlike_NotLiked_NoOp(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		unlikeFn: func(_ context.Context, _, _ uuid.UUID) (int, bool, error) {
			return 5, false, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/stories/"+storyID.String()+"/like", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["like_count"] != float64(5) {
		t.Errorf("expected like_count=5 (unchanged), got %v", resp["like_count"])
	}
	if resp["liked"] != false {
		t.Errorf("expected liked=false, got %v", resp["liked"])
	}
}

func TestStoryHandler_Unlike_StoryNotFound_Returns404(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		unlikeFn: func(_ context.Context, _, _ uuid.UUID) (int, bool, error) {
			return 0, false, domain.ErrStoryNotFound
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/stories/"+storyID.String()+"/like", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// liked_by_me enrichment tests
// ============================================================

func TestStoryHandler_List_EnrichesLikedByMe(t *testing.T) {
	callerID := uuid.New()
	likedStoryID := uuid.New()
	notLikedStoryID := uuid.New()

	stories := []domain.SuccessStory{
		{ID: likedStoryID, Body: "Liked story"},
		{ID: notLikedStoryID, Body: "Not liked story"},
	}

	svc := &mockSuccessStoryService{
		listFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.SuccessStory, error) {
			return stories, nil
		},
		likedStoryIDsFn: func(_ context.Context, _ uuid.UUID, _ []uuid.UUID) (map[uuid.UUID]bool, error) {
			return map[uuid.UUID]bool{likedStoryID: true}, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/stories", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []dto.StoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp) != 2 {
		t.Fatalf("expected 2 stories, got %d", len(resp))
	}
	for _, s := range resp {
		switch s.ID {
		case likedStoryID:
			if !s.LikedByMe {
				t.Error("expected liked_by_me=true for likedStoryID")
			}
		case notLikedStoryID:
			if s.LikedByMe {
				t.Error("expected liked_by_me=false for notLikedStoryID")
			}
		}
	}
}

func TestStoryHandler_GetByID_EnrichesLikedByMe(t *testing.T) {
	callerID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: id, Body: "Story"}, nil
		},
		likedStoryIDsFn: func(_ context.Context, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
			return map[uuid.UUID]bool{ids[0]: true}, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/stories/"+storyID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.StoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp.LikedByMe {
		t.Error("expected liked_by_me=true")
	}
}

func TestStoryHandler_GetByPetID_EnrichesLikedByMe(t *testing.T) {
	callerID := uuid.New()
	petID := uuid.New()
	storyID := uuid.New()

	svc := &mockSuccessStoryService{
		getByPetIDFn: func(_ context.Context, pid uuid.UUID) (*domain.SuccessStory, error) {
			return &domain.SuccessStory{ID: storyID, PetID: pid, Body: "Story"}, nil
		},
		likedStoryIDsFn: func(_ context.Context, _ uuid.UUID, _ []uuid.UUID) (map[uuid.UUID]bool, error) {
			return map[uuid.UUID]bool{}, nil
		},
	}
	h := handler.NewSuccessStoryHandler(svc)
	r := setupStoryRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/stories/pet/"+petID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.StoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.LikedByMe {
		t.Error("expected liked_by_me=false")
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
