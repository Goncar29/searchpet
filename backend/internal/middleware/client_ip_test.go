package middleware_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
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
// remote_addr existe por un solo motivo: los proxies que ConfigureClientIP
// da por confiables no los documenta Render, hay que observarlos. Y paso: S1
// SUPUSO 10.0.0.0/8, y recien leyendo remote_addr en produccion
// (2026-09-27) se vio que el proxy llega por loopback ([::1]) y que ClientIP()
// daba "::1" para todos (S1c). Sin este campo, ese error seguia invisible.
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

// TestNewBaseEngine_OrdenYConfigDeClientIPQuedanAtadosAlRouter usa la MISMA
// función que SetupRouter (middleware.NewBaseEngine), no una cadena armada a
// mano, para que reordenar router.go rompa este test tal como rompería al
// router real (S1b: un test con la cadena armada a mano no detecta un
// reorder en router.go).
// Cubre dos cosas en un solo request: (1) RequestLog sigue por FUERA de
// Recovery — un handler que paniquea deja una línea de acceso con status 500
// — y (2) ConfigureClientIP quedó aplicado — un peer confiable sin
// CF-Connecting-IP nunca lee el X-Forwarded-For spoofeado.
func TestNewBaseEngine_OrdenYConfigDeClientIPQuedanAtadosAlRouter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	core, logs := observer.New(zap.InfoLevel)
	log := zap.New(core)

	r, err := middleware.NewBaseEngine(log)
	if err != nil {
		t.Fatalf("NewBaseEngine: %v", err)
	}
	r.GET("/boom", func(c *gin.Context) { panic("boom") })

	req := httptest.NewRequest(http.MethodGet, "/boom", nil)
	req.RemoteAddr = "10.1.2.3:4444"             // peer confiable, SIN CF-Connecting-IP
	req.Header.Set("X-Forwarded-For", "9.9.9.9") // spoofeado
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status HTTP = %d, queria 500 (gin.Recovery tiene que seguir activo)", w.Code)
	}

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("un handler que paniquea tiene que dejar 1 línea de acceso, hubo %d — RequestLog tiene que estar POR FUERA de Recovery", len(entries))
	}

	fields := entries[0].ContextMap()
	if fields["status"] != int64(http.StatusInternalServerError) {
		t.Fatalf("status logueado = %v, queria 500", fields["status"])
	}
	if fields["client_ip"] != "10.1.2.3" {
		t.Fatalf("client_ip logueado = %v, queria el peer (10.1.2.3) — sin CF-Connecting-IP, el X-Forwarded-For spoofeado NUNCA se tiene que leer, ni atado al router real vía NewBaseEngine", fields["client_ip"])
	}
}

// TestConfigureClientIP_CIDRInvalidoNoAplicaRemoteIPHeaders cubre el camino
// de error de ConfigureClientIP: TrustedProxyCIDRs es un var exportado, y
// nadie probaba qué pasa si algún CIDR es inválido. Tiene que devolver error
// Y no dejar el engine a medio configurar (RemoteIPHeaders sin tocar).
//
// Muta estado de paquete (TrustedProxyCIDRs) — no correr en paralelo.
func TestConfigureClientIP_CIDRInvalidoNoAplicaRemoteIPHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	original := middleware.TrustedProxyCIDRs
	middleware.TrustedProxyCIDRs = []string{"esto-no-es-un-cidr"}
	t.Cleanup(func() { middleware.TrustedProxyCIDRs = original })

	r := gin.New()
	before := append([]string(nil), r.RemoteIPHeaders...)

	err := middleware.ConfigureClientIP(r)
	if err == nil {
		t.Fatal("ConfigureClientIP con un CIDR inválido tenía que devolver error")
	}

	if !slices.Equal(r.RemoteIPHeaders, before) {
		t.Fatalf("RemoteIPHeaders = %v, no debía haberse tocado tras un CIDR inválido (antes: %v)", r.RemoteIPHeaders, before)
	}
}

// S1c (auditoria 2026-09-23). Los logs de produccion (2026-09-27) muestran
// que el proxy de Render le llega a la app por LOOPBACK: remote_addr
// "[::1]:51006" en el 100% de los requests, externos incluidos. S1 solo
// confiaba en 10.0.0.0/8, asi que gin ignoraba CF-Connecting-IP y ClientIP()
// daba "::1" para todo el mundo.
func TestConfigureClientIP_ConfiaEnElProxyLoopbackDeRender(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}

	var got string
	r.GET("/test", func(c *gin.Context) { got = c.ClientIP() })

	for _, peer := range []string{"[::1]:51006", "127.0.0.1:51006"} {
		got = ""
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.RemoteAddr = peer
		req.Header.Set("CF-Connecting-IP", "203.0.113.9")
		req.Header.Set("X-Forwarded-For", "1.2.3.4")
		r.ServeHTTP(httptest.NewRecorder(), req)

		if got != "203.0.113.9" {
			t.Errorf("peer %s: ClientIP() = %q, queria el CF-Connecting-IP (203.0.113.9)", peer, got)
		}
	}
}

// Lo que el test de rate limit de S1 no probaba: que el limite sea POR IP
// detras del proxy real. Con el peer en loopback y el loopback sin confiar,
// los dos clientes caian en el mismo bucket y el segundo recibia el 429 del
// primero — el limite de login se volvia global.
func TestConfigureClientIP_RateLimitPorIPDetrasDelLoopbackAislaClientes(t *testing.T) {
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

	hit := func(cfConnectingIP string) int {
		req := httptest.NewRequest(http.MethodGet, "/login", nil)
		req.RemoteAddr = "[::1]:51006" // como llega en produccion
		req.Header.Set("CF-Connecting-IP", cfConnectingIP)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	for i := 0; i < limit; i++ {
		if code := hit("203.0.113.9"); code != http.StatusOK {
			t.Fatalf("request %d dentro del cupo de %d deberia pasar, got %d", i+1, limit, code)
		}
	}
	if code := hit("203.0.113.9"); code != http.StatusTooManyRequests {
		t.Fatalf("el cliente que agoto su cupo deberia recibir 429, got %d", code)
	}
	if code := hit("198.51.100.5"); code != http.StatusOK {
		t.Fatalf("otro cliente detras del mismo proxy loopback deberia tener su propio bucket, got %d — el rate limit es global", code)
	}
}

// El otro lado de confiar en el loopback: un request que llega por el proxy
// SIN CF-Connecting-IP (un probe interno, o algo que entra a Render sin pasar
// por Cloudflare) no tiene de donde sacar la IP real y cae al peer crudo.
// Todos esos comparten el balde "::1" — el modo de falla de S1c, acotado al
// trafico sin el header. Se acepta a conciencia: inventar una IP seria peor,
// y el trafico de usuarios siempre trae el header. Este test lo fija para que
// un cambio de comportamiento no pase en silencio.
func TestConfigureClientIP_LoopbackSinHeaderCaeAlPeer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := middleware.ConfigureClientIP(r); err != nil {
		t.Fatalf("ConfigureClientIP: %v", err)
	}

	var got string
	r.GET("/test", func(c *gin.Context) { got = c.ClientIP() })

	for _, tc := range []struct{ name, header string }{
		{"sin header", ""},
		{"header invalido", "no-es-una-ip"},
	} {
		got = ""
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.RemoteAddr = "[::1]:51006"
		if tc.header != "" {
			req.Header.Set("CF-Connecting-IP", tc.header)
		}
		req.Header.Set("X-Forwarded-For", "1.2.3.4") // nunca se lee
		r.ServeHTTP(httptest.NewRecorder(), req)

		if got != "::1" {
			t.Errorf("%s: ClientIP() = %q, queria el peer crudo ::1", tc.name, got)
		}
	}
}
