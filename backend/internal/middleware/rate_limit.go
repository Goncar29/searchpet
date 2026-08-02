package middleware

import (
	"net/http"
	"strconv"
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
			// Retry-After con la ventana ENTERA. El Store sólo contesta sí/no, no
			// cuánto falta para que el bucket se libere, así que se manda la cota
			// superior: esperar de más es inocuo, y un número optimista invitaría
			// a reintentar antes de tiempo — el mismo criterio que
			// secondsUntilWindowFrees.
			//
			// Sin esto, éste era el único de los tres 429 de /verification/send-email
			// sin número: el frontend no arrancaba contador y dejaba el botón vivo,
			// invitando al reintento que el servidor acababa de rechazar. Va expuesto
			// por middleware.ExposedResponseHeaders, o el browser no puede leerlo.
			c.Header("Retry-After", strconv.Itoa(int(window.Seconds())))
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
