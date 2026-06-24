package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
// Mock: ReportService
// ============================================================

type mockReportService struct {
	createReportFn    func(reporterID string, req service.CreateReportRequest) (*domain.Report, error)
	getReportByIDFn   func(id string) (*domain.Report, error)
	getReportsByPetFn func(petID string) ([]domain.Report, error)
	getNearbyFn       func(lat, lng, radius float64) ([]domain.Report, error)
	verifyReportFn    func(ctx context.Context, reportID, adminID uuid.UUID) error
	deleteFn          func(ctx context.Context, id uuid.UUID) error
}

func (m *mockReportService) CreateReport(reporterID string, req service.CreateReportRequest) (*domain.Report, error) {
	if m.createReportFn != nil {
		return m.createReportFn(reporterID, req)
	}
	return nil, nil
}

func (m *mockReportService) GetReportByID(id string) (*domain.Report, error) {
	if m.getReportByIDFn != nil {
		return m.getReportByIDFn(id)
	}
	return nil, domain.ErrReportNotFound
}

func (m *mockReportService) GetReportsByPet(petID string) ([]domain.Report, error) {
	if m.getReportsByPetFn != nil {
		return m.getReportsByPetFn(petID)
	}
	return nil, nil
}

func (m *mockReportService) GetNearbyReports(lat, lng, radiusMeters float64) ([]domain.Report, error) {
	if m.getNearbyFn != nil {
		return m.getNearbyFn(lat, lng, radiusMeters)
	}
	return nil, nil
}

func (m *mockReportService) VerifyReport(ctx context.Context, reportID, adminID uuid.UUID) error {
	if m.verifyReportFn != nil {
		return m.verifyReportFn(ctx, reportID, adminID)
	}
	return nil
}

func (m *mockReportService) Delete(ctx context.Context, id uuid.UUID) error {
	if m.deleteFn != nil {
		return m.deleteFn(ctx, id)
	}
	return nil
}

// Compile-time guard: the mock must stay in sync with the ReportService interface.
var _ service.ReportService = (*mockReportService)(nil)

// ============================================================
// Router helpers
// ============================================================

// setupReportRouter builds a test router for the ReportHandler.
// reporterID is injected as the authenticated user.
// Pass uuid.Nil to omit the auth middleware (for public routes).
func setupReportRouter(h *handler.ReportHandler, reporterID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Auth-protected routes
	auth := r.Group("/api/reports")
	auth.Use(injectUserID(reporterID))
	auth.POST("", h.CreateReport)

	// Public routes (no auth required)
	r.GET("/api/reports/nearby", h.GetNearbyReports)
	r.GET("/api/reports/pet/:petId", h.GetReportsByPet)
	r.GET("/api/reports/:id", h.GetReport)

	return r
}

// ============================================================
// Test data helpers
// ============================================================

func newTestReport(reporterID, petID uuid.UUID) *domain.Report {
	return &domain.Report{
		ID:         uuid.New(),
		PetID:      petID,
		ReporterID: reporterID,
		Status:     "sighting",
		Latitude:   -34.9011,
		Longitude:  -56.1645,
		CreatedAt:  time.Now(),
	}
}

// ============================================================
// POST /api/reports
// ============================================================

func TestReportHandler_CreateReport(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()

	validBody := map[string]interface{}{
		"pet_id":    petID.String(),
		"status":    "sighting",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	}

	tests := []struct {
		name       string
		body       map[string]interface{}
		setupMock  func(*mockReportService)
		wantStatus int
	}{
		{
			name: "valid body with auth returns 201",
			body: validBody,
			setupMock: func(m *mockReportService) {
				m.createReportFn = func(_ string, req service.CreateReportRequest) (*domain.Report, error) {
					return newTestReport(reporterID, petID), nil
				}
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "missing pet_id returns 400",
			body: map[string]interface{}{
				"status":    "sighting",
				"latitude":  -34.9011,
				"longitude": -56.1645,
			},
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing status returns 400",
			body: map[string]interface{}{
				"pet_id":    petID.String(),
				"latitude":  -34.9011,
				"longitude": -56.1645,
			},
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid status returns 400 (service rejects)",
			body: map[string]interface{}{
				"pet_id":    petID.String(),
				"status":    "invalid-status",
				"latitude":  -34.9011,
				"longitude": -56.1645,
			},
			setupMock: func(m *mockReportService) {
				m.createReportFn = func(_ string, _ service.CreateReportRequest) (*domain.Report, error) {
					return nil, domain.ErrInvalidStatus
				}
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid input returns 400 (service rejects)",
			body: map[string]interface{}{
				"pet_id":    "not-a-uuid",
				"status":    "sighting",
				"latitude":  -34.9011,
				"longitude": -56.1645,
			},
			setupMock: func(m *mockReportService) {
				m.createReportFn = func(_ string, _ service.CreateReportRequest) (*domain.Report, error) {
					return nil, domain.ErrInvalidInput
				}
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "internal error returns 500",
			body: validBody,
			setupMock: func(m *mockReportService) {
				m.createReportFn = func(_ string, _ service.CreateReportRequest) (*domain.Report, error) {
					return nil, domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockReportService{}
			tc.setupMock(svc)
			r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/api/reports", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestReportHandler_CreateReport_ResponseShape verifies the 201 response shape.
func TestReportHandler_CreateReport_ResponseShape(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()
	expectedReport := newTestReport(reporterID, petID)

	svc := &mockReportService{
		createReportFn: func(_ string, _ service.CreateReportRequest) (*domain.Report, error) {
			return expectedReport, nil
		},
	}
	r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

	body, _ := json.Marshal(map[string]interface{}{
		"pet_id":    petID.String(),
		"status":    "sighting",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/reports", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.ReportResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ID != expectedReport.ID {
		t.Errorf("want report ID %s, got %s", expectedReport.ID, resp.ID)
	}
	if resp.Status != "sighting" {
		t.Errorf("want status 'sighting', got %q", resp.Status)
	}
}

// ============================================================
// GET /api/reports/nearby
// ============================================================

func TestReportHandler_GetNearbyReports(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()

	tests := []struct {
		name       string
		query      string
		setupMock  func(*mockReportService)
		wantStatus int
	}{
		{
			name:  "valid lat/lng/radius returns 200",
			query: "?lat=-34.9011&lng=-56.1645&radius=5000",
			setupMock: func(m *mockReportService) {
				m.getNearbyFn = func(_, _, _ float64) ([]domain.Report, error) {
					return []domain.Report{*newTestReport(reporterID, petID)}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name:  "valid lat/lng without radius uses default",
			query: "?lat=-34.9011&lng=-56.1645",
			setupMock: func(m *mockReportService) {
				m.getNearbyFn = func(_, _, _ float64) ([]domain.Report, error) {
					return []domain.Report{}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "missing lat returns 400",
			query:      "?lng=-56.1645&radius=5000",
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing lng returns 400",
			query:      "?lat=-34.9011&radius=5000",
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid lat returns 400",
			query:      "?lat=not-a-number&lng=-56.1645",
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "radius out of range returns 422",
			query:      "?lat=-34.9011&lng=-56.1645&radius=999",
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:       "radius too large returns 422",
			query:      "?lat=-34.9011&lng=-56.1645&radius=99999",
			setupMock:  func(m *mockReportService) {},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name:  "internal error returns 500",
			query: "?lat=-34.9011&lng=-56.1645",
			setupMock: func(m *mockReportService) {
				m.getNearbyFn = func(_, _, _ float64) ([]domain.Report, error) {
					return nil, domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockReportService{}
			tc.setupMock(svc)
			r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

			req := httptest.NewRequest(http.MethodGet, "/api/reports/nearby"+tc.query, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestReportHandler_GetNearbyReports_ResponseShape verifies response includes data + radius_used.
func TestReportHandler_GetNearbyReports_ResponseShape(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()

	svc := &mockReportService{
		getNearbyFn: func(_, _, _ float64) ([]domain.Report, error) {
			return []domain.Report{*newTestReport(reporterID, petID)}, nil
		},
	}
	r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

	req := httptest.NewRequest(http.MethodGet, "/api/reports/nearby?lat=-34.9011&lng=-56.1645&radius=5000", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.NearbyReportsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Errorf("want 1 report, got %d", len(resp.Data))
	}
	if resp.RadiusUsed != 5000 {
		t.Errorf("want radius_used=5000, got %d", resp.RadiusUsed)
	}
}

// ============================================================
// GET /api/reports/pet/:petId
// ============================================================

func TestReportHandler_GetReportsByPet(t *testing.T) {
	reporterID := uuid.New()
	petID := uuid.New()

	tests := []struct {
		name       string
		petIDStr   string
		setupMock  func(*mockReportService)
		wantStatus int
		wantCount  int
	}{
		{
			name:     "returns reports for pet",
			petIDStr: petID.String(),
			setupMock: func(m *mockReportService) {
				m.getReportsByPetFn = func(_ string) ([]domain.Report, error) {
					return []domain.Report{
						*newTestReport(reporterID, petID),
						*newTestReport(reporterID, petID),
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			wantCount:  2,
		},
		{
			name:     "returns empty array when no reports",
			petIDStr: petID.String(),
			setupMock: func(m *mockReportService) {
				m.getReportsByPetFn = func(_ string) ([]domain.Report, error) {
					return []domain.Report{}, nil
				}
			},
			wantStatus: http.StatusOK,
			wantCount:  0,
		},
		{
			name:     "internal error returns 500",
			petIDStr: petID.String(),
			setupMock: func(m *mockReportService) {
				m.getReportsByPetFn = func(_ string) ([]domain.Report, error) {
					return nil, domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
			wantCount:  -1, // skip check
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockReportService{}
			tc.setupMock(svc)
			r := setupReportRouter(handler.NewReportHandler(svc, nil), reporterID)

			req := httptest.NewRequest(http.MethodGet, "/api/reports/pet/"+tc.petIDStr, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}

			if tc.wantCount >= 0 && w.Code == http.StatusOK {
				var resp []dto.ReportResponse
				if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if len(resp) != tc.wantCount {
					t.Errorf("want %d reports, got %d", tc.wantCount, len(resp))
				}
			}
		})
	}
}

// ============================================================
// DELETE /api/admin/reports/:id
// ============================================================

func TestReportHandler_DeleteReport_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockReportService{deleteFn: func(_ context.Context, _ uuid.UUID) error { return nil }}
	h := handler.NewReportHandler(svc, nil)

	r := gin.New()
	r.DELETE("/api/admin/reports/:id", h.DeleteReport)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/reports/"+uuid.New().String(), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "message") {
		t.Errorf("want a message body on success, got %s", w.Body.String())
	}
}

func TestReportHandler_DeleteReport_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockReportService{deleteFn: func(_ context.Context, _ uuid.UUID) error { return domain.ErrReportNotFound }}
	h := handler.NewReportHandler(svc, nil)

	r := gin.New()
	r.DELETE("/api/admin/reports/:id", h.DeleteReport)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/reports/"+uuid.New().String(), nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "report_not_found") {
		t.Errorf("want report_not_found code, got %s", w.Body.String())
	}
}

func TestReportHandler_DeleteReport_BadID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewReportHandler(&mockReportService{}, nil)

	r := gin.New()
	r.DELETE("/api/admin/reports/:id", h.DeleteReport)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/reports/not-a-uuid", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "invalid_input") {
		t.Errorf("want invalid_input code, got %s", w.Body.String())
	}
}
