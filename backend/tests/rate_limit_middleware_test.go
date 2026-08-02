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

// TestRateLimitMiddleware_PerEndpointIsolation verifies that two different
// routes hit by the SAME IP keep independent buckets. Without per-route keying,
// a generous public endpoint (e.g. 20/min) would share a counter with a strict
// one (e.g. /auth/login at 5/min), letting either contaminate the other.
func TestRateLimitMiddleware_PerEndpointIsolation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	store := ratelimit.NewInMemoryStore()
	ok := func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) }
	r.GET("/a", middleware.RateLimit(store, 1, 1*time.Second), ok)
	r.GET("/b", middleware.RateLimit(store, 1, 1*time.Second), ok)

	hit := func(path string) int {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "10.0.3.1:5555"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	// Same IP exhausts /a's burst of 1.
	hit("/a")
	if code := hit("/a"); code != http.StatusTooManyRequests {
		t.Fatalf("expected /a to be limited on the 2nd request, got %d", code)
	}
	// The first hit to /b from the same IP must NOT inherit /a's exhausted bucket.
	if code := hit("/b"); code != http.StatusOK {
		t.Errorf("endpoints must have independent per-IP buckets, got %d for first /b hit", code)
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

// El 429 del limiter de ruta era el unico de los tres de /verification/send-email
// sin Retry-After: el frontend no arrancaba contador y dejaba el boton vivo,
// invitando al reintento que el servidor acababa de rechazar. Se manda la ventana
// ENTERA porque el Store solo contesta si/no, no cuanto falta: esperar de mas es
// inocuo, un numero optimista no.
func TestRateLimitMiddleware_El429TraeRetryAfter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	const window = 90 * time.Second
	r.GET("/test", middleware.RateLimit(ratelimit.NewInMemoryStore(), 1, window), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	hit := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.RemoteAddr = "10.0.0.9:12345"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	if w := hit(); w.Code != http.StatusOK {
		t.Fatalf("el primer request tiene que pasar, got %d", w.Code)
	}

	w := hit()
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", w.Code)
	}
	if got := w.Header().Get("Retry-After"); got != "90" {
		t.Fatalf("Retry-After = %q, want \"90\" (la ventana entera)", got)
	}

	// El header solo sirve si el browser lo puede LEER: en produccion la web es
	// cross-origin (Vercel -> Render) y Retry-After no esta entre los siete que
	// el navegador expone por defecto.
	exposed := false
	for _, h := range middleware.ExposedResponseHeaders {
		if h == "Retry-After" {
			exposed = true
		}
	}
	if !exposed {
		t.Fatal("Retry-After no esta en ExposedResponseHeaders: el JS lo lee como null y sin un solo error en consola")
	}
}
