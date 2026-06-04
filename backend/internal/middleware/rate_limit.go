package middleware

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"lost-pets/pkg/ratelimit"
)

// RateLimit returns a per-IP rate limiting middleware backed by the provided
// store. limit is the maximum number of requests allowed per window duration.
//
// On limit exceeded the middleware responds HTTP 429 with:
//
//	{"error": "rate limit exceeded"}
//
// Example:
//
//	store := ratelimit.NewInMemoryStore()
//	r.POST("/auth/login", middleware.RateLimit(store, 5, time.Minute), handler)
func RateLimit(store ratelimit.Store, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := "ratelimit:" + c.ClientIP()
		if !store.Allow(key, limit, window) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
			c.Abort()
			return
		}
		c.Next()
	}
}
