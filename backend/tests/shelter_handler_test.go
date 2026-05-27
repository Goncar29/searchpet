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
	getAllFn   func(ctx context.Context, city string) ([]domain.Shelter, error)
	getByIDFn func(ctx context.Context, id string) (*domain.Shelter, error)
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
