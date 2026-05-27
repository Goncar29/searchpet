package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/handler"
)

// ============================================================
// Mock: AuthService
// ============================================================

type mockAuthService struct {
	registerFn           func(ctx context.Context, email, password, name, city string) (*domain.User, string, error)
	loginFn              func(ctx context.Context, email, password string) (*domain.User, string, error)
	getUserFn            func(ctx context.Context, id uuid.UUID) (*domain.User, error)
	updateProfileFn      func(ctx context.Context, id uuid.UUID, name, phone, city string) (*domain.User, error)
	updateProfilePhotoFn func(ctx context.Context, id uuid.UUID, file multipart.File, filename string) (*domain.User, error)
	updatePreferencesFn  func(ctx context.Context, id uuid.UUID, req dto.UpdatePreferencesRequest) (*dto.UserPreferencesResponse, error)
}

func (m *mockAuthService) Register(ctx context.Context, email, password, name, city string) (*domain.User, string, error) {
	if m.registerFn != nil {
		return m.registerFn(ctx, email, password, name, city)
	}
	return nil, "", nil
}

func (m *mockAuthService) Login(ctx context.Context, email, password string) (*domain.User, string, error) {
	if m.loginFn != nil {
		return m.loginFn(ctx, email, password)
	}
	return nil, "", nil
}

func (m *mockAuthService) GetUser(ctx context.Context, id uuid.UUID) (*domain.User, error) {
	if m.getUserFn != nil {
		return m.getUserFn(ctx, id)
	}
	return nil, nil
}

func (m *mockAuthService) UpdateProfile(ctx context.Context, id uuid.UUID, name, phone, city string) (*domain.User, error) {
	if m.updateProfileFn != nil {
		return m.updateProfileFn(ctx, id, name, phone, city)
	}
	return nil, nil
}

func (m *mockAuthService) UpdateProfilePhoto(ctx context.Context, id uuid.UUID, file multipart.File, filename string) (*domain.User, error) {
	if m.updateProfilePhotoFn != nil {
		return m.updateProfilePhotoFn(ctx, id, file, filename)
	}
	return nil, nil
}

func (m *mockAuthService) UpdatePreferences(ctx context.Context, id uuid.UUID, req dto.UpdatePreferencesRequest) (*dto.UserPreferencesResponse, error) {
	if m.updatePreferencesFn != nil {
		return m.updatePreferencesFn(ctx, id, req)
	}
	return nil, nil
}

// ============================================================
// Router helpers
// ============================================================

func setupAuthRouter(h *handler.AuthHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/register", h.Register)
	r.POST("/api/auth/login", h.Login)
	return r
}

func newAuthHandler(svc *mockAuthService) *handler.AuthHandler {
	return handler.NewAuthHandler(svc)
}

// injectUserID is a test middleware that sets userID in the Gin context,
// simulating what the real Auth middleware does.
func injectUserID(id uuid.UUID) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set("userID", id)
		c.Next()
	}
}

// ============================================================
// Register tests
// ============================================================

func TestAuthHandler_Register(t *testing.T) {
	fixedID := uuid.New()
	fixedUser := &domain.User{
		ID:    fixedID,
		Email: "ana@test.com",
		Name:  "Ana",
	}

	tests := []struct {
		name       string
		body       map[string]interface{}
		setupMock  func(*mockAuthService)
		wantStatus int
	}{
		{
			name: "valid registration returns 201",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "pass123",
				"name":     "Ana",
			},
			setupMock: func(m *mockAuthService) {
				m.registerFn = func(_ context.Context, _, _, _, _ string) (*domain.User, string, error) {
					return fixedUser, "jwt-token", nil
				}
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "missing email returns 400",
			body: map[string]interface{}{
				"password": "pass123",
				"name":     "Ana",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing password returns 400",
			body: map[string]interface{}{
				"email": "ana@test.com",
				"name":  "Ana",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing name returns 400",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "pass123",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "duplicate email returns 409",
			body: map[string]interface{}{
				"email":    "duplicate@test.com",
				"password": "pass123",
				"name":     "Ana",
			},
			setupMock: func(m *mockAuthService) {
				m.registerFn = func(_ context.Context, _, _, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrEmailAlreadyExists
				}
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "invalid email format returns 400",
			body: map[string]interface{}{
				"email":    "not-an-email",
				"password": "pass123",
				"name":     "Ana",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "password too short returns 400",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "abc",
				"name":     "Ana",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "internal service error returns 500",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "pass123",
				"name":     "Ana",
			},
			setupMock: func(m *mockAuthService) {
				m.registerFn = func(_ context.Context, _, _, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockAuthService{}
			tc.setupMock(svc)
			r := setupAuthRouter(newAuthHandler(svc))

			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestAuthHandler_Register_ResponseShape verifies the 201 response contains user + token.
func TestAuthHandler_Register_ResponseShape(t *testing.T) {
	fixedID := uuid.New()
	svc := &mockAuthService{
		registerFn: func(_ context.Context, _, _, _, _ string) (*domain.User, string, error) {
			return &domain.User{ID: fixedID, Email: "ana@test.com", Name: "Ana"}, "my-token", nil
		},
	}
	r := setupAuthRouter(newAuthHandler(svc))

	body, _ := json.Marshal(map[string]interface{}{
		"email": "ana@test.com", "password": "pass123", "name": "Ana",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", w.Code)
	}

	var resp dto.AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Token != "my-token" {
		t.Errorf("want token 'my-token', got %q", resp.Token)
	}
	if resp.User.Email != "ana@test.com" {
		t.Errorf("want email 'ana@test.com', got %q", resp.User.Email)
	}
}

// ============================================================
// Login tests
// ============================================================

func TestAuthHandler_Login(t *testing.T) {
	fixedID := uuid.New()
	fixedUser := &domain.User{
		ID:    fixedID,
		Email: "ana@test.com",
		Name:  "Ana",
	}

	tests := []struct {
		name       string
		body       map[string]interface{}
		setupMock  func(*mockAuthService)
		wantStatus int
	}{
		{
			name: "valid credentials returns 200",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "pass123",
			},
			setupMock: func(m *mockAuthService) {
				m.loginFn = func(_ context.Context, _, _ string) (*domain.User, string, error) {
					return fixedUser, "jwt-token", nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "wrong password returns 401",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "wrongpass",
			},
			setupMock: func(m *mockAuthService) {
				m.loginFn = func(_ context.Context, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrInvalidCredentials
				}
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "user not found returns 401",
			body: map[string]interface{}{
				"email":    "ghost@test.com",
				"password": "pass123",
			},
			setupMock: func(m *mockAuthService) {
				m.loginFn = func(_ context.Context, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrInvalidCredentials
				}
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "banned user returns 401",
			body: map[string]interface{}{
				"email":    "banned@test.com",
				"password": "pass123",
			},
			setupMock: func(m *mockAuthService) {
				m.loginFn = func(_ context.Context, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrUserBanned
				}
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "missing email returns 400",
			body: map[string]interface{}{
				"password": "pass123",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "missing password returns 400",
			body: map[string]interface{}{
				"email": "ana@test.com",
			},
			setupMock:  func(m *mockAuthService) {},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "internal error returns 500",
			body: map[string]interface{}{
				"email":    "ana@test.com",
				"password": "pass123",
			},
			setupMock: func(m *mockAuthService) {
				m.loginFn = func(_ context.Context, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrInternal
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockAuthService{}
			tc.setupMock(svc)
			r := setupAuthRouter(newAuthHandler(svc))

			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("want status %d, got %d: %s", tc.wantStatus, w.Code, w.Body.String())
			}
		})
	}
}

// TestAuthHandler_Login_ResponseShape verifies the 200 response includes token.
func TestAuthHandler_Login_ResponseShape(t *testing.T) {
	fixedID := uuid.New()
	svc := &mockAuthService{
		loginFn: func(_ context.Context, _, _ string) (*domain.User, string, error) {
			return &domain.User{ID: fixedID, Email: "ana@test.com", Name: "Ana"}, "access-token", nil
		},
	}
	r := setupAuthRouter(newAuthHandler(svc))

	body, _ := json.Marshal(map[string]interface{}{
		"email": "ana@test.com", "password": "pass123",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}

	var resp dto.AuthResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Token == "" {
		t.Error("expected non-empty token in login response")
	}
	if resp.User.ID == (uuid.UUID{}) {
		t.Error("expected user ID in login response")
	}
}
