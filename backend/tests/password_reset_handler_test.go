package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
)

type stubResetSvc struct {
	requestErr    error
	confirmErr    error
	confirmCalled bool
}

func (s *stubResetSvc) RequestReset(context.Context, string) error { return s.requestErr }
func (s *stubResetSvc) ConfirmReset(context.Context, string, string, string) error {
	s.confirmCalled = true
	return s.confirmErr
}

func postJSON(t *testing.T, h gin.HandlerFunc, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST(path, h)

	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func codeOf(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal %s: %v", w.Body.String(), err)
	}
	return body.Code
}

func TestForgotPassword_IdenticalResponseForRealAndFakeAddress(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})

	real := postJSON(t, h.ForgotPassword, "/forgot", map[string]string{"email": "user@example.com"})
	fake := postJSON(t, h.ForgotPassword, "/forgot", map[string]string{"email": "ghost@example.com"})

	if real.Code != http.StatusOK || fake.Code != http.StatusOK {
		t.Fatalf("statuses = %d and %d, want 200 for both", real.Code, fake.Code)
	}
	if real.Body.String() != fake.Body.String() {
		t.Fatalf("bodies differ:\n real: %s\n fake: %s", real.Body.String(), fake.Body.String())
	}
}

func TestForgotPassword_MalformedEmailIs400(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})
	w := postJSON(t, h.ForgotPassword, "/forgot", map[string]string{"email": "not-an-email"})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestResetPassword_InvalidOTPIs400WithOtpInvalid(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{confirmErr: domain.ErrOTPInvalid})
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "000000", "new_password": "newpassword",
	})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if got := codeOf(t, w); got != "otp_invalid" {
		t.Fatalf("code = %q, want otp_invalid", got)
	}
}

func TestResetPassword_ShortPasswordIs400(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "123456", "new_password": "12345",
	})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

// TestResetPassword_LongPasswordIs400AndServiceNotCalled guards the max=72 bound
// (amendment to Task 9). bcrypt.GenerateFromPassword errors on inputs over 72
// bytes; without this bound a long passphrase would reach the service, map to
// domain.ErrInternal -> 500, and burn one of the user's five OTP attempts
// because IncrementAttempts already ran before the bcrypt call. The bound turns
// that into a 400 before any state is touched.
func TestResetPassword_LongPasswordIs400AndServiceNotCalled(t *testing.T) {
	svc := &stubResetSvc{}
	h := handler.NewPasswordResetHandler(svc)
	longPassword := strings.Repeat("a", 73)
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "123456", "new_password": longPassword,
	})

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if svc.confirmCalled {
		t.Fatal("ConfirmReset must not run for a >72-byte password — binding must reject it first")
	}
}

func TestResetPassword_HappyPathIs200(t *testing.T) {
	h := handler.NewPasswordResetHandler(&stubResetSvc{})
	w := postJSON(t, h.ResetPassword, "/reset", map[string]string{
		"email": "user@example.com", "code": "123456", "new_password": "newpassword",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}
