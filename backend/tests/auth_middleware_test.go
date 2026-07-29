package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/middleware"
	"lost-pets/pkg/jwt"
)

const mwSecret = "middleware-test-secret"

// lookup builds a PasswordChangedAtFunc returning a fixed instant.
func lookup(at time.Time) middleware.PasswordChangedAtFunc {
	return func(_ context.Context, _ uuid.UUID) (time.Time, error) { return at, nil }
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
