//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
)

// TestPublishFlow_RegisterPetThenPublishLost covers the redesigned publish flow:
// a pet is registered without an initial report (status defaults to "registered"),
// then published as lost via POST /api/pets/:id/publish-lost, which transitions
// the pet to "lost" and creates its initial location report in one transaction.
// The report must then be discoverable via GET /api/reports/nearby.
func TestPublishFlow_RegisterPetThenPublishLost(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// ── Step 1: register a pet (status omitted → "registered") ─────
	createBody, _ := json.Marshal(map[string]interface{}{
		"name": "Rex",
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
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("create pet: decode failed: %v", err)
	}
	if created.Status != "registered" {
		t.Fatalf("expected status 'registered', got %q", created.Status)
	}

	// ── Step 2: publish-lost ─────────────────────────────────────
	publishBody, _ := json.Marshal(map[string]interface{}{
		"latitude":  -34.9011,
		"longitude": -56.1645,
		"note":      "Se escapó por el portón",
	})
	req2, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets/"+created.ID+"/publish-lost", bytes.NewReader(publishBody))
	req2.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req2.Header.Set("Content-Type", "application/json")

	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("publish-lost: request failed: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("publish-lost: want 200, got %d", resp2.StatusCode)
	}

	var published struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&published); err != nil {
		t.Fatalf("publish-lost: decode failed: %v", err)
	}
	if published.Status != "lost" {
		t.Fatalf("expected status 'lost', got %q", published.Status)
	}

	// ── Step 3: GET /api/reports/nearby returns the new report ────
	params := url.Values{}
	params.Set("lat", "-34.9011")
	params.Set("lng", "-56.1645")
	params.Set("radius", "5000")

	resp3, err := http.Get(baseURL + "/api/reports/nearby?" + params.Encode())
	if err != nil {
		t.Fatalf("nearby: request failed: %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK {
		t.Fatalf("nearby: want 200, got %d", resp3.StatusCode)
	}

	var nearby struct {
		Data []struct {
			PetID  string `json:"pet_id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp3.Body).Decode(&nearby); err != nil {
		t.Fatalf("nearby: decode failed: %v", err)
	}
	found := false
	for _, r := range nearby.Data {
		if r.PetID == created.ID && r.Status == "lost" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected nearby reports to include pet %s with status 'lost'", created.ID)
	}
}

// TestPublishFlow_CreateStrayWithInitialReport covers creating a stray pet with
// an initial_report in the same atomic request. The resulting pet has no owner
// and a single "sighting" report is created for it.
//
// Name is required by CreatePetRequest (binding:"required"), so we send a named
// stray directly — no retry-on-400 dance needed.
func TestPublishFlow_CreateStrayWithInitialReport(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	createBody, _ := json.Marshal(map[string]interface{}{
		"name":   "Sin nombre",
		"type":   "gato",
		"status": "stray",
		"initial_report": map[string]interface{}{
			"latitude":  -34.9011,
			"longitude": -56.1645,
			"note":      "Gato gris visto en la plaza",
		},
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create stray: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create stray: want 201, got %d", resp.StatusCode)
	}

	var created struct {
		ID      string  `json:"id"`
		Status  string  `json:"status"`
		OwnerID *string `json:"owner_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("create stray: decode failed: %v", err)
	}
	if created.Status != "stray" {
		t.Fatalf("expected status 'stray', got %q", created.Status)
	}
	if created.OwnerID != nil {
		t.Errorf("expected owner_id to be nil for stray pets, got %v", *created.OwnerID)
	}

	// GET /api/reports/pet/:petId is public — no auth needed.
	resp2, err := http.Get(baseURL + "/api/reports/pet/" + created.ID)
	if err != nil {
		t.Fatalf("reports/pet: request failed: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("reports/pet: want 200, got %d", resp2.StatusCode)
	}

	var reports []struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&reports); err != nil {
		t.Fatalf("reports/pet: decode failed: %v", err)
	}
	if len(reports) != 1 || reports[0].Status != "sighting" {
		t.Fatalf("expected 1 'sighting' report, got %+v", reports)
	}
}
