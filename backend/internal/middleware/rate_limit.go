package middleware

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/domain"
	"lost-pets/pkg/ratelimit"
)

// RateLimit returns a per-IP rate limiting middleware backed by the provided
// store. limit is the maximum number of requests allowed per window duration.
//
// On limit exceeded the middleware responds HTTP 429 with:
//
//	{"code": "rate_limit_exceeded", "message": "rate limit exceeded"}
//
// Example:
//
//	store := ratelimit.NewInMemoryStore()
//	r.POST("/auth/login", middleware.RateLimit(store, 5, time.Minute), handler)
func RateLimit(store ratelimit.Store, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Key by route + IP so each endpoint keeps an independent bucket. Keying
		// by IP alone lets a generous endpoint (e.g. a public 20/min route) share
		// a counter with a strict one (e.g. /auth/login at 5/min), so whichever
		// an IP hits first dictates the cap for the other. c.FullPath() is the
		// route pattern (e.g. "/api/pets/:id/share-link"), not the raw URL.
		key := "ratelimit:" + c.FullPath() + ":" + c.ClientIP()
		if !store.Allow(key, limit, window) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"code":    domain.CodeFor(domain.ErrRateLimitExceeded),
				"message": domain.ErrRateLimitExceeded.Error(),
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
