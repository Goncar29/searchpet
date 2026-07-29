package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/pkg/jwt"
)

// PasswordChangedAtFunc reports when the user's credentials last changed.
// A zero time means "never changed" and invalidates nothing. Kept as a narrow
// function rather than a repository so the middleware does not depend on the
// whole data layer.
type PasswordChangedAtFunc func(ctx context.Context, userID uuid.UUID) (time.Time, error)

func abortUnauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":    domain.CodeFor(domain.ErrUnauthorized),
		"message": domain.ErrUnauthorized.Error(),
	})
}

// abortSessionExpired is distinct from abortUnauthorized on purpose: the client
// must drop the stored token and route to login, not just show an error.
func abortSessionExpired(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":    domain.CodeFor(domain.ErrSessionExpired),
		"message": domain.ErrSessionExpired.Error(),
	})
}

// tokenIsStale reports whether a token issued at issuedAt predates the user's
// last credential change.
//
// The comparison is strict and both sides are second-granular: a JWT's `iat` has
// no sub-second component, so a password_changed_at carrying microseconds would
// make a token minted in the same second reject itself. The cost is that a token
// issued within that same second survives the reset — an accepted one-second
// window.
//
// A lookup failure is treated as stale (fail closed): a deleted user must not
// keep transiting, and a database outage already breaks every request anyway.
func tokenIsStale(ctx context.Context, changedAt PasswordChangedAtFunc, userID uuid.UUID, issuedAt time.Time) bool {
	if changedAt == nil {
		return false
	}
	at, err := changedAt(ctx, userID)
	if err != nil {
		return true
	}
	if at.IsZero() {
		return false
	}
	return issuedAt.Before(at.Truncate(time.Second))
}

// Auth valida el JWT en el header Authorization y pone el userID en el contexto.
func Auth(secretKey string, changedAt PasswordChangedAtFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			abortUnauthorized(c)
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			abortUnauthorized(c)
			return
		}

		userID, issuedAt, err := jwt.ValidateToken(parts[1], secretKey)
		if err != nil {
			abortUnauthorized(c)
			return
		}

		if tokenIsStale(c.Request.Context(), changedAt, userID, issuedAt) {
			abortSessionExpired(c)
			return
		}

		c.Set("userID", userID)
		c.Next()
	}
}

// OptionalAuth parses the JWT if present and sets the userID, but never aborts.
// Use it on public read endpoints that enrich their response for the viewer
// (e.g. liked_by_me) yet must remain readable by anonymous users. A missing,
// invalid or stale token simply leaves no userID in the context
// (getUserUUID → uuid.Nil).
func OptionalAuth(secretKey string, changedAt PasswordChangedAtFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.Next()
			return
		}

		userID, issuedAt, err := jwt.ValidateToken(parts[1], secretKey)
		if err == nil && !tokenIsStale(c.Request.Context(), changedAt, userID, issuedAt) {
			c.Set("userID", userID)
		}
		c.Next()
	}
}
