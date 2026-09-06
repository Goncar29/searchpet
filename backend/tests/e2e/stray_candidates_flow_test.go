//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// TestStrayCandidatesFlow_ExigeSesionYDevuelveElCallejeroCercano cubre el
// camino feliz de GET /api/pets/stray-candidates: es un endpoint PROTEGIDO
// (a diferencia de /api/pets/search, que es público — ver CLAUDE.md), y
// devuelve un callejero real dentro del radio de 1 km sin aplicarle la
// caducidad de 90 días que sí aplica el feed (issue #221).
func TestStrayCandidatesFlow_ExigeSesionYDevuelveElCallejeroCercano(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	const lat, lng = -34.9011, -56.1645
	// Punto vecino a ~300m al norte: 1 grado de latitud ≈ 111320 m en el
	// elipsoide, así que 300/111320 grados desplaza ~300m sin tocar la
	// longitud (evita el término coseno de la latitud, innecesario a esta
	// escala).
	const neighbourLat = lat + 300.0/111320.0

	url := fmt.Sprintf("%s/api/pets/stray-candidates?lat=%f&lng=%f&type=perro", baseURL, lat, lng)

	// ── SIN token: 401, ni siquiera llega a validar coordenadas ──────
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("get sin token: request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("get sin token: want 401, got %d", resp.StatusCode)
	}

	token, _ := registerAndLogin(t, baseURL)

	// ── Se crea el callejero: initial_report es OBLIGATORIO para status
	// "stray" (el service lo rechaza con 400 initial_report_required si
	// falta — ver pet_service.go), así que la "vista" que va a aparecer en
	// stray-candidates nace de este mismo POST, no de un reporte aparte.
	occurredAt := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	createBody, _ := json.Marshal(map[string]interface{}{
		"name":   "Callejero",
		"type":   "perro",
		"status": "stray",
		"initial_report": map[string]interface{}{
			"latitude":    neighbourLat,
			"longitude":   lng,
			"note":        "visto en la esquina",
			"occurred_at": occurredAt,
		},
	})
	createReq, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(createBody))
	createReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	createReq.Header.Set("Content-Type", "application/json")
	createResp, err := http.DefaultClient.Do(createReq)
	if err != nil {
		t.Fatalf("create stray: request failed: %v", err)
	}
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create stray: want 201, got %d", createResp.StatusCode)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&created); err != nil {
		t.Fatalf("create stray: decode failed: %v", err)
	}

	// ── CON token: 200, y el callejero recién creado aparece ─────────
	getReq, _ := http.NewRequest(http.MethodGet, url, nil)
	getReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	getResp, err := http.DefaultClient.Do(getReq)
	if err != nil {
		t.Fatalf("get con token: request failed: %v", err)
	}
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get con token: want 200, got %d", getResp.StatusCode)
	}

	var candidates []struct {
		ID             string    `json:"id"`
		LastSeenAt     time.Time `json:"last_seen_at"`
		DistanceMeters float64   `json:"distance_meters"`
	}
	if err := json.NewDecoder(getResp.Body).Decode(&candidates); err != nil {
		t.Fatalf("get con token: decode failed: %v", err)
	}

	var match *struct {
		ID             string    `json:"id"`
		LastSeenAt     time.Time `json:"last_seen_at"`
		DistanceMeters float64   `json:"distance_meters"`
	}
	for i := range candidates {
		if candidates[i].ID == created.ID {
			match = &candidates[i]
			break
		}
	}
	if match == nil {
		t.Fatalf("el callejero creado no apareció entre los candidatos: se devolvieron %d resultados", len(candidates))
	}
	if match.DistanceMeters < 250 || match.DistanceMeters > 350 {
		t.Errorf("expected distance_meters entre 250 y 350 (desplazamos ~300m), got %f", match.DistanceMeters)
	}
	if match.LastSeenAt.IsZero() {
		t.Error("expected last_seen_at distinto de cero")
	}
}

// TestStrayCandidatesFlow_CoordenadasInvalidasSon400 cubre el guard de
// entrada del handler: ParseFloat que falla, o coordenadas fuera de rango
// que sí parsean, tienen que devolver 400 antes de tocar el repositorio.
func TestStrayCandidatesFlow_CoordenadasInvalidasSon400(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	cases := []string{
		"lat=999&lng=-56",  // parsea, pero fuera de [-90,90] — lo atrapa validCoordinates
		"lat=abc&lng=-56",  // ParseFloat falla derecho
		"lng=-56",          // falta lat: Query("lat") es "" y ParseFloat("") falla
		// "NaN" es el caso interesante: strconv.ParseFloat("NaN", 64) NO
		// falla (Go lo parsea a math.NaN() sin error), así que el primer
		// guard (errLat != nil) no lo atrapa. Lo que sí lo atrapa es
		// validCoordinates: toda comparación con NaN da false en Go, así
		// que `lat >= -90 && lat <= 90 && ...` es false para NaN sin
		// importar el orden de los operandos, y la función devuelve false
		// igual que con cualquier coordenada fuera de rango. Confirmado
		// leyendo el handler antes de escribir este caso, no asumido.
		"lat=NaN&lng=-56",
	}

	for _, query := range cases {
		url := fmt.Sprintf("%s/api/pets/stray-candidates?%s", baseURL, query)
		req, _ := http.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("query %q: request failed: %v", query, err)
		}
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("query %q: want 400, got %d", query, resp.StatusCode)
		}
		resp.Body.Close()
	}
}
