package middleware

import (
	"context"
	"errors"
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

// abortInternal is used when the freshness lookup itself failed (infrastructure),
// as opposed to the token genuinely being stale. It MUST stay distinct from
// abortSessionExpired: both web and mobile clients delete their stored JWT on
// session_expired, so translating a database hiccup into that code would force
// the entire logged-in user base to re-authenticate on every blip.
func abortInternal(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
		"code":    domain.CodeFor(domain.ErrInternal),
		"message": domain.ErrInternal.Error(),
	})
}

// checkFreshness reports whether the token is still valid for this user.
// A non-nil error means the check could not be performed — an infrastructure
// failure, NOT evidence about the token. Callers must not translate it into
// session_expired: clients delete their stored token on that code, so a brief
// database outage would otherwise log the entire user base out.
//
// The comparison is strict and both sides are second-granular: a JWT's `iat` has
// no sub-second component, so a password_changed_at carrying microseconds would
// make a token minted in the same second reject itself. The cost is that a token
// issued within that same second survives the reset — an accepted one-second
// window.
func checkFreshness(ctx context.Context, changedAt PasswordChangedAtFunc, userID uuid.UUID, issuedAt time.Time) (fresh bool, err error) {
	at, err := changedAt(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// A deleted user genuinely should stop transiting, and session_expired
			// is the honest, non-infrastructure answer here.
			return false, nil
		}
		// Infrastructure failure: not evidence the token is stale.
		return false, err
	}
	if at.IsZero() {
		return true, nil
	}
	return !issuedAt.Before(at.Truncate(time.Second)), nil
}

// Auth valida el JWT en el header Authorization y pone el userID en el contexto.
//
// changedAt must not be nil: a nil PasswordChangedAtFunc would silently disable
// session invalidation on password reset, the worst failure mode a security
// control can have. Panicking at construction (boot time, called once in
// SetupRouter) fails fast in every environment before serving a single request.
func Auth(secretKey string, changedAt PasswordChangedAtFunc) gin.HandlerFunc {
	if changedAt == nil {
		panic("middleware.Auth: changedAt must not be nil — it would silently disable session invalidation on password reset")
	}
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

		fresh, err := checkFreshness(c.Request.Context(), changedAt, userID, issuedAt)
		if err != nil {
			abortInternal(c)
			return
		}
		if !fresh {
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
// invalid or stale token — or a freshness lookup that failed — simply leaves no
// userID in the context (getUserUUID → uuid.Nil).
//
// changedAt must not be nil, for the same reason as in Auth: panicking at
// construction beats silently disabling the defence.
func OptionalAuth(secretKey string, changedAt PasswordChangedAtFunc) gin.HandlerFunc {
	if changedAt == nil {
		panic("middleware.OptionalAuth: changedAt must not be nil — it would silently disable session invalidation on password reset")
	}
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
		if err == nil {
			if fresh, ferr := checkFreshness(c.Request.Context(), changedAt, userID, issuedAt); ferr == nil && fresh {
				c.Set("userID", userID)
			}
		}
		c.Next()
	}
}
