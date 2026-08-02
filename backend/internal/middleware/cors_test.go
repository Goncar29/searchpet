package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"lost-pets/internal/middleware"
)

// TestCORS_ExponeLosHeadersQueElFrontendLee es el guard de un defecto que NINGUN
// test de handler puede ver.
//
// El navegador solo deja que el JavaScript lea siete headers de respuesta; el
// resto viaja en la respuesta pero queda oculto salvo que Access-Control-Expose-
// Headers los nombre. Retry-After no esta entre esos siete, asi que mientras la
// lista decia solo "X-Total-Count", el 429 del cooldown llegaba con su header y
// `response.headers.get('Retry-After')` devolvia null igual — sin ningun error
// en consola. El contador de reenvio de la web nunca arrancaba con el numero del
// servidor y nadie se enteraba.
//
// El test del handler afirma que el header SE SETEA. Eso era cierto todo el
// tiempo, y por eso no sirvio: lo que hay que verificar no es que se mande, sino
// que se pueda LEER desde otro origen. Produccion es Vercel → Render, siempre
// cross-origin.
func TestCORS_ExponeLosHeadersQueElFrontendLee(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Los que el frontend lee hoy. Agregar uno nuevo al cliente sin sumarlo a
	// middleware.ExposedResponseHeaders tiene que poner este test en rojo.
	wantExposed := []string{
		"X-Total-Count",
		"Retry-After",
	}

	r := gin.New()
	r.Use(middleware.CORS("production", "https://lostpets.app"))
	r.POST("/api/verification/send-email", func(c *gin.Context) {
		c.Header("Retry-After", "45")
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "otp_cooldown"})
	})

	req := httptest.NewRequest(http.MethodPost, "/api/verification/send-email", nil)
	req.Header.Set("Origin", "https://lostpets.app")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	exposed := w.Header().Get("Access-Control-Expose-Headers")
	for _, h := range wantExposed {
		found := false
		for _, got := range strings.Split(exposed, ",") {
			if strings.EqualFold(strings.TrimSpace(got), h) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Access-Control-Expose-Headers = %q, le falta %q — el browser NO va a poder leerlo cross-origin, aunque el handler lo mande", exposed, h)
		}
	}

	// El header tiene que salir de verdad: exponer uno que nadie manda seria
	// mentirle al cliente en la otra direccion.
	if got := w.Header().Get("Retry-After"); got != "45" {
		t.Errorf("Retry-After = %q, want 45", got)
	}
}
