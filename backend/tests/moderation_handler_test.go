package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
	"lost-pets/internal/service"
)

type mockModerationService struct {
	banFn   func(ctx context.Context, id uuid.UUID, reason string) error
	unbanFn func(ctx context.Context, id uuid.UUID) error
}

func (m *mockModerationService) BanUser(ctx context.Context, id uuid.UUID, reason string) error {
	if m.banFn != nil {
		return m.banFn(ctx, id, reason)
	}
	return nil
}
func (m *mockModerationService) UnbanUser(ctx context.Context, id uuid.UUID) error {
	if m.unbanFn != nil {
		return m.unbanFn(ctx, id)
	}
	return nil
}

var _ service.ModerationService = (*mockModerationService)(nil)

func TestModerationHandler_BanUser_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var gotReason string
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, reason string) error {
		gotReason = reason
		return nil
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(`{"reason":"spam"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
	if gotReason != "spam" {
		t.Errorf("want reason 'spam', got %q", gotReason)
	}
}

func TestModerationHandler_BanUser_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, _ string) error {
		return domain.ErrUserNotFound
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "user_not_found") {
		t.Fatalf("want 404 user_not_found, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_BanUser_RejectsAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, _ string) error {
		return domain.ErrCannotModerateAdmin
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "cannot_moderate_admin") {
		t.Fatalf("want 400 cannot_moderate_admin, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_UnbanUser_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockModerationService{unbanFn: func(_ context.Context, _ uuid.UUID) error { return nil }}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/unban", h.UnbanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/unban", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_BanUser_BadID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewModerationHandler(&mockModerationService{})

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/not-a-uuid/ban",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}

func TestModerationHandler_BanUser_NoBody_Succeeds(t *testing.T) {
	// reason is optional, so a ban with no request body must succeed (empty reason).
	gin.SetMode(gin.TestMode)
	var gotReason = "unset"
	svc := &mockModerationService{banFn: func(_ context.Context, _ uuid.UUID, reason string) error {
		gotReason = reason
		return nil
	}}
	h := handler.NewModerationHandler(svc)

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200 for no-body ban, got %d (%s)", w.Code, w.Body.String())
	}
	if gotReason != "" {
		t.Errorf("want empty reason, got %q", gotReason)
	}
}

func TestModerationHandler_BanUser_TooLongReason_Returns400(t *testing.T) {
	// reason is capped at 500 chars; over-long input must be rejected as invalid_input.
	gin.SetMode(gin.TestMode)
	h := handler.NewModerationHandler(&mockModerationService{})

	r := gin.New()
	r.PATCH("/api/admin/users/:id/ban", h.BanUser)

	body := `{"reason":"` + strings.Repeat("a", 501) + `"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/"+uuid.New().String()+"/ban",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_input") {
		t.Fatalf("want 400 invalid_input, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestModerationHandler_UnbanUser_BadID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewModerationHandler(&mockModerationService{})

	r := gin.New()
	r.PATCH("/api/admin/users/:id/unban", h.UnbanUser)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/not-a-uuid/unban", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
}
