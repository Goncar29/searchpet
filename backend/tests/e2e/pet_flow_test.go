//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestPetFlow_FullCRUD(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// ── POST /api/pets ────────────────────────────────────────────
	createBody, _ := json.Marshal(map[string]interface{}{
		"name": "TestPet",
		"type": "perro",
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create pet: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create pet: want 201, got %d", resp.StatusCode)
	}

	var created struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("create pet: decode failed: %v", err)
	}
	if created.ID == "" {
		t.Fatal("create pet: returned empty ID")
	}

	// ── GET /api/pets/:id ─────────────────────────────────────────
	resp2, err := http.Get(baseURL + "/api/pets/" + created.ID)
	if err != nil {
		t.Fatalf("get pet: request failed: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("get pet: want 200, got %d", resp2.StatusCode)
	}

	// ── PUT /api/pets/:id — change name ───────────────────────────
	updateBody, _ := json.Marshal(map[string]interface{}{
		"name": "UpdatedPet",
	})
	putReq, _ := http.NewRequest(http.MethodPut, baseURL+"/api/pets/"+created.ID, bytes.NewReader(updateBody))
	putReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	putReq.Header.Set("Content-Type", "application/json")

	resp3, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("update pet: request failed: %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK {
		t.Fatalf("update pet: want 200, got %d", resp3.StatusCode)
	}

	// ── GET /api/pets/:id — assert new name ───────────────────────
	resp4, err := http.Get(baseURL + "/api/pets/" + created.ID)
	if err != nil {
		t.Fatalf("get updated pet: request failed: %v", err)
	}
	defer resp4.Body.Close()
	var updated struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp4.Body).Decode(&updated); err != nil {
		t.Fatalf("get updated pet: decode failed: %v", err)
	}
	if updated.Name != "UpdatedPet" {
		t.Errorf("want name %q, got %q", "UpdatedPet", updated.Name)
	}

	// ── DELETE /api/pets/:id ──────────────────────────────────────
	delReq, _ := http.NewRequest(http.MethodDelete, baseURL+"/api/pets/"+created.ID, nil)
	delReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp5, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("delete pet: request failed: %v", err)
	}
	defer resp5.Body.Close()
	if resp5.StatusCode != http.StatusOK && resp5.StatusCode != http.StatusNoContent {
		t.Fatalf("delete pet: want 200/204, got %d", resp5.StatusCode)
	}

	// ── GET /api/pets/:id — assert 404 ───────────────────────────
	resp6, err := http.Get(baseURL + "/api/pets/" + created.ID)
	if err != nil {
		t.Fatalf("get deleted pet: request failed: %v", err)
	}
	defer resp6.Body.Close()
	if resp6.StatusCode != http.StatusNotFound {
		t.Errorf("want 404 after delete, got %d", resp6.StatusCode)
	}
}

func TestPetFlow_UnauthenticatedCreate(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	body, _ := json.Marshal(map[string]interface{}{
		"name": "TestPet",
		"type": "perro",
	})
	resp, err := http.Post(baseURL+"/api/pets", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("want 401 without token, got %d", resp.StatusCode)
	}
}
