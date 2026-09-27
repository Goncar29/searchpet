//go:build e2e

package e2e_test

import (
	"bytes"
	"fmt"
	"net/http"
	"testing"

	"lost-pets/config"
)

// TestClientIPWiring_RateLimitDeLoginNoSeSalteaRotandoHeaders prueba que
// app.SetupRouter REALMENTE aplica middleware.ConfigureClientIP (hallazgo S1
// de la auditoría del 2026-09-23). Los tests de internal/middleware arman su
// propio gin.New(); si alguien borra o mueve la llamada en router.go, esos
// siguen verdes y producción vuelve a creerle a X-Forwarded-For.
//
// El peer de httptest es 127.0.0.1: el mismo loopback por el que el proxy de
// Render le llega a la app en producción (S1c, observado el 2026-09-27), y por
// eso ahora está en TrustedProxyCIDRs. Con la config, gin lee SÓLO
// CF-Connecting-IP: rotar X-Forwarded-For con el mismo CF-Connecting-IP no
// estrena balde y el login cae en 429. Sin la config, gin v1.9.1 le cree al
// X-Forwarded-For de cualquier peer y cada request estrenaría balde: nunca 429.
//
// La segunda mitad es la que S1 no tenía: un CF-Connecting-IP distinto tiene
// su propio balde. Con el loopback sin confiar (el bug de S1c) todos los
// clientes compartían uno y ese request también daba 429.
func TestClientIPWiring_RateLimitDeLoginNoSeSalteaRotandoHeaders(t *testing.T) {
	const limit = 3
	baseURL, _, cleanup := startTestServerWithConfig(t, func(cfg *config.Config) {
		cfg.AuthRateLimitMax = limit
	})
	defer cleanup()

	body := []byte(`{"email":"nadie@searchpet.test","password":"incorrecta"}`)
	login := func(cfConnectingIP, xff string) int {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, baseURL+"/api/auth/login", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("armando el request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("CF-Connecting-IP", cfConnectingIP)
		req.Header.Set("X-Forwarded-For", xff)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	var last int
	for i := 0; i <= limit; i++ {
		last = login("203.0.113.9", fmt.Sprintf("1.2.3.%d", i))
		if i < limit && last != http.StatusUnauthorized {
			t.Fatalf("request %d dentro del tope de %d: esperaba 401 (credenciales malas), got %d", i+1, limit, last)
		}
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("request %d con el mismo CF-Connecting-IP rotando X-Forwarded-For: esperaba 429, got %d — SetupRouter no está aplicando ConfigureClientIP y el rate limit se saltea", limit+1, last)
	}

	// 401 y no "cualquier cosa menos 429": prueba que el request llegó al
	// handler de login con su propio balde, no sólo que el limiter no lo frenó.
	if code := login("198.51.100.5", "9.9.9.9"); code != http.StatusUnauthorized {
		t.Fatalf("otro CF-Connecting-IP: esperaba 401 con su propio balde, got %d — si es 429, el rate limit por IP es global detrás del proxy loopback (S1c)", code)
	}
}
