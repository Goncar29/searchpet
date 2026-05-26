package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// ipLimiter holds a rate limiter and the last time it was seen.
type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimit returns a per-IP token-bucket rate limiting middleware.
// rps is the rate (requests per second), burst is the maximum burst size.
//
// Example: RateLimit(5.0/60.0, 5) allows 5 requests per minute with a burst of 5.
func RateLimit(rps float64, burst int) gin.HandlerFunc {
	var mu sync.Mutex
	limiters := make(map[string]*ipLimiter)

	// Background goroutine: evict entries that have not been seen in 10 minutes.
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			mu.Lock()
			cutoff := time.Now().Add(-10 * time.Minute)
			for ip, entry := range limiters {
				if entry.lastSeen.Before(cutoff) {
					delete(limiters, ip)
				}
			}
			mu.Unlock()
		}
	}()

	return func(c *gin.Context) {
		ip := c.ClientIP()

		mu.Lock()
		entry, exists := limiters[ip]
		if !exists {
			entry = &ipLimiter{
				limiter: rate.NewLimiter(rate.Limit(rps), burst),
			}
			limiters[ip] = entry
		}
		entry.lastSeen = time.Now()
		lim := entry.limiter
		mu.Unlock()

		if !lim.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			c.Abort()
			return
		}

		c.Next()
	}
}
