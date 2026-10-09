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

// SessionState is what the middleware needs to know about a token's owner. It
// comes from one primary-key read per request, so adding a field here costs no
// extra query.
type SessionState struct {
	// PasswordChangedAt is when the credentials last changed. Zero means
	// "never changed" and invalidates nothing.
	PasswordChangedAt time.Time
	// Banned is users.is_banned. Checked here, not only at login: a ban must
	// end a session that is already open, not wait out the 72 h of the token.
	Banned bool
}

// SessionStateFunc reads the SessionState of a user. Kept as a narrow function
// rather than a repository so the middleware does not depend on the whole data
// layer.
type SessionStateFunc func(ctx context.Context, userID uuid.UUID) (SessionState, error)

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

// abortBanned is distinct from abortSessionExpired so the client can tell the
// user why: both drop the stored token, but only this one means "suspended".
func abortBanned(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code":    domain.CodeFor(domain.ErrUserBanned),
		"message": domain.ErrUserBanned.Error(),
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

// sessionVerdict is what checkSession concluded about a token.
type sessionVerdict int

const (
	sessionOK sessionVerdict = iota
	// sessionStale: the token predates a password change, or its user is gone.
	sessionStale
	// sessionBanned: the user is banned. Checked before staleness so the client
	// is told the reason that will still hold after signing in again.
	sessionBanned
)

// checkSession reports whether the token is still valid for this user.
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
func checkSession(ctx context.Context, sessionState SessionStateFunc, userID uuid.UUID, issuedAt time.Time) (sessionVerdict, error) {
	state, err := sessionState(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// A deleted user genuinely should stop transiting, and session_expired
			// is the honest, non-infrastructure answer here.
			return sessionStale, nil
		}
		// Infrastructure failure: not evidence the token is stale.
		return sessionOK, err
	}
	if state.Banned {
		return sessionBanned, nil
	}
	at := state.PasswordChangedAt
	if !at.IsZero() && issuedAt.Before(at.Truncate(time.Second)) {
		return sessionStale, nil
	}
	return sessionOK, nil
}

// Auth valida el JWT en el header Authorization y pone el userID en el contexto.
//
// changedAt must not be nil: a nil SessionStateFunc would silently disable
// session invalidation on password reset, the worst failure mode a security
// control can have. Panicking at construction (boot time, called once in
// SetupRouter) fails fast in every environment before serving a single request.
func Auth(secretKey string, changedAt SessionStateFunc) gin.HandlerFunc {
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

		verdict, err := checkSession(c.Request.Context(), changedAt, userID, issuedAt)
		if err != nil {
			abortInternal(c)
			return
		}
		switch verdict {
		case sessionBanned:
			abortBanned(c)
			return
		case sessionStale:
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
// invalid or stale token, a banned user, or a session lookup that failed simply
// leaves no userID in the context (getUserUUID → uuid.Nil).
//
// changedAt must not be nil, for the same reason as in Auth: panicking at
// construction beats silently disabling the defence.
func OptionalAuth(secretKey string, changedAt SessionStateFunc) gin.HandlerFunc {
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
			if verdict, verr := checkSession(c.Request.Context(), changedAt, userID, issuedAt); verr == nil && verdict == sessionOK {
				c.Set("userID", userID)
			}
		}
		c.Next()
	}
}
