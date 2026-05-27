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
// Mock: GroupService
// ============================================================

type mockGroupService struct {
	createGroupFn func(ctx context.Context, creatorID uuid.UUID, req dto.CreateGroupRequest) (*domain.LocalGroup, error)
	getByIDFn     func(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error)
	listFn        func(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error)
	joinFn        func(ctx context.Context, groupID, userID uuid.UUID) error
	leaveFn       func(ctx context.Context, groupID, userID uuid.UUID) error
	getMembersFn  func(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error)
}

func (m *mockGroupService) CreateGroup(ctx context.Context, creatorID uuid.UUID, req dto.CreateGroupRequest) (*domain.LocalGroup, error) {
	if m.createGroupFn != nil {
		return m.createGroupFn(ctx, creatorID, req)
	}
	return &domain.LocalGroup{ID: uuid.New(), City: req.City, Name: req.Name}, nil
}

func (m *mockGroupService) GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.LocalGroup{ID: id}, nil
}

func (m *mockGroupService) List(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error) {
	if m.listFn != nil {
		return m.listFn(ctx, city, limit, offset)
	}
	return []domain.LocalGroup{}, nil
}

func (m *mockGroupService) Join(ctx context.Context, groupID, userID uuid.UUID) error {
	if m.joinFn != nil {
		return m.joinFn(ctx, groupID, userID)
	}
	return nil
}

func (m *mockGroupService) Leave(ctx context.Context, groupID, userID uuid.UUID) error {
	if m.leaveFn != nil {
		return m.leaveFn(ctx, groupID, userID)
	}
	return nil
}

func (m *mockGroupService) GetMembers(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error) {
	if m.getMembersFn != nil {
		return m.getMembersFn(ctx, groupID, limit, offset)
	}
	return []domain.GroupMember{}, nil
}

// Ensure interface compliance at compile time.
var _ service.GroupService = (*mockGroupService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupGroupRouter(h *handler.GroupHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/groups", h.List)
	r.GET("/api/groups/:id", h.GetByID)
	r.POST("/api/groups", injectUserID(callerID), h.Create)
	r.POST("/api/groups/:id/join", injectUserID(callerID), h.Join)
	r.DELETE("/api/groups/:id/leave", injectUserID(callerID), h.Leave)
	r.GET("/api/groups/:id/members", h.GetMembers)
	return r
}

// ============================================================
// List tests
// ============================================================

func TestGroupHandler_List_OK(t *testing.T) {
	groups := []domain.LocalGroup{
		{ID: uuid.New(), City: "Montevideo", Name: "Grupo Mvd"},
		{ID: uuid.New(), City: "Buenos Aires", Name: "Grupo BA"},
	}

	svc := &mockGroupService{
		listFn: func(_ context.Context, city string, _, _ int) ([]domain.LocalGroup, error) {
			return groups, nil
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/groups", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []dto.GroupResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 groups, got %d", len(resp))
	}
}

// ============================================================
// GetByID tests
// ============================================================

func TestGroupHandler_GetByID_Found(t *testing.T) {
	groupID := uuid.New()

	svc := &mockGroupService{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
			return &domain.LocalGroup{ID: id, City: "Montevideo", Name: "Grupo Mvd"}, nil
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/groups/"+groupID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGroupHandler_GetByID_NotFound(t *testing.T) {
	svc := &mockGroupService{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.LocalGroup, error) {
			return nil, domain.ErrGroupNotFound
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/groups/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Create tests
// ============================================================

func TestGroupHandler_Create_OK(t *testing.T) {
	adminID := uuid.New()

	svc := &mockGroupService{
		createGroupFn: func(_ context.Context, creatorID uuid.UUID, req dto.CreateGroupRequest) (*domain.LocalGroup, error) {
			return &domain.LocalGroup{ID: uuid.New(), City: req.City, Name: req.Name}, nil
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, adminID)

	body, _ := json.Marshal(map[string]interface{}{
		"city": "Montevideo",
		"name": "Grupo Mvd",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGroupHandler_Create_NoAuth(t *testing.T) {
	// Without injectUserID, missing required fields should return 400
	svc := &mockGroupService{}
	h := handler.NewGroupHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/groups", h.Create) // no auth middleware

	req := httptest.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing required fields, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGroupHandler_Create_DuplicateCity(t *testing.T) {
	adminID := uuid.New()

	svc := &mockGroupService{
		createGroupFn: func(_ context.Context, _ uuid.UUID, _ dto.CreateGroupRequest) (*domain.LocalGroup, error) {
			return nil, domain.ErrCityGroupExists
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, adminID)

	body, _ := json.Marshal(map[string]interface{}{
		"city": "Montevideo",
		"name": "Otro grupo Mvd",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/groups", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409 for duplicate city, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Join tests
// ============================================================

func TestGroupHandler_Join_OK(t *testing.T) {
	callerID := uuid.New()
	groupID := uuid.New()

	svc := &mockGroupService{
		joinFn: func(_ context.Context, gID, uID uuid.UUID) error {
			return nil
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/groups/"+groupID.String()+"/join", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201 on join, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGroupHandler_Join_AlreadyMember_IsIdempotent(t *testing.T) {
	callerID := uuid.New()
	groupID := uuid.New()

	svc := &mockGroupService{
		joinFn: func(_ context.Context, _, _ uuid.UUID) error {
			return domain.ErrAlreadyMember
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/groups/"+groupID.String()+"/join", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Handler returns 200 for already-member (idempotent per handler code)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for already-member (idempotent), got %d: %s", w.Code, w.Body.String())
	}
}

func TestGroupHandler_Join_NoAuth(t *testing.T) {
	// Without injectUserID, invalid UUID should still return 400
	svc := &mockGroupService{}
	h := handler.NewGroupHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/groups/:id/join", h.Join) // no auth middleware

	req := httptest.NewRequest(http.MethodPost, "/api/groups/not-a-uuid/join", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid UUID, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Leave tests
// ============================================================

func TestGroupHandler_Leave_OK(t *testing.T) {
	callerID := uuid.New()
	groupID := uuid.New()

	svc := &mockGroupService{
		leaveFn: func(_ context.Context, _, _ uuid.UUID) error {
			return nil
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/groups/"+groupID.String()+"/leave", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 on leave, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGroupHandler_Leave_NotMember_Returns404(t *testing.T) {
	callerID := uuid.New()
	groupID := uuid.New()

	svc := &mockGroupService{
		leaveFn: func(_ context.Context, _, _ uuid.UUID) error {
			return domain.ErrNotMember
		},
	}
	h := handler.NewGroupHandler(svc)
	r := setupGroupRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/groups/"+groupID.String()+"/leave", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 when not a member, got %d: %s", w.Code, w.Body.String())
	}
}
