//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// TestPublicProfilePetsFlow_NoDevuelveLasPrivadasSinToken es el punto de toda
// la feature: un tercero SIN sesión (ni siquiera un token inválido — sin
// header Authorization) tiene que ver lo que el dueño publicó y NO lo que
// tiene guardado en privado. El dueño registra una mascota (queda
// "registered", privada) y la publica como perdida (queda "lost", pública).
func TestPublicProfilePetsFlow_NoDevuelveLasPrivadasSinToken(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// Necesitamos el ID del usuario dueño. No hay endpoint "quién soy" en estos
	// helpers, así que lo sacamos de /api/pets/mine? No expone owner_id
	// directamente tampoco — lo sacamos del propio pet creado (owner_id).

	// ── Mascota 1: se registra y se queda "registered" (privada) ──
	createBody, _ := json.Marshal(map[string]interface{}{
		"name": "Privada",
		"type": "perro",
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create privada: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create privada: want 201, got %d", resp.StatusCode)
	}
	var privada struct {
		ID      string  `json:"id"`
		Status  string  `json:"status"`
		OwnerID *string `json:"owner_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&privada); err != nil {
		t.Fatalf("create privada: decode failed: %v", err)
	}
	if privada.Status != "registered" {
		t.Fatalf("expected status 'registered', got %q", privada.Status)
	}
	if privada.OwnerID == nil {
		t.Fatal("expected owner_id to be set")
	}
	ownerID := *privada.OwnerID

	// ── Mascota 2: se registra y se publica como perdida (pública) ──
	createBody2, _ := json.Marshal(map[string]interface{}{
		"name": "Publica",
		"type": "perro",
	})
	req2, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody2))
	req2.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req2.Header.Set("Content-Type", "application/json")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("create publica: request failed: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusCreated {
		t.Fatalf("create publica: want 201, got %d", resp2.StatusCode)
	}
	var publica struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&publica); err != nil {
		t.Fatalf("create publica: decode failed: %v", err)
	}

	publishBody, _ := json.Marshal(map[string]interface{}{
		"latitude":  -34.9011,
		"longitude": -56.1645,
		"note":      "Se escapó",
	})
	req3, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets/"+publica.ID+"/publish-lost", bytes.NewReader(publishBody))
	req3.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req3.Header.Set("Content-Type", "application/json")
	resp3, err := http.DefaultClient.Do(req3)
	if err != nil {
		t.Fatalf("publish-lost: request failed: %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK {
		t.Fatalf("publish-lost: want 200, got %d", resp3.StatusCode)
	}

	// ── GET /api/users/:id/pets SIN Authorization header ──────────
	resp4, err := http.Get(baseURL + "/api/users/" + ownerID + "/pets")
	if err != nil {
		t.Fatalf("get public pets: request failed: %v", err)
	}
	defer resp4.Body.Close()
	if resp4.StatusCode != http.StatusOK {
		t.Fatalf("get public pets: want 200, got %d", resp4.StatusCode)
	}

	var pets []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp4.Body).Decode(&pets); err != nil {
		t.Fatalf("get public pets: decode failed: %v", err)
	}

	foundPublica := false
	for _, p := range pets {
		if p.ID == privada.ID {
			t.Errorf("FUGA: la mascota privada (%s, status=%q) apareció en el perfil público", privada.ID, p.Status)
		}
		if p.Status == "registered" || p.Status == "archived" {
			t.Errorf("FUGA: apareció una mascota en estado privado %q", p.Status)
		}
		if p.ID == publica.ID {
			foundPublica = true
			if p.Status != "lost" {
				t.Errorf("expected 'lost', got %q", p.Status)
			}
		}
	}
	if !foundPublica {
		t.Fatalf("la mascota publicada (lost) no apareció en el perfil público: %+v", pets)
	}

	// ── X-Total-Count coincide con la cantidad devuelta (bajo el tope) ──
	totalHeader := resp4.Header.Get("X-Total-Count")
	if totalHeader == "" {
		t.Fatal("expected X-Total-Count header to be present")
	}
	total, err := strconv.Atoi(totalHeader)
	if err != nil {
		t.Fatalf("X-Total-Count no es un número: %q", totalHeader)
	}
	if total != len(pets) {
		t.Errorf("X-Total-Count = %d, pero se devolvieron %d items", total, len(pets))
	}
}

// TestPublicProfilePetsFlow_UUIDMalformado_400SinFiltracionDeDriver cubre el
// guard de entrada: un :id que no parsea como UUID nunca debe llegar al
// repositorio, y el cuerpo del 400 no puede traer texto del driver de
// Postgres (host, usuario, nombre de la base) — writeError siempre traduce a
// {code,message} (regla #11 de CLAUDE.md), pero este test lo prueba en vivo
// contra el endpoint nuevo en vez de asumirlo.
func TestPublicProfilePetsFlow_UUIDMalformado_400SinFiltracionDeDriver(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	resp, err := http.Get(baseURL + "/api/users/no-es-un-uuid/pets")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", resp.StatusCode)
	}

	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	rawBody := new(bytes.Buffer)
	if _, err := rawBody.ReadFrom(resp.Body); err != nil {
		t.Fatalf("reading body failed: %v", err)
	}
	if err := json.Unmarshal(rawBody.Bytes(), &body); err != nil {
		t.Fatalf("decode failed: %v (body: %s)", err, rawBody.String())
	}
	if body.Code == "" {
		t.Error("expected a non-empty error code")
	}

	lower := strings.ToLower(rawBody.String())
	forbidden := []string{"sqlstate", "pq:", "pgconn", "postgres", "database_url", "gorm", "5433", "5432"}
	for _, needle := range forbidden {
		if strings.Contains(lower, needle) {
			t.Errorf("el cuerpo del error filtra texto del driver: contiene %q — body: %s", needle, rawBody.String())
		}
	}
}
