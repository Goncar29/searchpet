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
// Mock: VerificationService
// ============================================================

type mockVerificationService struct {
	sendOTPFn    func(ctx context.Context, userID uuid.UUID, channel string) error
	confirmOTPFn func(ctx context.Context, userID uuid.UUID, channel, code string) error
	getStatusFn  func(ctx context.Context, userID uuid.UUID) (*dto.VerificationStatusResponse, error)
}

func (m *mockVerificationService) SendOTP(ctx context.Context, userID uuid.UUID, channel string) error {
	if m.sendOTPFn != nil {
		return m.sendOTPFn(ctx, userID, channel)
	}
	return nil
}

func (m *mockVerificationService) ConfirmOTP(ctx context.Context, userID uuid.UUID, channel, code string) error {
	if m.confirmOTPFn != nil {
		return m.confirmOTPFn(ctx, userID, channel, code)
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
	auth.POST("/confirm-email", h.ConfirmEmail)
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
		{http.MethodPost, "/api/verification/confirm-email"},
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
		sendOTPFn: func(_ context.Context, _ uuid.UUID, channel string) error {
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

// Los TRES limites de envio responden 429, pero con codigos distintos: "espera un
// minuto", "terminaste por hoy" y "la plataforma se quedo sin presupuesto" son
// situaciones distintas para el usuario. Colapsarlas seria el mismo error que el
// mensaje generico que este test viene a cerrar.
//
// El cooldown devolvia gin.H{"error":..., "retry_after":...}: sin `code`,
// getErrorMessage caia en errors:unknown_error y el usuario leia un fallo
// generico en vez de "espera unos segundos" (regla #11).
func TestVerificationHandler_SendEmail_Limites429_UsanCodeMessage(t *testing.T) {
	tests := []struct {
		name           string
		err            error
		wantCode       string
		wantRetryAfter string
	}{
		{
			name:           "cooldown de 60s",
			err:            &service.ErrRateLimitOTP{RetryAfter: 45},
			wantCode:       "otp_cooldown",
			wantRetryAfter: "45",
		},
		{
			name:           "tope diario por cuenta",
			err:            &service.ErrOTPDailyLimit{RetryAfter: 3600},
			wantCode:       "otp_daily_limit",
			wantRetryAfter: "3600",
		},
		{
			name:     "reserva del canal agotada",
			err:      domain.ErrOTPChannelUnavailable,
			wantCode: "otp_channel_unavailable",
			// Sin Retry-After a proposito: cuando se libera depende de otros
			// usuarios, asi que cualquier numero seria una adivinanza.
			wantRetryAfter: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			callerID := uuid.New()
			svc := &mockVerificationService{
				sendOTPFn: func(_ context.Context, _ uuid.UUID, _ string) error {
					return tc.err
				},
			}
			h := handler.NewVerificationHandler(svc, true)
			r := setupVerificationRouter(h, callerID)

			req := httptest.NewRequest(http.MethodPost, "/api/verification/send-email", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429 (body %s)", w.Code, w.Body.String())
			}

			var body dto.ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("body no es JSON: %v (%s)", err, w.Body.String())
			}
			if body.Code != tc.wantCode {
				t.Fatalf("code = %q, want %q — regla #11: {code,message}, nunca {error}", body.Code, tc.wantCode)
			}
			if body.Message == "" {
				t.Fatal("message vacio")
			}
			if got := w.Header().Get("Retry-After"); got != tc.wantRetryAfter {
				t.Fatalf("Retry-After = %q, want %q", got, tc.wantRetryAfter)
			}
		})
	}
}


func TestVerificationHandler_SendEmail_ExternalError_Returns502(t *testing.T) {
	callerID := uuid.New()

	svc := &mockVerificationService{
		sendOTPFn: func(_ context.Context, _ uuid.UUID, _ string) error {
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
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _ string) error {
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
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _ string) error {
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
		confirmOTPFn: func(_ context.Context, _ uuid.UUID, _, _ string) error {
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




