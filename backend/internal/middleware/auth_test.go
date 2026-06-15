package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/pkg/jwt"
)

const testSecret = "test-secret-optional-auth"

// runOptionalAuth runs OptionalAuth with the given Authorization header and
// reports whether a userID landed in the context and the final HTTP status.
func runOptionalAuth(t *testing.T, authHeader string) (gotUserID uuid.UUID, hasUserID bool, status int) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/stories", nil)
	if authHeader != "" {
		c.Request.Header.Set("Authorization", authHeader)
	}

	nextCalled := false
	r := gin.New()
	r.Use(OptionalAuth(testSecret))
	r.GET("/api/stories", func(ctx *gin.Context) {
		nextCalled = true
		if v, ok := ctx.Get("userID"); ok {
			gotUserID = v.(uuid.UUID)
			hasUserID = true
		}
		ctx.Status(http.StatusOK)
	})
	r.ServeHTTP(w, c.Request)

	if !nextCalled {
		t.Fatalf("OptionalAuth aborted the request (next handler never ran); status=%d", w.Code)
	}
	return gotUserID, hasUserID, w.Code
}

func TestOptionalAuth_NoHeader_ContinuesAnonymous(t *testing.T) {
	_, hasUserID, status := runOptionalAuth(t, "")
	if hasUserID {
		t.Error("expected no userID for a request without Authorization header")
	}
	if status != http.StatusOK {
		t.Errorf("expected 200, got %d", status)
	}
}

func TestOptionalAuth_ValidToken_SetsUserID(t *testing.T) {
	want := uuid.New()
	token, err := jwt.GenerateToken(want, testSecret)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	got, hasUserID, status := runOptionalAuth(t, "Bearer "+token)
	if !hasUserID {
		t.Fatal("expected userID to be set for a valid Bearer token")
	}
	if got != want {
		t.Errorf("userID mismatch: got %s want %s", got, want)
	}
	if status != http.StatusOK {
		t.Errorf("expected 200, got %d", status)
	}
}

func TestOptionalAuth_InvalidToken_ContinuesAnonymous(t *testing.T) {
	_, hasUserID, status := runOptionalAuth(t, "Bearer not-a-real-jwt")
	if hasUserID {
		t.Error("expected no userID for an invalid token (must not abort, must not trust it)")
	}
	if status != http.StatusOK {
		t.Errorf("expected 200, got %d", status)
	}
}

func TestOptionalAuth_MalformedHeader_ContinuesAnonymous(t *testing.T) {
	_, hasUserID, status := runOptionalAuth(t, "Token abc123")
	if hasUserID {
		t.Error("expected no userID for a non-Bearer Authorization header")
	}
	if status != http.StatusOK {
		t.Errorf("expected 200, got %d", status)
	}
}
