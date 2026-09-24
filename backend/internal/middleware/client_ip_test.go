package middleware_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"lost-pets/internal/middleware"
	"lost-pets/pkg/ratelimit"
)

// TestConfigureClientIP_UsaCFConnectingIPDetrasDelPeerConfiable prueba el caso
// feliz: Render (peer 10.x, confiable) reenvia CF-Connecting-IP, que
// Cloudflare fija desde la conexion TCP real y el cliente no puede spoofear.
// gin.Context.ClientIP() tiene que devolver ESE valor, nunca el
// X-Forwarded-For que cualquiera pisa desde el browser.
func TestConfigureClientIP_UsaCFConnectingIPDetrasDelPeerConfiable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}

	var got string
	r.GET("/test", func(c *gin.Context) { got = c.ClientIP() })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "10.1.2.3:4444" // load balancer interno de Render
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	req.Header.Set("CF-Connecting-IP", "203.0.113.9")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got != "203.0.113.9" {
		t.Fatalf("ClientIP() = %q, queria el CF-Connecting-IP real (203.0.113.9) y NO el X-Forwarded-For spoofeado (1.2.3.4)", got)
	}
}

// TestConfigureClientIP_SinCFConnectingIPUsaElPeerYJamasElXFF cubre el peer
// confiable SIN el header de Cloudflare (por ejemplo, alguien le pega directo
// a Render). RemoteIPHeaders solo lista CF-Connecting-IP, asi que
// X-Forwarded-For nunca se lee, ni siquiera con el peer en la lista confiable.
func TestConfigureClientIP_SinCFConnectingIPUsaElPeerYJamasElXFF(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}

	var got string
	r.GET("/test", func(c *gin.Context) { got = c.ClientIP() })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "10.1.2.3:4444"
	req.Header.Set("X-Forwarded-For", "9.9.9.9") // spoofeado, sin CF-Connecting-IP
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got != "10.1.2.3" {
		t.Fatalf("ClientIP() = %q, queria el peer (10.1.2.3) — sin CF-Connecting-IP, el XFF spoofeado NUNCA se tiene que leer", got)
	}
}

// TestConfigureClientIP_PeerNoConfiableIgnoraElHeaderForjado cubre a alguien
// que le pega a Render sin pasar por el load balancer interno (peer fuera de
// 10.0.0.0/8): su propio CF-Connecting-IP forjado tiene que ser ignorado.
func TestConfigureClientIP_PeerNoConfiableIgnoraElHeaderForjado(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}

	var got string
	r.GET("/test", func(c *gin.Context) { got = c.ClientIP() })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "198.51.100.7:4444" // NO esta en 10.0.0.0/8
	req.Header.Set("CF-Connecting-IP", "6.6.6.6")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got != "198.51.100.7" {
		t.Fatalf("ClientIP() = %q, queria el peer (198.51.100.7) — un peer no confiable NO puede imponer su propio CF-Connecting-IP", got)
	}
}

// TestConfigureClientIP_RateLimitPorIPResisteSpoofingDeXFF es el test de
// comportamiento de fondo: el middleware.RateLimit REAL, corriendo detras de
// ConfigureClientIP, con un atacante que manda un X-Forwarded-For distinto en
// cada request (el ataque que motivo S1) pero el mismo CF-Connecting-IP real
// (el que Cloudflare de verdad fija). El bucket tiene que ser UNO SOLO, y un
// CF-Connecting-IP genuinamente distinto tiene que tener su propio bucket —
// si todo colapsara al mismo balde, el rate limit protegeria la ruta pero le
// negaria servicio a cualquiera detras del LB.
func TestConfigureClientIP_RateLimitPorIPResisteSpoofingDeXFF(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}

	const limit = 3
	store := ratelimit.NewInMemoryStore()
	r.GET("/login", middleware.RateLimit(store, limit, time.Minute), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	hit := func(cfConnectingIP, xff string) int {
		req := httptest.NewRequest(http.MethodGet, "/login", nil)
		req.RemoteAddr = "10.0.0.1:1234" // peer confiable (LB interno)
		req.Header.Set("CF-Connecting-IP", cfConnectingIP)
		req.Header.Set("X-Forwarded-For", xff)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	// El mismo atacante real (mismo CF-Connecting-IP), un XFF distinto en cada
	// request. Si el bucket se armara con el XFF spoofeado, cada request
	// estrenaria balde y el limite jamas se alcanzaria.
	var lastCode int
	for i := 0; i <= limit; i++ {
		lastCode = hit("203.0.113.9", fmt.Sprintf("1.2.3.%d", i))
	}
	if lastCode != http.StatusTooManyRequests {
		t.Fatalf("request %d desde el mismo CF-Connecting-IP (XFF spoofeado distinto cada vez) deberia dar 429, got %d — el rate limit se puede seguir salteando", limit+1, lastCode)
	}

	// Un CF-Connecting-IP genuinamente distinto no puede heredar el bucket
	// agotado del anterior.
	if code := hit("198.51.100.5", "9.9.9.9"); code != http.StatusOK {
		t.Fatalf("un CF-Connecting-IP distinto deberia tener su propio bucket, got %d — el rate limit por IP colapso a un bucket compartido", code)
	}
}

// TestRequestLog_LoguearemoteAddrJuntoAlClientIP prueba que el middleware de
// logging de requests deja, en el mismo registro, el ClientIP() que gin
// resuelve (post ConfigureClientIP) Y el remote_addr crudo del socket TCP.
//
// remote_addr existe por un solo motivo: el 10.0.0.0/8 que ConfigureClientIP
// da por confiable esta OBSERVADO en produccion, no documentado por Render.
// Si Render cambia ese rango interno, la unica forma de confirmarlo es leer
// remote_addr en un log real — sin este campo, un cambio de infraestructura
// rompe el fix de S1 en silencio.
func TestRequestLog_LoguearemoteAddrJuntoAlClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	core, logs := observer.New(zap.InfoLevel)
	log := zap.New(core)

	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}
	r.Use(middleware.RequestLog(log))
	r.GET("/test", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "10.0.0.1:5555"
	req.Header.Set("CF-Connecting-IP", "203.0.113.9")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("se esperaba 1 entrada de log, hubo %d", len(entries))
	}

	fields := entries[0].ContextMap()
	if fields["client_ip"] != "203.0.113.9" {
		t.Fatalf("client_ip = %v, queria \"203.0.113.9\"", fields["client_ip"])
	}
	if fields["remote_addr"] != "10.0.0.1:5555" {
		t.Fatalf("remote_addr = %v, queria el peer crudo \"10.0.0.1:5555\" — sin esto no se puede confirmar el CIDR de Render en produccion", fields["remote_addr"])
	}
}

// TestRequestLog_PorFueraDeRecoveryLogueaLosPanics fija el orden que usa
// SetupRouter: RequestLog por FUERA de gin.Recovery(). Así un handler que
// paniquea igual deja su línea de acceso con status 500 (y con client_ip y
// remote_addr), como hacía el Logger de gin.Default().
func TestRequestLog_PorFueraDeRecoveryLogueaLosPanics(t *testing.T) {
	gin.SetMode(gin.TestMode)
	core, logs := observer.New(zap.InfoLevel)

	r := gin.New()
	r.Use(middleware.RequestLog(zap.New(core)))
	r.Use(gin.Recovery())
	r.GET("/boom", func(c *gin.Context) { panic("boom") })

	req := httptest.NewRequest(http.MethodGet, "/boom", nil)
	req.RemoteAddr = "10.0.0.1:5555"
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("un request que paniquea tiene que dejar 1 línea de acceso, hubo %d", len(entries))
	}
	if got := entries[0].ContextMap()["status"]; got != int64(http.StatusInternalServerError) {
		t.Fatalf("status logueado = %v, quería 500", got)
	}
}
