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
// Mock: BlockService (handler-level — returns DTOs)
// ============================================================

type mockBlockServiceForHandler struct {
	blockFn      func(ctx context.Context, blockerID, blockedID uuid.UUID, reason string) error
	unblockFn    func(ctx context.Context, blockerID, blockedID uuid.UUID) error
	getBlockedFn func(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error)
}

func (m *mockBlockServiceForHandler) Block(ctx context.Context, blockerID, blockedID uuid.UUID, reason string) error {
	if m.blockFn != nil {
		return m.blockFn(ctx, blockerID, blockedID, reason)
	}
	return nil
}

func (m *mockBlockServiceForHandler) Unblock(ctx context.Context, blockerID, blockedID uuid.UUID) error {
	if m.unblockFn != nil {
		return m.unblockFn(ctx, blockerID, blockedID)
	}
	return nil
}

func (m *mockBlockServiceForHandler) GetBlocked(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error) {
	if m.getBlockedFn != nil {
		return m.getBlockedFn(ctx, userID)
	}
	return []domain.BlockedUser{}, nil
}

// Ensure interface compliance at compile time.
var _ service.BlockService = (*mockBlockServiceForHandler)(nil)

// ============================================================
// Router setup
// ============================================================

func setupBlockRouter(h *handler.BlockHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	auth := r.Group("/api/users", injectUserID(callerID))
	auth.POST("/:id/block", h.Block)
	auth.DELETE("/:id/block", h.Unblock)
	auth.GET("/blocked", h.GetBlocked)
	return r
}

// ============================================================
// Block tests
// ============================================================

func TestBlockHandler_Block_OK(t *testing.T) {
	callerID := uuid.New()
	targetID := uuid.New()

	svc := &mockBlockServiceForHandler{
		blockFn: func(_ context.Context, _, _ uuid.UUID, _ string) error {
			return nil
		},
	}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	body, _ := json.Marshal(dto.BlockRequest{Reason: "spam"})
	req := httptest.NewRequest(http.MethodPost, "/api/users/"+targetID.String()+"/block", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d — body: %s", w.Code, w.Body.String())
	}
}

func TestBlockHandler_Block_NoBody_OK(t *testing.T) {
	// Body is optional on Block — should still succeed.
	callerID := uuid.New()
	targetID := uuid.New()

	svc := &mockBlockServiceForHandler{}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/users/"+targetID.String()+"/block", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201 even without body, got %d", w.Code)
	}
}

func TestBlockHandler_Block_SelfBlock_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockBlockServiceForHandler{
		blockFn: func(_ context.Context, _, _ uuid.UUID, _ string) error {
			return domain.ErrInvalidInput
		},
	}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	// Target ID equals caller ID — service returns ErrInvalidInput.
	req := httptest.NewRequest(http.MethodPost, "/api/users/"+callerID.String()+"/block", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for self-block, got %d", w.Code)
	}
}

func TestBlockHandler_Block_InvalidUUID_Returns400(t *testing.T) {
	callerID := uuid.New()

	svc := &mockBlockServiceForHandler{}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/users/not-a-uuid/block", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid UUID, got %d", w.Code)
	}
}

// ============================================================
// Unblock tests
// ============================================================

func TestBlockHandler_Unblock_OK(t *testing.T) {
	callerID := uuid.New()
	targetID := uuid.New()

	svc := &mockBlockServiceForHandler{
		unblockFn: func(_ context.Context, _, _ uuid.UUID) error {
			return nil
		},
	}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/users/"+targetID.String()+"/block", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestBlockHandler_Unblock_NotFound_Returns404(t *testing.T) {
	callerID := uuid.New()
	targetID := uuid.New()

	svc := &mockBlockServiceForHandler{
		unblockFn: func(_ context.Context, _, _ uuid.UUID) error {
			return domain.ErrBlockNotFound
		},
	}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/users/"+targetID.String()+"/block", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

// ============================================================
// GetBlocked tests
// ============================================================

func TestBlockHandler_GetBlocked_ReturnsList(t *testing.T) {
	callerID := uuid.New()
	otherID := uuid.New()

	svc := &mockBlockServiceForHandler{
		getBlockedFn: func(_ context.Context, _ uuid.UUID) ([]domain.BlockedUser, error) {
			return []domain.BlockedUser{
				{ID: uuid.New(), BlockerID: callerID, BlockedID: otherID},
			}, nil
		},
	}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/users/blocked", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp []dto.BlockedUserResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("could not parse response: %v", err)
	}
	if len(resp) != 1 {
		t.Errorf("expected 1 blocked user, got %d", len(resp))
	}
}

func TestBlockHandler_GetBlocked_EmptyList(t *testing.T) {
	callerID := uuid.New()

	svc := &mockBlockServiceForHandler{
		getBlockedFn: func(_ context.Context, _ uuid.UUID) ([]domain.BlockedUser, error) {
			return []domain.BlockedUser{}, nil
		},
	}
	h := handler.NewBlockHandler(svc)
	r := setupBlockRouter(h, callerID)

	req := httptest.NewRequest(http.MethodGet, "/api/users/blocked", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	// Must serialize as [] not null.
	if w.Body.String() == "null\n" || w.Body.String() == "null" {
		t.Error("empty list must serialize as [] not null")
	}
}
