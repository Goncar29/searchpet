package tests

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/middleware"
	"lost-pets/pkg/jwt"
)

const mwSecret = "middleware-test-secret"

// lookup builds a SessionStateFunc whose password changed at a fixed instant.
func lookup(at time.Time) middleware.SessionStateFunc {
	return func(_ context.Context, _ uuid.UUID) (middleware.SessionState, error) {
		return middleware.SessionState{PasswordChangedAt: at}, nil
	}
}

// lookupErr builds a SessionStateFunc that always fails with err.
func lookupErr(err error) middleware.SessionStateFunc {
	return func(_ context.Context, _ uuid.UUID) (middleware.SessionState, error) {
		return middleware.SessionState{}, err
	}
}

func requestWith(t *testing.T, h gin.HandlerFunc, token string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/probe", h, func(c *gin.Context) {
		id, ok := c.Get("userID")
		if !ok {
			c.JSON(http.StatusOK, gin.H{"anon": true})
			return
		}
		c.JSON(http.StatusOK, gin.H{"user": id})
	})

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAuth_RejectsTokenIssuedBeforePasswordChange(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	// Password changed one minute AFTER this token was issued.
	changed := time.Now().Add(time.Minute).Truncate(time.Second)

	w := requestWith(t, middleware.Auth(mwSecret, lookup(changed)), token)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, "session_expired") {
		t.Fatalf("body = %s, want it to carry session_expired", body)
	}
}

func TestAuth_AcceptsTokenIssuedInTheSameSecond(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	// Truncated to the same second the token was stamped with.
	changed := time.Now().Truncate(time.Second)

	w := requestWith(t, middleware.Auth(mwSecret, lookup(changed)), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a freshly issued token must not reject itself", w.Code)
	}
}

func TestAuth_ZeroPasswordChangedAtInvalidatesNothing(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.Auth(mwSecret, lookup(time.Time{})), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestOptionalAuth_StaleTokenDropsIdentityWithoutAborting(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	changed := time.Now().Add(time.Minute).Truncate(time.Second)

	w := requestWith(t, middleware.OptionalAuth(mwSecret, lookup(changed)), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — OptionalAuth must never abort", w.Code)
	}
	if !strings.Contains(w.Body.String(), "anon") {
		t.Fatalf("body = %s, want the request to proceed anonymously", w.Body.String())
	}
}

func TestAuth_DeletedUserGetsSessionExpired(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.Auth(mwSecret, lookupErr(domain.ErrUserNotFound)), token)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if body := w.Body.String(); !strings.Contains(body, "session_expired") {
		t.Fatalf("body = %s, want it to carry session_expired", body)
	}
}

// TestAuth_InfrastructureFailureGetsInternalErrorNotSessionExpired is the
// regression guard for the defect where ANY lookup error (including a transient
// database outage) was translated into session_expired. Both clients delete
// their stored JWT on that exact code, so a brief blip would have forced the
// entire logged-in user base to re-authenticate.
func TestAuth_InfrastructureFailureGetsInternalErrorNotSessionExpired(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.Auth(mwSecret, lookupErr(errors.New("db down"))), token)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "internal_error") {
		t.Fatalf("body = %s, want it to carry internal_error", body)
	}
	if strings.Contains(body, "session_expired") {
		t.Fatalf("body = %s, must NOT carry session_expired — clients delete the token on that code", body)
	}
}

func TestOptionalAuth_InfrastructureFailureDropsIdentityWithoutAborting(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.OptionalAuth(mwSecret, lookupErr(errors.New("db down"))), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — OptionalAuth must never abort", w.Code)
	}
	if !strings.Contains(w.Body.String(), "anon") {
		t.Fatalf("body = %s, want the request to proceed anonymously", w.Body.String())
	}
}

// banned builds a SessionStateFunc for a banned user whose password never
// changed, so only the ban can reject the token.
func banned() middleware.SessionStateFunc {
	return func(_ context.Context, _ uuid.UUID) (middleware.SessionState, error) {
		return middleware.SessionState{Banned: true}, nil
	}
}

// A ban must end a session that is already open. Before 2026-10-09 is_banned
// was read only at login, so a banned user kept using the API for up to the
// 72 h of the token.
func TestAuth_BannedUserGetsUserBanned(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.Auth(mwSecret, banned()), token)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"code":"user_banned"`) {
		t.Fatalf("body = %s, want code user_banned (not session_expired: the client must say why)", w.Body.String())
	}
}

func TestAuth_BannedWinsOverStaleToken(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	both := func(_ context.Context, _ uuid.UUID) (middleware.SessionState, error) {
		return middleware.SessionState{Banned: true, PasswordChangedAt: time.Now().Add(time.Minute)}, nil
	}

	w := requestWith(t, middleware.Auth(mwSecret, both), token)

	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"code":"user_banned"`) {
		t.Fatalf("status = %d body = %s, want 401 user_banned", w.Code, w.Body.String())
	}
}

// Public reads stay public: a banned viewer reads them as anyone would.
func TestOptionalAuth_BannedUserReadsAnonymously(t *testing.T) {
	token, err := jwt.GenerateToken(uuid.New(), mwSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	w := requestWith(t, middleware.OptionalAuth(mwSecret, banned()), token)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — OptionalAuth must never abort", w.Code)
	}
	if !strings.Contains(w.Body.String(), "anon") {
		t.Fatalf("body = %s, want the banned user to proceed anonymously", w.Body.String())
	}
}
