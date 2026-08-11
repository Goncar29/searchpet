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

// createPet is a small helper used by report flow tests to quickly seed a pet.
func createPet(t *testing.T, baseURL, token, name string) string {
	t.Helper()

	body, _ := json.Marshal(map[string]interface{}{
		"name": name,
		"type": "perro",
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(body))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("createPet: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("createPet: want 201, got %d", resp.StatusCode)
	}

	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("createPet: decode failed: %v", err)
	}
	return result.ID
}

func TestReportFlow_NearbySearch(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	petID := createPet(t, baseURL, token, "NearbyPet")

	// POST /api/reports — Montevideo coordinates. A "lost" report transitions
	// the pet to lost (a feed-visible status), so it shows on the nearby map.
	reportBody, _ := json.Marshal(map[string]interface{}{
		"pet_id":    petID,
		"status":    "lost",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/reports", bytes.NewReader(reportBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create report: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create report: want 201, got %d", resp.StatusCode)
	}

	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("create report: decode failed: %v", err)
	}

	// GET /api/reports/nearby — same coords, 5 km radius
	params := url.Values{}
	params.Set("lat", "-34.9011")
	params.Set("lng", "-56.1645")
	params.Set("radius", "5000")

	nearbyResp, err := http.Get(baseURL + "/api/reports/nearby?" + params.Encode())
	if err != nil {
		t.Fatalf("nearby: request failed: %v", err)
	}
	defer nearbyResp.Body.Close()
	if nearbyResp.StatusCode != http.StatusOK {
		t.Fatalf("nearby: want 200, got %d", nearbyResp.StatusCode)
	}

	var nearby struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(nearbyResp.Body).Decode(&nearby); err != nil {
		t.Fatalf("nearby: decode failed: %v", err)
	}

	found := false
	for _, r := range nearby.Data {
		if r.ID == created.ID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected report %q to appear in nearby results", created.ID)
	}
}

func TestReportFlow_OutOfRadius(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	petID := createPet(t, baseURL, token, "FarPet")

	// Create report at Montevideo (-34.9011, -56.1645). "lost" makes the pet
	// feed-visible so the only reason it's absent below is the distance filter.
	reportBody, _ := json.Marshal(map[string]interface{}{
		"pet_id":    petID,
		"status":    "lost",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/reports", bytes.NewReader(reportBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create report: request failed: %v", err)
	}
	defer resp.Body.Close()

	var created struct {
		ID string `json:"id"`
	}
	json.NewDecoder(resp.Body).Decode(&created)

	// Search from Buenos Aires (~200 km away) with 1 km radius — should NOT find the report
	params := url.Values{}
	params.Set("lat", "-34.6037")  // Buenos Aires
	params.Set("lng", "-58.3816")
	params.Set("radius", "1000")

	nearbyResp, err := http.Get(baseURL + "/api/reports/nearby?" + params.Encode())
	if err != nil {
		t.Fatalf("nearby: request failed: %v", err)
	}
	defer nearbyResp.Body.Close()

	var nearby struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.NewDecoder(nearbyResp.Body).Decode(&nearby)

	for _, r := range nearby.Data {
		if r.ID == created.ID {
			t.Errorf("report %q should NOT appear in results far from its location", created.ID)
		}
	}
}

// TestReportFlow_NearbyFiltra ejercita los filtros nuevos contra el servidor
// real, que es donde se ve lo que los tests de repositorio no pueden ver: el
// parseo del query string, la validación y el armado del criteria, todo junto.
//
// createPet siembra siempre "type": "perro", que es lo que hace significativa
// la aserción de type=gato.
func TestReportFlow_NearbyFiltra(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	petID := createPet(t, baseURL, token, "Filtrable")

	reportBody, _ := json.Marshal(map[string]interface{}{
		"pet_id":    petID,
		"status":    "lost",
		"latitude":  -34.9011,
		"longitude": -56.1645,
	})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/reports", bytes.NewReader(reportBody))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create report: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create report: want 201, got %d", resp.StatusCode)
	}

	contar := func(t *testing.T, query string) int {
		t.Helper()
		r, err := http.Get(baseURL + "/api/reports/nearby?" + query)
		if err != nil {
			t.Fatalf("nearby %q: %v", query, err)
		}
		defer r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Fatalf("nearby %q: want 200, got %d", query, r.StatusCode)
		}
		var out struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.NewDecoder(r.Body).Decode(&out); err != nil {
			t.Fatalf("nearby %q: decode: %v", query, err)
		}
		return len(out.Data)
	}

	base := "lat=-34.9011&lng=-56.1645&radius=5000"

	if n := contar(t, base); n != 1 {
		t.Fatalf("sin filtros esperaba 1 reporte, obtuve %d", n)
	}
	if n := contar(t, base+"&type=perro"); n != 1 {
		t.Fatalf("filtrando por perro esperaba 1 reporte, obtuve %d", n)
	}
	if n := contar(t, base+"&type=gato"); n != 0 {
		t.Fatalf("filtrando por gato esperaba 0 reportes, obtuve %d", n)
	}
	if n := contar(t, base+"&status=lost"); n != 1 {
		t.Fatalf("filtrando por lost esperaba 1 reporte, obtuve %d", n)
	}
	if n := contar(t, base+"&status=found"); n != 0 {
		t.Fatalf("filtrando por found esperaba 0 reportes, obtuve %d", n)
	}
	// Combinados: tipo correcto con un estado que el reporte no tiene.
	if n := contar(t, base+"&type=perro&status=found"); n != 0 {
		t.Fatalf("tipo correcto + estado ajeno esperaba 0, obtuve %d", n)
	}

	// Un tipo invalido es 400, no un 200 con lista vacia.
	invalida, err := http.Get(baseURL + "/api/reports/nearby?" + base + "&type=dinosaurio")
	if err != nil {
		t.Fatalf("nearby type invalido: %v", err)
	}
	defer invalida.Body.Close()
	if invalida.StatusCode != http.StatusBadRequest {
		t.Fatalf("type invalido: want 400, got %d", invalida.StatusCode)
	}
}
