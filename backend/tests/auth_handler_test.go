package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
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
// Mock: AuthService
// ============================================================

type handlerAuthService = service.AuthService

type mockAuthService struct {
	registerFn           func(ctx context.Context, email, password, name, city string) (*domain.User, string, error)
	loginFn              func(ctx context.Context, email, password string) (*domain.User, string, error)
	updateLocationFn     func(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error)
	loginWithGoogleFn    func(ctx context.Context, idToken string) (*domain.User, string, bool, error)
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

func (m *mockAuthService) UpdateLocation(ctx context.Context, id uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error) {
	if m.updateLocationFn != nil {
		return m.updateLocationFn(ctx, id, req)
	}
	return nil, nil
}

func (m *mockAuthService) LoginWithGoogle(ctx context.Context, idToken string) (*domain.User, string, bool, error) {
	if m.loginWithGoogleFn != nil {
		return m.loginWithGoogleFn(ctx, idToken)
	}
	return nil, "", false, nil
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
			name: "banned user returns 403",
			body: map[string]interface{}{
				"email":    "banned@test.com",
				"password": "pass123",
			},
			setupMock: func(m *mockAuthService) {
				m.loginFn = func(_ context.Context, _, _ string) (*domain.User, string, error) {
					return nil, "", domain.ErrUserBanned
				}
			},
			wantStatus: http.StatusForbidden,
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

// ============================================================
// Tests: POST /api/auth/google
// ============================================================

func TestGoogleAuth_NewUserResponseShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	created := &domain.User{ID: uuid.New(), Email: "carlos@example.com", Name: "Carlos"}
	svc := &mockAuthService{
		loginWithGoogleFn: func(context.Context, string) (*domain.User, string, bool, error) {
			return created, "jwt-token", true, nil
		},
	}
	h := handler.NewAuthHandler(svc)

	router := gin.New()
	router.POST("/api/auth/google", h.GoogleAuth)

	body, _ := json.Marshal(map[string]string{"id_token": "google-id-token"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}

	var resp dto.GoogleAuthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.Token != "jwt-token" {
		t.Errorf("expected token %q, got %q", "jwt-token", resp.Token)
	}
	if !resp.IsNewUser {
		t.Error("expected is_new_user=true — the web onboarding step depends on this flag")
	}
	if resp.User.Email != "carlos@example.com" {
		t.Errorf("expected email in the response, got %q", resp.User.Email)
	}
}

func TestGoogleAuth_ReturningUserIsNotFlaggedNew(t *testing.T) {
	gin.SetMode(gin.TestMode)
	existing := &domain.User{ID: uuid.New(), Email: "carlos@example.com"}
	svc := &mockAuthService{
		loginWithGoogleFn: func(context.Context, string) (*domain.User, string, bool, error) {
			return existing, "jwt-token", false, nil
		},
	}
	h := handler.NewAuthHandler(svc)
	router := gin.New()
	router.POST("/api/auth/google", h.GoogleAuth)

	body, _ := json.Marshal(map[string]string{"id_token": "t"})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var resp dto.GoogleAuthResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.IsNewUser {
		t.Error("a returning user must NOT trigger the location onboarding step")
	}
}

func TestGoogleAuth_ErrorStatusMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{"invalid token", domain.ErrGoogleTokenInvalid, http.StatusUnauthorized, "google_token_invalid"},
		{"unverified email", domain.ErrGoogleEmailUnverified, http.StatusUnauthorized, "google_email_unverified"},
		{"sub mismatch", domain.ErrGoogleAccountMismatch, http.StatusConflict, "google_account_mismatch"},
		{"banned", domain.ErrUserBanned, http.StatusForbidden, "user_banned"},
		{"sign-in unavailable", domain.ErrGoogleSignInUnavailable, http.StatusBadGateway, "google_signin_unavailable"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockAuthService{
				loginWithGoogleFn: func(context.Context, string) (*domain.User, string, bool, error) {
					return nil, "", false, tc.err
				},
			}
			h := handler.NewAuthHandler(svc)
			router := gin.New()
			router.POST("/api/auth/google", h.GoogleAuth)

			body, _ := json.Marshal(map[string]string{"id_token": "t"})
			req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tc.wantCode {
				t.Errorf("expected %d, got %d", tc.wantCode, w.Code)
			}
			var errResp dto.ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
				t.Fatalf("invalid JSON: %v", err)
			}
			if errResp.Code != tc.wantBody {
				t.Errorf("expected code %q, got %q", tc.wantBody, errResp.Code)
			}
		})
	}
}

func TestGoogleAuth_MissingIDToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := handler.NewAuthHandler(&mockAuthService{})
	router := gin.New()
	router.POST("/api/auth/google", h.GoogleAuth)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/google", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for a missing id_token, got %d", w.Code)
	}
}

// ============================================================
// Tests: PATCH /api/auth/me/location
// ============================================================

// locationRouter wires the handler behind a middleware that injects userID,
// mirroring how the protected group supplies it in production.
func locationRouter(svc handlerAuthService, userID *uuid.UUID) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PATCH("/api/auth/me/location", func(c *gin.Context) {
		if userID != nil {
			c.Set("userID", *userID)
		}
	}, handler.NewAuthHandler(svc).UpdateLocation)
	return router
}

func patchLocation(router *gin.Engine, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/me/location", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestUpdateLocation_ResponseShape(t *testing.T) {
	id := uuid.New()
	updated := &domain.User{ID: id, Email: "carlos@example.com", Name: "Carlos", City: "Montevideo"}
	var got dto.UpdateLocationRequest
	svc := &mockAuthService{
		updateLocationFn: func(_ context.Context, gotID uuid.UUID, req dto.UpdateLocationRequest) (*domain.User, error) {
			if gotID != id {
				t.Errorf("handler passed user %s, expected %s", gotID, id)
			}
			got = req
			return updated, nil
		},
	}

	w := patchLocation(locationRouter(svc, &id), `{"latitude":-34.9011,"longitude":-56.1645}`)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", w.Code, w.Body.String())
	}
	if got.Latitude == nil || *got.Latitude != -34.9011 || got.Longitude == nil || *got.Longitude != -56.1645 {
		t.Errorf("coordinates did not reach the service intact: %+v", got)
	}
	var resp dto.UserResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.City != "Montevideo" {
		t.Errorf("expected the updated user back, got city %q", resp.City)
	}
}

func TestUpdateLocation_RequiresAuthenticatedUser(t *testing.T) {
	// No middleware sets userID — the handler must refuse rather than panic.
	w := patchLocation(locationRouter(&mockAuthService{}, nil), `{"city":"Montevideo"}`)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without a userID in context, got %d", w.Code)
	}
}

func TestUpdateLocation_ErrorStatusMapping(t *testing.T) {
	id := uuid.New()
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantBody string
	}{
		{"invalid input", domain.ErrInvalidInput, http.StatusBadRequest, "invalid_input"},
		{"user gone", domain.ErrUserNotFound, http.StatusNotFound, "user_not_found"},
		{"unexpected", errors.New("db exploded"), http.StatusInternalServerError, "internal_error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &mockAuthService{
				updateLocationFn: func(context.Context, uuid.UUID, dto.UpdateLocationRequest) (*domain.User, error) {
					return nil, tc.err
				},
			}
			w := patchLocation(locationRouter(svc, &id), `{"city":"Montevideo"}`)

			if w.Code != tc.wantCode {
				t.Errorf("expected %d, got %d", tc.wantCode, w.Code)
			}
			var errResp dto.ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
				t.Fatalf("invalid JSON: %v", err)
			}
			if errResp.Code != tc.wantBody {
				t.Errorf("expected code %q, got %q", tc.wantBody, errResp.Code)
			}
		})
	}
}

func TestUpdateLocation_MalformedBody(t *testing.T) {
	id := uuid.New()
	w := patchLocation(locationRouter(&mockAuthService{}, &id), `{"latitude":"not-a-number"}`)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for a malformed body, got %d", w.Code)
	}
}
