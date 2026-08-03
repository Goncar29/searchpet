//go:build e2e

package e2e_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestHealthReady_ConLaBaseCaidaDa503 corre /health/ready contra el server real
// y contra Postgres real, primero sano y despues con el pool cerrado. No toca
// /health — eso lo prueba, por separado, TestHealthReady_HealthSigueTontoConLaBaseCaida.
//
// El test NO siembra ni una fila a proposito: el cleanup de SetupTestDB trunca y
// cierra, y con el pool ya cerrado ese truncate loguea 24 warnings (uno por
// tabla) en vez de correr. Sin filas sembradas no hay nada que se filtre al
// test siguiente.
func TestHealthReady_ConLaBaseCaidaDa503(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	// --- con la base viva ---

	resp, err := http.Get(baseURL + "/health/ready")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("con la base viva: status %d, quiero 200", resp.StatusCode)
	}
	var sano map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&sano); err != nil {
		resp.Body.Close()
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	resp.Body.Close()
	if sano["status"] != "ready" {
		t.Fatalf(`status = %q, quiero "ready"`, sano["status"])
	}

	// --- se cae la base ---

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtener el pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("cerrar el pool: %v", err)
	}

	resp, err = http.Get(baseURL + "/health/ready")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("con la base caida: status %d, quiero 503 — el readiness no la esta mirando", resp.StatusCode)
	}

	var caido map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&caido); err != nil {
		t.Fatalf("cuerpo no parsea: %v", err)
	}
	if caido["code"] != "not_ready" {
		t.Fatalf(`code = %q, quiero "not_ready"`, caido["code"])
	}
}

// TestHealthReady_HealthSigueTontoConLaBaseCaida prueba que /health contesta
// 200 con el pool de conexiones cerrado. Es la unica forma ejecutable de la
// decision de diseno y agarra el error mas probable (agregarle una consulta a
// /health), pero no prueba la aspiracion completa "/health no toca ninguna
// dependencia": pasarian este test igual un /health que consulte la base y se
// trague el error, uno que dependa de algo no-Postgres, o uno contra una base
// COLGADA en vez de caida — un pool cerrado falla instantaneo, y nada aca acota
// la latencia.
func TestHealthReady_HealthSigueTontoConLaBaseCaida(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtener el pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("cerrar el pool: %v", err)
	}

	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("request fallo: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/health dio %d con la base caida — dejo de ser un liveness y el monitor perdio el diagnostico", resp.StatusCode)
	}
}
