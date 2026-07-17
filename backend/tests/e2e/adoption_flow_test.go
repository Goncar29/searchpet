//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// adoptionPetResponse mirrors the subset of dto.PetResponse this flow cares about.
type adoptionPetResponse struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	City    string `json:"city"`
	OwnerID string `json:"owner_id"`
	Version int    `json:"version"`
}

type adoptionSearchResponse struct {
	Data  []adoptionPetResponse `json:"data"`
	Total int64                 `json:"total"`
	Page  int                   `json:"page"`
	Limit int                   `json:"limit"`
}

// adoptionAuthedRequest performs an authenticated JSON request against baseURL
// and returns the raw *http.Response for the caller to assert on.
func adoptionAuthedRequest(t *testing.T, method, url, token string, body interface{}) *http.Response {
	t.Helper()

	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}

	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: request failed: %v", method, url, err)
	}
	return resp
}

// containsPetID reports whether the given pet ID appears in the adoption
// listing's data slice.
func containsPetID(data []adoptionPetResponse, id string) bool {
	for _, p := range data {
		if p.ID == id {
			return true
		}
	}
	return false
}

// TestAdoptionFlow_ListingAndLostSearchIsolation is the key end-to-end guard
// for the pet-adoption-listings feature's core invariant: adoption listings
// must never leak into the lost-pet search/feed, and the adoption cluster
// (adoption <-> adopted) must never cross into the lost cluster via a status
// transition.
func TestAdoptionFlow_ListingAndLostSearchIsolation(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// ── 1. POST /api/pets — create an adoption listing ────────────────
	createBody := map[string]interface{}{
		"name":   "Firulais",
		"type":   "perro",
		"status": "adoption",
		"city":   "Montevideo",
	}
	createResp := adoptionAuthedRequest(t, http.MethodPost, baseURL+"/api/pets", token, createBody)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create adoption pet: want 201, got %d", createResp.StatusCode)
	}
	var created adoptionPetResponse
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("create adoption pet: decode failed: %v", err)
	}
	if created.ID == "" {
		t.Fatal("create adoption pet: returned empty ID")
	}
	if created.Status != "adoption" {
		t.Errorf("create adoption pet: status = %q, want %q", created.Status, "adoption")
	}
	if created.City != "Montevideo" {
		t.Errorf("create adoption pet: city = %q, want %q", created.City, "Montevideo")
	}
	if created.OwnerID == "" {
		t.Error("create adoption pet: expected owner_id to be present")
	}

	// ── 2. GET /api/adoptions — public, pet appears ───────────────────
	listResp, err := http.Get(baseURL + "/api/adoptions")
	if err != nil {
		t.Fatalf("list adoptions: request failed: %v", err)
	}
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list adoptions: want 200, got %d", listResp.StatusCode)
	}
	var listed adoptionSearchResponse
	if err := json.NewDecoder(listResp.Body).Decode(&listed); err != nil {
		t.Fatalf("list adoptions: decode failed: %v", err)
	}
	if !containsPetID(listed.Data, created.ID) {
		t.Errorf("list adoptions: expected pet %s in data, got %+v", created.ID, listed.Data)
	}

	// ── 3. GET /api/adoptions?city=montevideo — case-insensitive match ─
	cityMatchResp, err := http.Get(baseURL + "/api/adoptions?city=montevideo")
	if err != nil {
		t.Fatalf("list adoptions by city (match): request failed: %v", err)
	}
	defer cityMatchResp.Body.Close()
	if cityMatchResp.StatusCode != http.StatusOK {
		t.Fatalf("list adoptions by city (match): want 200, got %d", cityMatchResp.StatusCode)
	}
	var cityMatch adoptionSearchResponse
	if err := json.NewDecoder(cityMatchResp.Body).Decode(&cityMatch); err != nil {
		t.Fatalf("list adoptions by city (match): decode failed: %v", err)
	}
	if !containsPetID(cityMatch.Data, created.ID) {
		t.Errorf("list adoptions by city=montevideo: expected pet %s in data, got %+v", created.ID, cityMatch.Data)
	}

	// GET /api/adoptions?city=salto — no match
	cityMissResp, err := http.Get(baseURL + "/api/adoptions?city=salto")
	if err != nil {
		t.Fatalf("list adoptions by city (miss): request failed: %v", err)
	}
	defer cityMissResp.Body.Close()
	if cityMissResp.StatusCode != http.StatusOK {
		t.Fatalf("list adoptions by city (miss): want 200, got %d", cityMissResp.StatusCode)
	}
	var cityMiss adoptionSearchResponse
	if err := json.NewDecoder(cityMissResp.Body).Decode(&cityMiss); err != nil {
		t.Fatalf("list adoptions by city (miss): decode failed: %v", err)
	}
	if containsPetID(cityMiss.Data, created.ID) {
		t.Errorf("list adoptions by city=salto: pet %s should NOT appear, got %+v", created.ID, cityMiss.Data)
	}

	// ── 4. Isolation: GET /api/pets/search?status=lost — pet absent ───
	lostSearchResp, err := http.Get(baseURL + "/api/pets/search?status=lost")
	if err != nil {
		t.Fatalf("search status=lost: request failed: %v", err)
	}
	defer lostSearchResp.Body.Close()
	if lostSearchResp.StatusCode != http.StatusOK {
		t.Fatalf("search status=lost: want 200, got %d", lostSearchResp.StatusCode)
	}
	var lostSearch adoptionSearchResponse
	if err := json.NewDecoder(lostSearchResp.Body).Decode(&lostSearch); err != nil {
		t.Fatalf("search status=lost: decode failed: %v", err)
	}
	if containsPetID(lostSearch.Data, created.ID) {
		t.Errorf("search status=lost: adoption pet %s leaked into lost search, got %+v", created.ID, lostSearch.Data)
	}

	// ── 5. Isolation: GET /api/pets/search?status=adoption — 400 ──────
	adoptionSearchResp, err := http.Get(baseURL + "/api/pets/search?status=adoption")
	if err != nil {
		t.Fatalf("search status=adoption: request failed: %v", err)
	}
	defer adoptionSearchResp.Body.Close()
	if adoptionSearchResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("search status=adoption: want 400, got %d", adoptionSearchResp.StatusCode)
	}

	// ── 6. PUT /api/pets/:id — adoption -> adopted ─────────────────────
	adoptedResp := adoptionAuthedRequest(t, http.MethodPut, baseURL+"/api/pets/"+created.ID, token,
		map[string]interface{}{"status": "adopted", "version": created.Version})
	defer adoptedResp.Body.Close()
	if adoptedResp.StatusCode != http.StatusOK {
		t.Fatalf("update to adopted: want 200, got %d", adoptedResp.StatusCode)
	}
	var adopted adoptionPetResponse
	if err := json.NewDecoder(adoptedResp.Body).Decode(&adopted); err != nil {
		t.Fatalf("update to adopted: decode failed: %v", err)
	}
	if adopted.Status != "adopted" {
		t.Errorf("update to adopted: status = %q, want %q", adopted.Status, "adopted")
	}

	// ── 7. GET /api/adoptions — adopted pet no longer public ──────────
	afterAdoptedResp, err := http.Get(baseURL + "/api/adoptions")
	if err != nil {
		t.Fatalf("list adoptions after adopted: request failed: %v", err)
	}
	defer afterAdoptedResp.Body.Close()
	if afterAdoptedResp.StatusCode != http.StatusOK {
		t.Fatalf("list adoptions after adopted: want 200, got %d", afterAdoptedResp.StatusCode)
	}
	var afterAdopted adoptionSearchResponse
	if err := json.NewDecoder(afterAdoptedResp.Body).Decode(&afterAdopted); err != nil {
		t.Fatalf("list adoptions after adopted: decode failed: %v", err)
	}
	if containsPetID(afterAdopted.Data, created.ID) {
		t.Errorf("list adoptions after adopted: pet %s should NOT appear, got %+v", created.ID, afterAdopted.Data)
	}

	// ── 8. Isolation: PUT adopted -> lost — 422, no cross-cluster edge ─
	crossClusterResp := adoptionAuthedRequest(t, http.MethodPut, baseURL+"/api/pets/"+created.ID, token,
		map[string]interface{}{"status": "lost", "version": adopted.Version})
	defer crossClusterResp.Body.Close()
	if crossClusterResp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("update adopted -> lost: want 422, got %d", crossClusterResp.StatusCode)
	}
}
