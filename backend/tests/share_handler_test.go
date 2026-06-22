package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/handler"
)

// ============================================================
// Mock: ShareLinkService
// ============================================================

type mockShareLinkService struct {
	generateFn       func(ctx context.Context, petID string, ownerID string) (*domain.ShareLink, error)
	getOrCreatePubFn func(ctx context.Context, petID string) (*domain.ShareLink, error)
	getByTokenFn     func(ctx context.Context, token string) (*domain.ShareLink, error)
	trackContactFn   func(ctx context.Context, token string) error
}

func (m *mockShareLinkService) Generate(ctx context.Context, petID string, ownerID string) (*domain.ShareLink, error) {
	if m.generateFn != nil {
		return m.generateFn(ctx, petID, ownerID)
	}
	return nil, nil
}

func (m *mockShareLinkService) GetOrCreatePublicLink(ctx context.Context, petID string) (*domain.ShareLink, error) {
	if m.getOrCreatePubFn != nil {
		return m.getOrCreatePubFn(ctx, petID)
	}
	return nil, nil
}

func (m *mockShareLinkService) GetByToken(ctx context.Context, token string) (*domain.ShareLink, error) {
	if m.getByTokenFn != nil {
		return m.getByTokenFn(ctx, token)
	}
	return nil, nil
}

func (m *mockShareLinkService) TrackContact(ctx context.Context, token string) error {
	if m.trackContactFn != nil {
		return m.trackContactFn(ctx, token)
	}
	return nil
}

// ============================================================
// Router setup
// ============================================================

func setupShareGenerateRouter(h *handler.ShareHandler, callerID uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/share/:petId", injectUserID(callerID), h.GenerateShareLink)
	return r
}

func setupShareGetRouter(h *handler.ShareHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/share/:token", h.GetByToken)
	r.POST("/api/share/:token/contact", h.TrackContact)
	return r
}

// ============================================================
// GenerateShareLink tests
// ============================================================

func TestShareHandler_GenerateShareLink_OK(t *testing.T) {
	callerID := uuid.New()
	petID := uuid.New()
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	svc := &mockShareLinkService{
		generateFn: func(_ context.Context, _ string, _ string) (*domain.ShareLink, error) {
			return &domain.ShareLink{
				ID:         uuid.New(),
				PetID:      petID,
				ShareToken: "abc123token",
				ExpiresAt:  &expiresAt,
			}, nil
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGenerateRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/share/"+petID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestShareHandler_GenerateShareLink_NoAuth(t *testing.T) {
	// Router without injectUserID — getUserID returns "" → ownership check fails
	svc := &mockShareLinkService{
		generateFn: func(_ context.Context, _ string, ownerID string) (*domain.ShareLink, error) {
			return nil, domain.ErrNotPetOwner
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/share/:petId", h.GenerateShareLink) // no auth middleware

	req := httptest.NewRequest(http.MethodPost, "/api/share/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 when not pet owner, got %d: %s", w.Code, w.Body.String())
	}
}

func TestShareHandler_GenerateShareLink_PetNotFound(t *testing.T) {
	callerID := uuid.New()

	svc := &mockShareLinkService{
		generateFn: func(_ context.Context, _ string, _ string) (*domain.ShareLink, error) {
			return nil, domain.ErrPetNotFound
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGenerateRouter(h, callerID)

	req := httptest.NewRequest(http.MethodPost, "/api/share/"+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// GeneratePublicShareLink tests (public, no auth — lost/stray only)
// ============================================================

func setupPublicShareLinkRouter(h *handler.ShareHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/pets/:id/share-link", h.GeneratePublicShareLink)
	return r
}

func TestShareHandler_GeneratePublicShareLink_OK(t *testing.T) {
	petID := uuid.New()
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	svc := &mockShareLinkService{
		getOrCreatePubFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
			return &domain.ShareLink{
				ID:         uuid.New(),
				PetID:      petID,
				ShareToken: "publictoken",
				ExpiresAt:  &expiresAt,
			}, nil
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupPublicShareLinkRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+petID.String()+"/share-link", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if _, ok := resp["share_url"]; !ok {
		t.Errorf("expected share_url in response, got %v", resp)
	}
}

func TestShareHandler_GeneratePublicShareLink_NonShareable_NotFound(t *testing.T) {
	svc := &mockShareLinkService{
		getOrCreatePubFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
			return nil, domain.ErrPetNotFound
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupPublicShareLinkRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/pets/"+uuid.New().String()+"/share-link", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for non-lost/stray pet, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// GetByToken tests
// ============================================================

func TestShareHandler_GetByToken_Found(t *testing.T) {
	petID := uuid.New()
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	svc := &mockShareLinkService{
		getByTokenFn: func(_ context.Context, token string) (*domain.ShareLink, error) {
			return &domain.ShareLink{
				ID:         uuid.New(),
				PetID:      petID,
				ShareToken: token,
				ExpiresAt:  &expiresAt,
			}, nil
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGetRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/share/abc123token", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestShareHandler_GetByToken_NotFound(t *testing.T) {
	svc := &mockShareLinkService{
		getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
			return nil, domain.ErrShareLinkNotFound
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGetRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/share/nonexistent", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestShareHandler_GetByToken_Expired(t *testing.T) {
	svc := &mockShareLinkService{
		getByTokenFn: func(_ context.Context, _ string) (*domain.ShareLink, error) {
			return nil, domain.ErrShareLinkExpired
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGetRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/share/expiredtoken", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusGone {
		t.Errorf("expected 410 Gone for expired token, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
// TrackContact tests
// ============================================================

func TestShareHandler_TrackContact_OK(t *testing.T) {
	svc := &mockShareLinkService{
		trackContactFn: func(_ context.Context, _ string) error {
			return nil
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGetRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/share/abc123/contact", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["success"] != true {
		t.Errorf("expected success:true, got %v", resp["success"])
	}
}

func TestShareHandler_TrackContact_NotFound(t *testing.T) {
	svc := &mockShareLinkService{
		trackContactFn: func(_ context.Context, _ string) error {
			return domain.ErrShareLinkNotFound
		},
	}
	h := handler.NewShareHandler(svc, "https://lostpets.app")
	r := setupShareGetRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/share/bad-token/contact", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
