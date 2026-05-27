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
// Mock: AbuseReportService
// ============================================================

type mockAbuseReportService struct {
	submitFn   func(ctx context.Context, reporterID uuid.UUID, req dto.CreateAbuseReportRequest) (*domain.ReportAbuse, error)
	getByIDFn  func(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error)
	listFn     func(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error)
	resolveFn  func(ctx context.Context, id uuid.UUID, adminID uuid.UUID, status string) error
}

func (m *mockAbuseReportService) Submit(ctx context.Context, reporterID uuid.UUID, req dto.CreateAbuseReportRequest) (*domain.ReportAbuse, error) {
	if m.submitFn != nil {
		return m.submitFn(ctx, reporterID, req)
	}
	return &domain.ReportAbuse{ID: uuid.New(), ReporterID: reporterID}, nil
}

func (m *mockAbuseReportService) GetByID(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return &domain.ReportAbuse{ID: id}, nil
}

func (m *mockAbuseReportService) List(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error) {
	if m.listFn != nil {
		return m.listFn(ctx, resolved, limit, offset)
	}
	return []domain.ReportAbuse{}, nil
}

func (m *mockAbuseReportService) Resolve(ctx context.Context, id uuid.UUID, adminID uuid.UUID, status string) error {
	if m.resolveFn != nil {
		return m.resolveFn(ctx, id, adminID, status)
	}
	return nil
}

// Ensure interface compliance at compile time.
var _ service.AbuseReportService = (*mockAbuseReportService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupAbuseReportRouter(h *handler.AbuseReportHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/abuse-reports", injectUserID(callerID), h.Submit)
	r.GET("/api/abuse-reports", h.List) // admin-only in production; here we test the handler directly
	r.GET("/api/abuse-reports/:id", h.GetByID)
	r.PATCH("/api/abuse-reports/:id/resolve", injectUserID(callerID), h.Resolve)
	return r
}

// ============================================================
// Submit tests
// ============================================================

func TestAbuseReportHandler_Submit_OK(t *testing.T) {
	callerID := uuid.New()
	targetUserID := uuid.New()

	svc := &mockAbuseReportService{
		submitFn: func(_ context.Context, reporterID uuid.UUID, req dto.CreateAbuseReportRequest) (*domain.ReportAbuse, error) {
			return &domain.ReportAbuse{
				ID:           uuid.New(),
				ReporterID:   reporterID,
				TargetUserID: req.TargetUserID,
				Reason:       req.Reason,
			}, nil
		},
	}
	h := handler.NewAbuseReportHandler(svc)
	r := setupAbuseReportRouter(h, callerID)

	body, _ := json.Marshal(map[string]interface{}{
		"target_user_id": targetUserID.String(),
		"reason":         "Publicación fraudulenta",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/abuse-reports", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp dto.AbuseReportResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ReporterID != callerID {
		t.Errorf("expected reporterID %s, got %s", callerID, resp.ReporterID)
	}
}

func TestAbuseReportHandler_Submit_NoAuth(t *testing.T) {
	// Without injectUserID, reason binding:"required" missing should return 400
	svc := &mockAbuseReportService{}
	h := handler.NewAbuseReportHandler(svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/abuse-reports", h.Submit) // no auth middleware

	req := httptest.NewRequest(http.MethodPost, "/api/abuse-reports", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing reason, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// List tests
// ============================================================

func TestAbuseReportHandler_List_OK(t *testing.T) {
	reports := []domain.ReportAbuse{
		{ID: uuid.New(), Reason: "Fraude", Status: "pending"},
		{ID: uuid.New(), Reason: "Spam", Status: "resolved"},
	}

	svc := &mockAbuseReportService{
		listFn: func(_ context.Context, _ *bool, _, _ int) ([]domain.ReportAbuse, error) {
			return reports, nil
		},
	}
	h := handler.NewAbuseReportHandler(svc)
	r := setupAbuseReportRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/abuse-reports", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp []dto.AbuseReportResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp) != 2 {
		t.Errorf("expected 2 reports, got %d", len(resp))
	}
}

// ============================================================
// GetByID tests
// ============================================================

func TestAbuseReportHandler_GetByID_Found(t *testing.T) {
	reportID := uuid.New()

	svc := &mockAbuseReportService{
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
			return &domain.ReportAbuse{ID: id, Reason: "Test reason"}, nil
		},
	}
	h := handler.NewAbuseReportHandler(svc)
	r := setupAbuseReportRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/abuse-reports/"+reportID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAbuseReportHandler_GetByID_NotFound(t *testing.T) {
	svc := &mockAbuseReportService{
		getByIDFn: func(_ context.Context, _ uuid.UUID) (*domain.ReportAbuse, error) {
			return nil, domain.ErrAbuseReportNotFound
		},
	}
	h := handler.NewAbuseReportHandler(svc)
	r := setupAbuseReportRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/abuse-reports/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// Resolve tests
// ============================================================

func TestAbuseReportHandler_Resolve_OK(t *testing.T) {
	adminID := uuid.New()
	reportID := uuid.New()
	var resolvedByID uuid.UUID

	svc := &mockAbuseReportService{
		resolveFn: func(_ context.Context, id uuid.UUID, aID uuid.UUID, status string) error {
			resolvedByID = aID
			return nil
		},
	}
	h := handler.NewAbuseReportHandler(svc)
	r := setupAbuseReportRouter(h, adminID)

	body, _ := json.Marshal(map[string]interface{}{
		"status": "resolved",
	})
	req := httptest.NewRequest(http.MethodPatch, "/api/abuse-reports/"+reportID.String()+"/resolve", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if resolvedByID != adminID {
		t.Errorf("expected resolvedByID %s, got %s", adminID, resolvedByID)
	}
}

func TestAbuseReportHandler_Resolve_NotFound(t *testing.T) {
	adminID := uuid.New()

	svc := &mockAbuseReportService{
		resolveFn: func(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ string) error {
			return domain.ErrAbuseReportNotFound
		},
	}
	h := handler.NewAbuseReportHandler(svc)
	r := setupAbuseReportRouter(h, adminID)

	body, _ := json.Marshal(map[string]interface{}{
		"status": "resolved",
	})
	req := httptest.NewRequest(http.MethodPatch, "/api/abuse-reports/"+uuid.New().String()+"/resolve", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
