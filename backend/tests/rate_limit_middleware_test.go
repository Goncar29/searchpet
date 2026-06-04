package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/middleware"
	"lost-pets/pkg/ratelimit"
)

// TestRateLimitMiddleware_BurstExceeded verifies that after exhausting the token
// bucket burst capacity, the middleware returns 429 Too Many Requests.
//
// limit=2, window=1s: allows 2 requests per second (burst of 2).
// The 3rd request (burst+1) should be rejected with 429.
func TestRateLimitMiddleware_BurstExceeded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// 2 requests per 1 second window, burst = 2.
	r.GET("/test", middleware.RateLimit(ratelimit.NewInMemoryStore(), 2, 1*time.Second), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	burst := 2
	lastStatus := http.StatusOK

	// Send burst+1 requests from the same IP. Because httptest always uses
	// 192.0.2.1 as the client IP (net/http/httptest), all requests share
	// the same limiter entry.
	for i := 0; i <= burst; i++ {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		// Simulate a real client IP so the per-IP limiter applies consistently.
		req.RemoteAddr = "10.0.0.1:12345"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		lastStatus = w.Code
	}

	if lastStatus != http.StatusTooManyRequests {
		t.Errorf("expected 429 on burst+1 request, got %d", lastStatus)
	}
}

// TestRateLimitMiddleware_WithinBurst verifies that requests within the burst
// limit all succeed with 200.
func TestRateLimitMiddleware_WithinBurst(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test2", middleware.RateLimit(ratelimit.NewInMemoryStore(), 5, 1*time.Second), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/test2", nil)
		req.RemoteAddr = "10.0.0.2:9999"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("request %d: expected 200 within burst, got %d", i+1, w.Code)
		}
	}
}

// TestRateLimitMiddleware_DifferentIPs verifies that different IPs have
// independent rate limit buckets.
func TestRateLimitMiddleware_DifferentIPs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/test3", middleware.RateLimit(ratelimit.NewInMemoryStore(), 1, 1*time.Second), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// IP A exhausts its burst of 1
	req1 := httptest.NewRequest(http.MethodGet, "/test3", nil)
	req1.RemoteAddr = "10.0.1.1:1234"
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)

	req2 := httptest.NewRequest(http.MethodGet, "/test3", nil)
	req2.RemoteAddr = "10.0.1.1:1234"
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	// IP A second request should be 429
	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 for IP A second request, got %d", w2.Code)
	}

	// IP B should still get 200 (fresh bucket)
	req3 := httptest.NewRequest(http.MethodGet, "/test3", nil)
	req3.RemoteAddr = "10.0.1.2:1234"
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Errorf("expected 200 for IP B (fresh bucket), got %d", w3.Code)
	}
}
