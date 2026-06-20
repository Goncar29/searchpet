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

type stubVetService struct {
	result []domain.VetNearbyResult
	called bool
}

func (s *stubVetService) FindNearby(_ context.Context, _, _ float64, _ int) ([]domain.VetNearbyResult, error) {
	s.called = true
	return s.result, nil
}

func setupVetRouter(svc *stubVetService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewVetHandler(svc)
	r.GET("/api/vets/nearby", h.GetNearby)
	return r
}

func TestVetHandler_GetNearby_HappyPath(t *testing.T) {
	svc := &stubVetService{result: []domain.VetNearbyResult{
		{Vet: domain.Vet{ID: uuid.New(), Name: "Puntovet"}, DistanceMeters: 123.4},
	}}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby?lat=-34.9&lng=-56.1&radius=5000", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	var body []dto.VetResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad body: %v", err)
	}
	if len(body) != 1 || body[0].Name != "Puntovet" || body[0].DistanceMeters != 123.4 {
		t.Errorf("unexpected body: %+v", body)
	}
}

func TestVetHandler_GetNearby_InvalidCoords(t *testing.T) {
	svc := &stubVetService{}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby?lat=999&lng=-56.1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid coords, got %d", w.Code)
	}
	if svc.called {
		t.Error("service should not be called on invalid coords")
	}
}

func TestVetHandler_GetNearby_MissingParams(t *testing.T) {
	svc := &stubVetService{}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing lat/lng, got %d", w.Code)
	}
}

func TestVetHandler_GetNearby_NonNumericRadius(t *testing.T) {
	svc := &stubVetService{}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby?lat=-34.9&lng=-56.1&radius=abc", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-numeric radius, got %d", w.Code)
	}
	if svc.called {
		t.Error("service should not be called on non-numeric radius")
	}
}

func TestVetHandler_GetNearby_NonPositiveRadius(t *testing.T) {
	svc := &stubVetService{}
	r := setupVetRouter(svc)

	req := httptest.NewRequest(http.MethodGet, "/api/vets/nearby?lat=-34.9&lng=-56.1&radius=-5", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for non-positive radius, got %d", w.Code)
	}
	if svc.called {
		t.Error("service should not be called on non-positive radius")
	}
}
