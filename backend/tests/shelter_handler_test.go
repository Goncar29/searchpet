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
	"lost-pets/internal/handler"
)

// ============================================================
// Mock: ShelterService
// ============================================================

type mockShelterService struct {
	getAllFn          func(ctx context.Context, city string) ([]domain.Shelter, error)
	getByIDFn         func(ctx context.Context, id string) (*domain.Shelter, error)
	createFn          func(ctx context.Context, shelter *domain.Shelter) error
	updateFn          func(ctx context.Context, shelter *domain.Shelter) error
	registerOwnFn     func(ctx context.Context, userID string, shelter *domain.Shelter) error
	getMineFn         func(ctx context.Context, userID string) (*domain.Shelter, error)
	updateMineFn      func(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error)
	getPendingQueueFn func(ctx context.Context) ([]domain.Shelter, error)
	approveFn         func(ctx context.Context, id string) (*domain.Shelter, error)
	rejectFn          func(ctx context.Context, id string, reason string) (*domain.Shelter, error)
	approveLinksFn    func(ctx context.Context, id string) (*domain.Shelter, error)
	rejectLinksFn     func(ctx context.Context, id string) (*domain.Shelter, error)
}

func (m *mockShelterService) GetAll(ctx context.Context, city string) ([]domain.Shelter, error) {
	if m.getAllFn != nil {
		return m.getAllFn(ctx, city)
	}
	return []domain.Shelter{}, nil
}

func (m *mockShelterService) GetByID(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, nil
}

func (m *mockShelterService) Create(ctx context.Context, shelter *domain.Shelter) error {
	if m.createFn != nil {
		return m.createFn(ctx, shelter)
	}
	return nil
}

func (m *mockShelterService) Update(ctx context.Context, shelter *domain.Shelter) error {
	if m.updateFn != nil {
		return m.updateFn(ctx, shelter)
	}
	return nil
}

func (m *mockShelterService) RegisterOwn(ctx context.Context, userID string, shelter *domain.Shelter) error {
	if m.registerOwnFn != nil {
		return m.registerOwnFn(ctx, userID, shelter)
	}
	return nil
}

func (m *mockShelterService) GetMine(ctx context.Context, userID string) (*domain.Shelter, error) {
	if m.getMineFn != nil {
		return m.getMineFn(ctx, userID)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) UpdateMine(ctx context.Context, userID string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
	if m.updateMineFn != nil {
		return m.updateMineFn(ctx, userID, req)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) GetPendingQueue(ctx context.Context) ([]domain.Shelter, error) {
	if m.getPendingQueueFn != nil {
		return m.getPendingQueueFn(ctx)
	}
	return []domain.Shelter{}, nil
}

func (m *mockShelterService) Approve(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.approveFn != nil {
		return m.approveFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) Reject(ctx context.Context, id string, reason string) (*domain.Shelter, error) {
	if m.rejectFn != nil {
		return m.rejectFn(ctx, id, reason)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) ApproveLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.approveLinksFn != nil {
		return m.approveLinksFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}

func (m *mockShelterService) RejectLinks(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.rejectLinksFn != nil {
		return m.rejectLinksFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
}

// ============================================================
// Router setup
// ============================================================

func setupShelterRouter(h *handler.ShelterHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/shelters", h.GetAll)
	r.GET("/api/shelters/:id", h.GetByID)
	return r
}

// ============================================================
// GetAll tests
// ============================================================

func TestShelterHandler_GetAll_OK(t *testing.T) {
	shelters := []domain.Shelter{
		{ID: uuid.New(), Name: "Refugio Montevideo", City: "Montevideo", IsVerified: true},
		{ID: uuid.New(), Name: "Hogar Animal", City: "Buenos Aires"},
	}

	svc := &mockShelterService{
		getAllFn: func(_ context.Context, city string) ([]domain.Shelter, error) {
			return shelters, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []dto.ShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 shelters, got %d", len(resp))
	}
}

func TestShelterHandler_GetAll_EmptyList(t *testing.T) {
	svc := &mockShelterService{
		getAllFn: func(_ context.Context, _ string) ([]domain.Shelter, error) {
			return []domain.Shelter{}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for empty list, got %d", w.Code)
	}
}

func TestShelterHandler_GetAll_WithCityFilter(t *testing.T) {
	var capturedCity string
	svc := &mockShelterService{
		getAllFn: func(_ context.Context, city string) ([]domain.Shelter, error) {
			capturedCity = city
			return []domain.Shelter{
				{ID: uuid.New(), Name: "Refugio Mvd", City: "Montevideo"},
			}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters?city=Montevideo", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if capturedCity != "Montevideo" {
		t.Errorf("expected city='Montevideo' forwarded to service, got %q", capturedCity)
	}
}

// ============================================================
// GetByID tests
// ============================================================

func TestShelterHandler_GetByID_Found(t *testing.T) {
	shelterID := uuid.New()
	shelter := &domain.Shelter{
		ID:   shelterID,
		Name: "Refugio Montevideo",
		City: "Montevideo",
	}

	svc := &mockShelterService{
		getByIDFn: func(_ context.Context, id string) (*domain.Shelter, error) {
			return shelter, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters/"+shelterID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ID != shelterID {
		t.Errorf("expected shelter ID %s, got %s", shelterID, resp.ID)
	}
}

func TestShelterHandler_GetByID_NotFound(t *testing.T) {
	svc := &mockShelterService{
		getByIDFn: func(_ context.Context, id string) (*domain.Shelter, error) {
			return nil, domain.ErrShelterNotFound
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
