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
	"lost-pets/internal/event"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

// ============================================================
// Mock: LocationAlertService
// ============================================================

type mockLocationAlertService struct {
	createAlertFn func(ctx context.Context, userID uuid.UUID, req dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error)
	getAlertsFn   func(ctx context.Context, userID uuid.UUID) ([]dto.LocationAlertResponse, error)
	getAlertFn    func(ctx context.Context, userID, alertID uuid.UUID) (*dto.LocationAlertResponse, error)
	updateAlertFn func(ctx context.Context, userID, alertID uuid.UUID, req dto.UpdateLocationAlertRequest) (*dto.LocationAlertResponse, error)
	deleteAlertFn func(ctx context.Context, userID, alertID uuid.UUID) error
}

func (m *mockLocationAlertService) RegisterListeners(bus *event.EventBus) {}

func (m *mockLocationAlertService) CreateAlert(ctx context.Context, userID uuid.UUID, req dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error) {
	if m.createAlertFn != nil {
		return m.createAlertFn(ctx, userID, req)
	}
	return &dto.LocationAlertResponse{ID: uuid.New(), UserID: userID}, nil
}

func (m *mockLocationAlertService) GetAlerts(ctx context.Context, userID uuid.UUID) ([]dto.LocationAlertResponse, error) {
	if m.getAlertsFn != nil {
		return m.getAlertsFn(ctx, userID)
	}
	return []dto.LocationAlertResponse{}, nil
}

func (m *mockLocationAlertService) GetAlert(ctx context.Context, userID, alertID uuid.UUID) (*dto.LocationAlertResponse, error) {
	if m.getAlertFn != nil {
		return m.getAlertFn(ctx, userID, alertID)
	}
	return &dto.LocationAlertResponse{ID: alertID, UserID: userID}, nil
}

func (m *mockLocationAlertService) UpdateAlert(ctx context.Context, userID, alertID uuid.UUID, req dto.UpdateLocationAlertRequest) (*dto.LocationAlertResponse, error) {
	if m.updateAlertFn != nil {
		return m.updateAlertFn(ctx, userID, alertID, req)
	}
	return &dto.LocationAlertResponse{ID: alertID, UserID: userID}, nil
}

func (m *mockLocationAlertService) DeleteAlert(ctx context.Context, userID, alertID uuid.UUID) error {
	if m.deleteAlertFn != nil {
		return m.deleteAlertFn(ctx, userID, alertID)
	}
	return nil
}

// Ensure interface compliance at compile time.
var _ service.LocationAlertService = (*mockLocationAlertService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupLocationAlertRouter(h *handler.LocationAlertHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/alerts", injectUserID(callerID), h.CreateAlert)
	r.GET("/api/alerts", injectUserID(callerID), h.GetAlerts)
	r.GET("/api/alerts/:id", injectUserID(callerID), h.GetAlert)
	r.PUT("/api/alerts/:id", injectUserID(callerID), h.UpdateAlert)
	r.DELETE("/api/alerts/:id", injectUserID(callerID), h.DeleteAlert)
	return r
}

// ============================================================
// CreateAlert tests
// ============================================================

func TestLocationAlertHandler_Create_OK(t *testing.T) {
	callerID := uuid.New()

	svc := &mockLocationAlertService{
		createAlertFn: func(_ context.Context, userID uuid.UUID, _ dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error) {
			return &dto.LocationAlertResponse{ID: uuid.New(), UserID: userID, RadiusKm: 5}, nil
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	body, _ := json.Marshal(map[string]interface{}{
		"latitude":  -34.9011,
		"longitude": -56.1645,
		"radius_km": 5,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/alerts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLocationAlertHandler_Create_NoAuth(t *testing.T) {
	// Without injectUserID, getUserUUID returns uuid.Nil.
	// The handler still proceeds — auth is enforced by the JWT middleware in production.
	// We test that invalid body still returns 400.
	svc := &mockLocationAlertService{}
	h := handler.NewLocationAlertHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/alerts", h.CreateAlert) // no auth middleware

	// Send empty body — binding:"required" on latitude/longitude should fail
	req := httptest.NewRequest(http.MethodPost, "/api/alerts", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// latitude and longitude have binding:"required" so this should be 400
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty body, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLocationAlertHandler_Create_LimitExceeded(t *testing.T) {
	callerID := uuid.New()

	svc := &mockLocationAlertService{
		createAlertFn: func(_ context.Context, _ uuid.UUID, _ dto.CreateLocationAlertRequest) (*dto.LocationAlertResponse, error) {
			return nil, domain.ErrAlertLimitExceeded
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	body, _ := json.Marshal(map[string]interface{}{
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/alerts", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 when limit exceeded, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// GetAlerts (List) tests
// ============================================================

func TestLocationAlertHandler_List_OK(t *testing.T) {
	callerID := uuid.New()

	svc := &mockLocationAlertService{
		getAlertsFn: func(_ context.Context, userID uuid.UUID) ([]dto.LocationAlertResponse, error) {
			return []dto.LocationAlertResponse{
				{ID: uuid.New(), UserID: userID, RadiusKm: 5},
				{ID: uuid.New(), UserID: userID, RadiusKm: 10},
			}, nil
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/alerts", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// GetAlert (by ID) tests
// ============================================================

func TestLocationAlertHandler_GetByID_Found(t *testing.T) {
	callerID := uuid.New()
	alertID := uuid.New()

	svc := &mockLocationAlertService{
		getAlertFn: func(_ context.Context, userID, aID uuid.UUID) (*dto.LocationAlertResponse, error) {
			return &dto.LocationAlertResponse{ID: aID, UserID: userID}, nil
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/alerts/"+alertID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLocationAlertHandler_GetByID_NotFound(t *testing.T) {
	callerID := uuid.New()
	alertID := uuid.New()

	svc := &mockLocationAlertService{
		getAlertFn: func(_ context.Context, _ uuid.UUID, _ uuid.UUID) (*dto.LocationAlertResponse, error) {
			return nil, domain.ErrAlertNotFound
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/alerts/"+alertID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLocationAlertHandler_GetByID_InvalidUUID(t *testing.T) {
	callerID := uuid.New()

	svc := &mockLocationAlertService{}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/alerts/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid UUID, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// DeleteAlert tests
// ============================================================

func TestLocationAlertHandler_Delete_OK(t *testing.T) {
	callerID := uuid.New()
	alertID := uuid.New()
	var deletedID uuid.UUID

	svc := &mockLocationAlertService{
		deleteAlertFn: func(_ context.Context, _ uuid.UUID, aID uuid.UUID) error {
			deletedID = aID
			return nil
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/alerts/"+alertID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
	if deletedID != alertID {
		t.Errorf("expected alertID %s passed to service, got %s", alertID, deletedID)
	}
}

func TestLocationAlertHandler_Delete_NotFound(t *testing.T) {
	callerID := uuid.New()
	alertID := uuid.New()

	svc := &mockLocationAlertService{
		deleteAlertFn: func(_ context.Context, _ uuid.UUID, _ uuid.UUID) error {
			return domain.ErrAlertNotFound
		},
	}
	h := handler.NewLocationAlertHandler(svc)
	r := setupLocationAlertRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/alerts/"+alertID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
