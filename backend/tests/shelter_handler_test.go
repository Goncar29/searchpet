package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	getAllFn           func(ctx context.Context, city string) ([]domain.Shelter, error)
	getByIDFn          func(ctx context.Context, id string) (*domain.Shelter, error)
	getByIDAnyStatusFn func(ctx context.Context, id string) (*domain.Shelter, error)
	createFn           func(ctx context.Context, shelter *domain.Shelter) error
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

func (m *mockShelterService) GetByIDAnyStatus(ctx context.Context, id string) (*domain.Shelter, error) {
	if m.getByIDAnyStatusFn != nil {
		return m.getByIDAnyStatusFn(ctx, id)
	}
	return nil, domain.ErrShelterNotFound
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

// setupOwnerShelterRouter registra las rutas owner+admin con un userID inyectado
// (imita middleware.Auth, igual que setupMessageRouter en message_handler_test.go).
func setupOwnerShelterRouter(h *handler.ShelterHandler, userID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("userID", userID)
		c.Next()
	})
	r.GET("/api/shelters", h.GetAll)
	r.POST("/api/shelters", h.RegisterOwn)
	r.GET("/api/shelters/mine", h.GetMine)
	r.PUT("/api/shelters/mine", h.UpdateMine)
	// Task 10: r.GET("/api/admin/shelters/pending", h.PendingQueue)
	// Task 10: r.POST("/api/admin/shelters/:id/approve", h.Approve)
	// Task 10: r.POST("/api/admin/shelters/:id/reject", h.Reject)
	// Task 10: r.POST("/api/admin/shelters/:id/links/approve", h.ApproveLinks)
	// Task 10: r.POST("/api/admin/shelters/:id/links/reject", h.RejectLinks)
	return r
}

func decodeErrorResponse(t *testing.T, w *httptest.ResponseRecorder) dto.ErrorResponse {
	t.Helper()
	var resp dto.ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode error response: %v — body: %s", err, w.Body.String())
	}
	return resp
}

// ============================================================
// RegisterOwn tests
// ============================================================

func TestShelterHandler_RegisterOwn_Returns201(t *testing.T) {
	callerID := uuid.New()
	var gotUserID string
	svc := &mockShelterService{
		registerOwnFn: func(_ context.Context, userID string, shelter *domain.Shelter) error {
			gotUserID = userID
			shelter.ID = uuid.New()
			shelter.Status = domain.ShelterStatusPending
			return nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, callerID)

	body := `{"name":"Mi Refugio","city":"Montevideo","donation_url":"https://mi.org/donar"}`
	req := httptest.NewRequest(http.MethodPost, "/api/shelters", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", w.Code, w.Body.String())
	}
	if gotUserID != callerID.String() {
		t.Errorf("service called with userID %q, want %q", gotUserID, callerID)
	}
	var resp dto.MyShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != domain.ShelterStatusPending {
		t.Errorf("response status: want pending, got %q", resp.Status)
	}
}

func TestShelterHandler_RegisterOwn_ErrorCodes(t *testing.T) {
	cases := []struct {
		name       string
		svcErr     error
		wantStatus int
		wantCode   string
	}{
		{"unverified email", domain.ErrEmailNotVerified, http.StatusForbidden, "email_not_verified"},
		{"already owned", domain.ErrShelterAlreadyOwned, http.StatusConflict, "shelter_already_owned"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockShelterService{
				registerOwnFn: func(_ context.Context, _ string, _ *domain.Shelter) error {
					return tc.svcErr
				},
			}
			h := handler.NewShelterHandler(svc)
			r := setupOwnerShelterRouter(h, uuid.New())

			body := `{"name":"Mi Refugio","city":"Montevideo"}`
			req := httptest.NewRequest(http.MethodPost, "/api/shelters", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("want %d, got %d — body: %s", tc.wantStatus, w.Code, w.Body.String())
			}
			if resp := decodeErrorResponse(t, w); resp.Code != tc.wantCode {
				t.Errorf("code: want %q, got %q", tc.wantCode, resp.Code)
			}
		})
	}
}

func TestShelterHandler_RegisterOwn_InvalidURL_Returns400(t *testing.T) {
	svc := &mockShelterService{}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, uuid.New())

	body := `{"name":"Mi Refugio","city":"Montevideo","donation_url":"http://sin-tls.org"}`
	req := httptest.NewRequest(http.MethodPost, "/api/shelters", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d — body: %s", w.Code, w.Body.String())
	}
	if resp := decodeErrorResponse(t, w); resp.Code != "invalid_input" {
		t.Errorf("code: want invalid_input, got %q", resp.Code)
	}
}

// ============================================================
// GetMine / UpdateMine tests
// ============================================================

func TestShelterHandler_GetMine(t *testing.T) {
	callerID := uuid.New()
	mine := &domain.Shelter{
		ID: uuid.New(), OwnerUserID: &callerID, Name: "Mi Refugio", City: "Montevideo",
		Status: domain.ShelterStatusRejected, RejectionReason: "link roto",
	}
	svc := &mockShelterService{
		getMineFn: func(_ context.Context, userID string) (*domain.Shelter, error) {
			if userID == callerID.String() {
				return mine, nil
			}
			return nil, domain.ErrShelterNotFound
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters/mine", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
	var resp dto.MyShelterResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.RejectionReason != "link roto" {
		t.Errorf("owner view must include rejection_reason, got %q", resp.RejectionReason)
	}
}

func TestShelterHandler_GetMine_NotFound(t *testing.T) {
	h := handler.NewShelterHandler(&mockShelterService{})
	r := setupOwnerShelterRouter(h, uuid.New())

	req := httptest.NewRequest(http.MethodGet, "/api/shelters/mine", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", w.Code)
	}
	if resp := decodeErrorResponse(t, w); resp.Code != "shelter_not_found" {
		t.Errorf("code: want shelter_not_found, got %q", resp.Code)
	}
}

func TestShelterHandler_UpdateMine_Returns200(t *testing.T) {
	callerID := uuid.New()
	svc := &mockShelterService{
		updateMineFn: func(_ context.Context, _ string, req *dto.UpdateMyShelterRequest) (*domain.Shelter, error) {
			return &domain.Shelter{
				ID: uuid.New(), Name: *req.Name, City: "Montevideo",
				Status: domain.ShelterStatusPending,
			}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupOwnerShelterRouter(h, callerID)

	body := `{"name":"Renombrado"}`
	req := httptest.NewRequest(http.MethodPut, "/api/shelters/mine", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// SECURITY: the public directory must not leak review fields
// ============================================================

func TestShelterHandler_GetAll_NeverLeaksReviewFields(t *testing.T) {
	ownerID := uuid.New()
	pendingURL := "https://staged.org/donar"
	svc := &mockShelterService{
		getAllFn: func(_ context.Context, _ string) ([]domain.Shelter, error) {
			return []domain.Shelter{{
				ID:                 uuid.New(),
				OwnerUserID:        &ownerID,
				Name:               "Refugio Público",
				City:               "Montevideo",
				Status:             domain.ShelterStatusApproved,
				RejectionReason:    "dato interno viejo",
				PendingDonationURL: &pendingURL,
			}}, nil
		},
	}
	h := handler.NewShelterHandler(svc)
	r := setupShelterRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/shelters", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	body := w.Body.String()
	for _, leaked := range []string{"owner_user_id", "rejection_reason", "pending_donation_url", "pending_website_url", "status"} {
		if strings.Contains(body, leaked) {
			t.Errorf("public GET /api/shelters leaks %q: %s", leaked, body)
		}
	}
}
