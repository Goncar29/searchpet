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
	"lost-pets/internal/handler"
	"lost-pets/internal/repository"
)

// ============================================================
// Mock: DeviceTokenRepository
// ============================================================

type mockDeviceTokenRepo struct {
	upsertFn       func(ctx context.Context, token *domain.DeviceToken) error
	findByUserIDFn func(ctx context.Context, userID uuid.UUID) ([]domain.DeviceToken, error)
	deleteByTokenFn func(ctx context.Context, token string) error
}

func (m *mockDeviceTokenRepo) Upsert(ctx context.Context, token *domain.DeviceToken) error {
	if m.upsertFn != nil {
		return m.upsertFn(ctx, token)
	}
	return nil
}

func (m *mockDeviceTokenRepo) FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.DeviceToken, error) {
	if m.findByUserIDFn != nil {
		return m.findByUserIDFn(ctx, userID)
	}
	return []domain.DeviceToken{}, nil
}

func (m *mockDeviceTokenRepo) DeleteByToken(ctx context.Context, token string) error {
	if m.deleteByTokenFn != nil {
		return m.deleteByTokenFn(ctx, token)
	}
	return nil
}

// Ensure interface compliance at compile time.
var _ repository.DeviceTokenRepository = (*mockDeviceTokenRepo)(nil)

// ============================================================
// Router setup
// ============================================================

func setupDeviceRouter(h *handler.DeviceHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/devices/token", injectUserID(callerID), h.RegisterToken)
	r.DELETE("/api/devices/:token", injectUserID(callerID), h.DeleteToken)
	return r
}

// ============================================================
// RegisterToken tests
// ============================================================

func TestDeviceHandler_RegisterToken_OK(t *testing.T) {
	callerID := uuid.New()
	var capturedToken *domain.DeviceToken

	repo := &mockDeviceTokenRepo{
		upsertFn: func(_ context.Context, token *domain.DeviceToken) error {
			capturedToken = token
			return nil
		},
	}
	h := handler.NewDeviceHandler(repo)
	r := setupDeviceRouter(h, callerID)

	body, _ := json.Marshal(map[string]interface{}{
		"token":    "fcm-token-abc123",
		"platform": "android",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/devices/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if capturedToken == nil {
		t.Fatal("expected upsert to be called")
	}
	if capturedToken.UserID != callerID {
		t.Errorf("expected userID %s, got %s", callerID, capturedToken.UserID)
	}
	if capturedToken.Token != "fcm-token-abc123" {
		t.Errorf("expected token 'fcm-token-abc123', got %q", capturedToken.Token)
	}
}

func TestDeviceHandler_RegisterToken_NoAuth(t *testing.T) {
	// Router without injectUserID — getUserUUID returns uuid.Nil
	// The handler still proceeds (userID = uuid.Nil), so we can't test 401 here.
	// In production, the JWT middleware would reject this before reaching the handler.
	// We test that missing required fields still return 400.
	repo := &mockDeviceTokenRepo{}
	h := handler.NewDeviceHandler(repo)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/devices/token", h.RegisterToken) // no auth middleware

	body, _ := json.Marshal(map[string]interface{}{
		// Missing "token" and "platform" — should get 400
	})
	req := httptest.NewRequest(http.MethodPost, "/api/devices/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing required fields, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeviceHandler_RegisterToken_InvalidPlatform(t *testing.T) {
	callerID := uuid.New()

	repo := &mockDeviceTokenRepo{}
	h := handler.NewDeviceHandler(repo)
	r := setupDeviceRouter(h, callerID)

	body, _ := json.Marshal(map[string]interface{}{
		"token":    "fcm-token-xyz",
		"platform": "windows", // not ios/android/web
	})
	req := httptest.NewRequest(http.MethodPost, "/api/devices/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid platform, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// DeleteToken tests
// ============================================================

func TestDeviceHandler_DeleteToken_OK(t *testing.T) {
	callerID := uuid.New()
	var deletedToken string

	repo := &mockDeviceTokenRepo{
		deleteByTokenFn: func(_ context.Context, token string) error {
			deletedToken = token
			return nil
		},
	}
	h := handler.NewDeviceHandler(repo)
	r := setupDeviceRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/devices/fcm-token-to-delete", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if deletedToken != "fcm-token-to-delete" {
		t.Errorf("expected token 'fcm-token-to-delete' passed to repo, got %q", deletedToken)
	}
}

func TestDeviceHandler_DeleteToken_NoAuth_RepoStillCalled(t *testing.T) {
	// Without auth middleware, getUserUUID returns uuid.Nil but DeleteToken
	// doesn't check ownership — it deletes by token string.
	// In production, the JWT middleware would gate this endpoint.
	// We verify the handler calls the repo even without a userID in context.
	var deleteWasCalled bool
	repo := &mockDeviceTokenRepo{
		deleteByTokenFn: func(_ context.Context, _ string) error {
			deleteWasCalled = true
			return nil
		},
	}
	h := handler.NewDeviceHandler(repo)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.DELETE("/api/devices/:token", h.DeleteToken) // no auth middleware

	req := httptest.NewRequest(http.MethodDelete, "/api/devices/some-token", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !deleteWasCalled {
		t.Error("expected repo.DeleteByToken to be called")
	}
}
