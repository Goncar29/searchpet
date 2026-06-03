package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
// Mock: VerificationService
// ============================================================

type mockVerificationService struct {
	sendOTPFn    func(ctx context.Context, userID uuid.UUID, channel, phone string) error
	confirmOTPFn func(ctx context.Context, userID uuid.UUID, channel, code, phone string) error
	getStatusFn  func(ctx context.Context, userID uuid.UUID) (*dto.VerificationStatusResponse, error)
}

func (m *mockVerificationService) SendOTP(ctx context.Context, userID uuid.UUID, channel, phone string) error {
	if m.sendOTPFn != nil {
		return m.sendOTPFn(ctx, userID, channel, phone)
	}
	return nil
}

func (m *mockVerificationService) ConfirmOTP(ctx context.Context, userID uuid.UUID, channel, code, phone string) error {
	if m.confirmOTPFn != nil {
		return m.confirmOTPFn(ctx, userID, channel, code, phone)
	}
	return nil
}

func (m *mockVerificationService) GetStatus(ctx context.Context, userID uuid.UUID) (*dto.VerificationStatusResponse, error) {
	if m.getStatusFn != nil {
		return m.getStatusFn(ctx, userID)
	}
	return &dto.VerificationStatusResponse{}, nil
}

// Ensure interface compliance at compile time.
var _ service.VerificationService = (*mockVerificationService)(nil)

// ============================================================
// Router setup
// ============================================================

func setupVerificationRouter(h *handler.VerificationHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	auth := r.Group("/api/verification", injectUserID(callerID))
	auth.POST("/send-email", h.SendEmail)
	auth.POST("/send-sms", h.SendSMS)
	auth.POST("/confirm-email", h.ConfirmEmail)
	auth.POST("/confirm-sms", h.ConfirmSMS)
	auth.GET("/status", h.GetStatus)
	return r
}

// ============================================================
// Feature disabled (featureEnabled = false) tests
// ============================================================

func TestVerificationHandler_FeatureDisabled_Returns501(t *testing.T) {
	callerID := uuid.New()
	svc := &mockVerificationService{}
	h := handler.NewVerificationHandler(svc, false)
	r := setupVerificationRouter(h, callerID)

	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/verification/send-email"},
		{http.MethodPost, "/api/verification/send-sms"},
		{http.MethodPost, "/api/verification/confirm-email"},
		{http.MethodPost, "/api/verification/confirm-sms"},
		{http.MethodGet, "/api/verification/status"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			req := httptest.NewRequest(ep.method, ep.path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusNotImplemented {
				t.Errorf("expected 501, got %d for %s %s", w.Code, ep.method, ep.path)
			}
		})
	}
}

// ============================================================
// SendEmail tests
// ============================================================

func TestVerificationHandler_SendEmail_OK(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		sendOTPFn: func(_ context.Context, _ uuid.UUID, channel, phone string) error {
			return nil
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/verification/send-email", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d", w.Code)
	}
}

func TestVerificationHandler_SendEmail_RateLimit_Returns429(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		sendOTPFn: func(_ context.Context, _ uuid.UUID, _, _ string) error {
			return &service.ErrRateLimitOTP{RetryAfter: 45}
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/verification/send-email", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", w.Code)
	}

	if w.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header to be set")
	}
}

func TestVerificationHandler_SendSMS_NoPhone_Returns422(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		sendOTPFn: func(_ context.Context, _ uuid.UUID, _, _ string) error {
			return &service.ErrNoPhoneOnFile{}
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	// Now SendSMS requires a phone in the body; omitting it returns 400 (binding failure).
	// To reach the service (and get 422), we must pass a phone.
	body, _ := json.Marshal(map[string]string{"phone": "+59812345678"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/send-sms", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", w.Code)
	}
}

func TestVerificationHandler_SendEmail_ExternalError_Returns502(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		sendOTPFn: func(_ context.Context, _ uuid.UUID, _, _ string) error {
			return &service.ErrExternalService{}
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/verification/send-email", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", w.Code)
	}
}

// ============================================================
// ConfirmEmail tests
// ============================================================

func TestVerificationHandler_ConfirmEmail_ValidCode_Returns200(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _, _ string) error {
			return nil
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	body, _ := json.Marshal(dto.ConfirmOTPRequest{Code: "123456"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-email", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestVerificationHandler_ConfirmEmail_InvalidCode_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _, _ string) error {
			return domain.ErrOTPInvalid
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	body, _ := json.Marshal(dto.ConfirmOTPRequest{Code: "000000"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-email", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid code, got %d", w.Code)
	}
}

func TestVerificationHandler_ConfirmEmail_ExpiredCode_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _, _ string) error {
			return domain.ErrOTPExpired
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	body, _ := json.Marshal(dto.ConfirmOTPRequest{Code: "123456"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-email", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for expired code, got %d", w.Code)
	}
}

func TestVerificationHandler_ConfirmEmail_MissingCode_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	// Send empty body — binding:"required" on Code should reject it.
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-email", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing code, got %d", w.Code)
	}
}

// ============================================================
// GetStatus tests
// ============================================================

func TestVerificationHandler_GetStatus_Returns200WithFields(t *testing.T) {
	callerID := uuid.New()

	expected := &dto.VerificationStatusResponse{
		EmailVerified: true,
		PhoneVerified: false,
		IsVerified:    false,
	}

	svc := &mockVerificationService{
		getStatusFn: func(_ context.Context, _ uuid.UUID) (*dto.VerificationStatusResponse, error) {
			return expected, nil
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/verification/status", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp dto.VerificationStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if !resp.EmailVerified {
		t.Error("expected email_verified=true")
	}
	if resp.PhoneVerified {
		t.Error("expected phone_verified=false")
	}
}

// ============================================================
// ConfirmSMS tests (phone atomicity — T07)
// ============================================================

// Missing phone field in SMS confirm → 400
func TestVerificationHandler_ConfirmSMS_MissingPhone_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	// Body has code but no phone field.
	body, _ := json.Marshal(map[string]string{"code": "123456"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-sms", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing phone, got %d", w.Code)
	}
}

// Successful SMS confirm with phone → 200
func TestVerificationHandler_ConfirmSMS_WithPhone_Returns200(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, channel, code, phone string) error {
			if channel != "sms" {
				return fmt.Errorf("unexpected channel: %s", channel)
			}
			if phone != "+59812345678" {
				return fmt.Errorf("unexpected phone: %s", phone)
			}
			return nil
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	body, _ := json.Marshal(dto.ConfirmOTPRequest{Code: "123456", Phone: "+59812345678"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-sms", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// Phone mismatch from service → 400 (not 500)
func TestVerificationHandler_ConfirmSMS_PhoneMismatch_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _, _ string) error {
			return domain.ErrPhoneMismatch
		},
	}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	body, _ := json.Marshal(dto.ConfirmOTPRequest{Code: "123456", Phone: "+59899999999"})
	req := httptest.NewRequest(http.MethodPost, "/api/verification/confirm-sms", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for phone mismatch, got %d: %s", w.Code, w.Body.String())
	}
}

// SendSMS without phone in body → 400 (binding required)
func TestVerificationHandler_SendSMS_MissingPhone_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{}
	h := handler.NewVerificationHandler(svc, true)
	r := setupVerificationRouter(h, callerID)

	// Empty body — binding:"required" on Phone should reject it.
	req := httptest.NewRequest(http.MethodPost, "/api/verification/send-sms", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing phone in send-sms, got %d", w.Code)
	}
}
