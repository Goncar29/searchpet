//go:build e2e

package e2e_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"lost-pets/config"
	"lost-pets/internal/service"
)

// TestOpsQuota_CuentaFilasReales siembra filas del canal email en Postgres y
// verifica que el endpoint las reporte. Los mocks no tienen sweeper ni columnas:
// este es el unico test que ve el conteo tal como corre en produccion.
func TestOpsQuota_CuentaFilasReales(t *testing.T) {
	// Mismo determinismo que el e2e hermano: sin credenciales el mailer es noop.
	t.Setenv("BREVO_API_KEY", "")
	t.Setenv("MAIL_FROM_EMAIL", "")

	baseURL, db, cleanup := startTestServerWithConfig(t, func(c *config.Config) {
		c.OpsStatusToken = "test-ops-token"
	})
	defer cleanup()

	_, email := registerAndLogin(t, baseURL)
	userID := userIDByEmail(t, db, email)

	const sembrados = 3
	for i := 0; i < sembrados; i++ {
		seedEmailToken(t, db, userID, time.Now().Add(-time.Duration(i+1)*time.Minute))
	}

	req, err := http.NewRequest(http.MethodGet, baseURL+"/api/ops/quota", nil)
	if err != nil {
		t.Fatalf("armar request: %v", err)
	}
	req.Header.Set("X-Ops-Token", "test-ops-token")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, quiero 200", resp.StatusCode)
	}

	var rep service.QuotaReport
	if err := json.NewDecoder(resp.Body).Decode(&rep); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}

	var emailUsed int64 = -1
	for _, c := range rep.Channels {
		if c.Channel == service.ChannelEmail {
			emailUsed = c.Used
		}
	}
	if emailUsed != sembrados {
		t.Fatalf("email.used = %d, quiero %d — el endpoint no esta contando filas reales", emailUsed, sembrados)
	}
}

// TestOpsQuota_SinTokenNoExiste corre contra el server real, no contra un router
// armado a mano: confirma que la ruta quedo registrada Y que el gate viaja con ella.
func TestOpsQuota_SinTokenNoExiste(t *testing.T) {
	baseURL, _, cleanup := startTestServerWithConfig(t, func(c *config.Config) {
		c.OpsStatusToken = "test-ops-token"
	})
	defer cleanup()

	resp, err := http.Get(baseURL + "/api/ops/quota")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("sin header: status %d, quiero 404", resp.StatusCode)
	}
}
