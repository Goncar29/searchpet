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
// El peer de httptest es 127.0.0.1, que NO está en TrustedProxyCIDRs: gin
// tiene que ignorar tanto el X-Forwarded-For como el CF-Connecting-IP que
// manda el cliente y usar el peer. Así, rotar los dos headers en cada
// request no estrena balde y el login cae en 429 al pasar el tope. Sin la
// config, gin v1.9.1 confía en cualquier peer y cada request estrenaría un
// balde nuevo: nunca 429.
func TestClientIPWiring_RateLimitDeLoginNoSeSalteaRotandoHeaders(t *testing.T) {
	const limit = 3
	baseURL, _, cleanup := startTestServerWithConfig(t, func(cfg *config.Config) {
		cfg.AuthRateLimitMax = limit
	})
	defer cleanup()

	body := []byte(`{"email":"nadie@searchpet.test","password":"incorrecta"}`)

	var last int
	for i := 0; i <= limit; i++ {
		req, err := http.NewRequest(http.MethodPost, baseURL+"/api/auth/login", bytes.NewReader(body))
		if err != nil {
			t.Fatalf("armando el request %d: %v", i+1, err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("1.2.3.%d", i))
		req.Header.Set("CF-Connecting-IP", fmt.Sprintf("6.6.6.%d", i))

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
		resp.Body.Close()
		last = resp.StatusCode

		if i < limit && last == http.StatusTooManyRequests {
			t.Fatalf("request %d dio 429 antes de llegar al tope de %d", i+1, limit)
		}
	}

	if last != http.StatusTooManyRequests {
		t.Fatalf("request %d rotando X-Forwarded-For y CF-Connecting-IP: esperaba 429, got %d — SetupRouter no está aplicando ConfigureClientIP y el rate limit se saltea", limit+1, last)
	}
}
