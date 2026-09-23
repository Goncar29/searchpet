//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// TestPetOwnerPhoneVisibility_FullFlow reproduce contra Postgres real el
// hallazgo de la auditoría del 2026-09-23: GET /api/pets/:id es público y
// FindByID precargaba Owner sin filtrar por status, así que cualquiera con el
// UUID de una mascota "registered" obtenía el teléfono del dueño.
//
// Ejercita el camino COMPLETO — router real (app.SetupRouter), JWT real,
// middleware.OptionalAuth real — no sólo el mock del handler test. Cubre las
// tres ramas del acceptance criteria en una sola mascota, siguiendo su
// transición real de estado en vez de fabricar un domain.Pet a mano:
//   1. "registered" + anónimo → sin teléfono
//   2. "registered" + dueño autenticado → con teléfono
//   3. "registered" + otro usuario autenticado → sin teléfono
//   4. "lost" (tras publish-lost) + anónimo → con teléfono
func TestPetOwnerPhoneVisibility_FullFlow(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	ownerToken, _ := registerAndLogin(t, baseURL)
	otherToken, _ := registerAndLogin(t, baseURL)

	// El dueño carga su teléfono — sin esto no hay nada que exponer u ocultar.
	const ownerPhone = "+59899123456"
	profileBody, _ := json.Marshal(map[string]interface{}{"phone": ownerPhone})
	profileReq, _ := http.NewRequest(http.MethodPut, baseURL+"/api/auth/me", bytes.NewReader(profileBody))
	profileReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", ownerToken))
	profileReq.Header.Set("Content-Type", "application/json")
	profileResp, err := http.DefaultClient.Do(profileReq)
	if err != nil {
		t.Fatalf("update profile: request failed: %v", err)
	}
	defer profileResp.Body.Close()
	if profileResp.StatusCode != http.StatusOK {
		t.Fatalf("update profile: want 200, got %d", profileResp.StatusCode)
	}

	// Crea la mascota — status por defecto "registered".
	createBody, _ := json.Marshal(map[string]interface{}{
		"name": "PhoneVisibilityPet",
		"type": "perro",
	})
	createReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	createReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", ownerToken))
	createReq.Header.Set("Content-Type", "application/json")
	createResp, err := http.DefaultClient.Do(createReq)
	if err != nil {
		t.Fatalf("create pet: request failed: %v", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create pet: want 201, got %d", createResp.StatusCode)
	}
	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("create pet: decode failed: %v", err)
	}
	if created.Status != "registered" {
		t.Fatalf("expected default status 'registered', got %q", created.Status)
	}

	getPhone := func(t *testing.T, token string) string {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, baseURL+"/api/pets/"+created.ID, nil)
		if token != "" {
			req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("get pet: request failed: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("get pet: want 200, got %d", resp.StatusCode)
		}
		var body struct {
			Owner *struct {
				Phone string `json:"phone"`
			} `json:"owner"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatalf("get pet: decode failed: %v", err)
		}
		if body.Owner == nil {
			return ""
		}
		return body.Owner.Phone
	}

	if phone := getPhone(t, ""); phone != "" {
		t.Errorf("registered + anónimo: esperaba sin teléfono, vino %q", phone)
	}
	if phone := getPhone(t, ownerToken); phone != ownerPhone {
		t.Errorf("registered + dueño: esperaba %q, vino %q", ownerPhone, phone)
	}
	if phone := getPhone(t, otherToken); phone != "" {
		t.Errorf("registered + otro usuario: esperaba sin teléfono, vino %q", phone)
	}

	// Transición real a "lost" — no fabricamos el estado, lo alcanzamos vía la
	// API igual que un usuario real.
	publishBody, _ := json.Marshal(map[string]interface{}{
		"latitude":  -34.9011,
		"longitude": -56.1645,
		"note":      "se escapó por el patio",
	})
	publishReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets/"+created.ID+"/publish-lost", bytes.NewReader(publishBody))
	publishReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", ownerToken))
	publishReq.Header.Set("Content-Type", "application/json")
	publishResp, err := http.DefaultClient.Do(publishReq)
	if err != nil {
		t.Fatalf("publish-lost: request failed: %v", err)
	}
	defer publishResp.Body.Close()
	if publishResp.StatusCode != http.StatusOK {
		t.Fatalf("publish-lost: want 200, got %d", publishResp.StatusCode)
	}

	if phone := getPhone(t, ""); phone != ownerPhone {
		t.Errorf("lost + anónimo: esperaba %q, vino %q", ownerPhone, phone)
	}
}
