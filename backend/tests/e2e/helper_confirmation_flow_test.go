//go:build e2e

package e2e_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

type hcResp struct {
	Status int
	Body   []byte
}

func hcDo(t *testing.T, method, url, token string, body interface{}) hcResp {
	t.Helper()
	resp := adoptionAuthedRequest(t, method, url, token, body)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, url, err)
	}
	return hcResp{Status: resp.StatusCode, Body: raw}
}

func hcDecode(t *testing.T, r hcResp, into interface{}) {
	t.Helper()
	if err := json.Unmarshal(r.Body, into); err != nil {
		t.Fatalf("decode %q: %v", string(r.Body), err)
	}
}

// TestHelperConfirmationFlow_OwnerPicksWhoHelped recorre la feature entera por
// HTTP contra Postgres real: el dueno no puede cerrar la mascota sin contestar,
// el selector lista a quien reporto, un id ajeno se rechaza, y lo elegido cobra
// el "Encontradas" de su perfil mientras el dueno no cobra nada. Cubre la puerta
// PATCH /found; las otras dos puertas las cubre tests/helper_confirmation_flow_test.go.
func TestHelperConfirmationFlow_OwnerPicksWhoHelped(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	ownerToken, _ := registerAndLogin(t, baseURL)
	helperToken, _ := registerAndLogin(t, baseURL)
	strangerToken, _ := registerAndLogin(t, baseURL)

	var me struct {
		ID string `json:"id"`
	}
	r := hcDo(t, http.MethodGet, baseURL+"/api/auth/me", helperToken, nil)
	if r.Status != http.StatusOK {
		t.Fatalf("me (helper): %d %s", r.Status, r.Body)
	}
	hcDecode(t, r, &me)
	helperID := me.ID
	r = hcDo(t, http.MethodGet, baseURL+"/api/auth/me", strangerToken, nil)
	hcDecode(t, r, &me)
	strangerID := me.ID
	r = hcDo(t, http.MethodGet, baseURL+"/api/auth/me", ownerToken, nil)
	hcDecode(t, r, &me)
	ownerID := me.ID

	// Pet perdida del dueno.
	r = hcDo(t, http.MethodPost, baseURL+"/api/pets", ownerToken, map[string]interface{}{"name": "Rex", "type": "perro"})
	if r.Status != http.StatusCreated {
		t.Fatalf("create pet: %d %s", r.Status, r.Body)
	}
	var pet struct {
		ID string `json:"id"`
	}
	hcDecode(t, r, &pet)
	r = hcDo(t, http.MethodPost, baseURL+"/api/pets/"+pet.ID+"/publish-lost", ownerToken, map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645})
	if r.Status != http.StatusOK {
		t.Fatalf("publish-lost: %d %s", r.Status, r.Body)
	}

	// Sin reportes ajenos no hay candidatos: el selector llega vacio.
	r = hcDo(t, http.MethodGet, baseURL+"/api/pets/"+pet.ID+"/helper-candidates", ownerToken, nil)
	if r.Status != http.StatusOK || string(r.Body) != "[]" {
		t.Fatalf("candidates before any sighting: want 200 [], got %d %s", r.Status, r.Body)
	}

	// El ayudante avista a la mascota.
	r = hcDo(t, http.MethodPost, baseURL+"/api/reports", helperToken, map[string]interface{}{
		"pet_id": pet.ID, "status": "sighting", "latitude": -34.9, "longitude": -56.16,
	})
	if r.Status != http.StatusCreated {
		t.Fatalf("sighting: %d %s", r.Status, r.Body)
	}

	// El dueno ve al ayudante; un tercero no puede ver la lista.
	r = hcDo(t, http.MethodGet, baseURL+"/api/pets/"+pet.ID+"/helper-candidates", ownerToken, nil)
	var cands []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	hcDecode(t, r, &cands)
	if r.Status != http.StatusOK || len(cands) != 1 || cands[0].ID != helperID || cands[0].Email != "" {
		t.Fatalf("owner candidates: want exactly the helper without email, got %d %s", r.Status, r.Body)
	}
	r = hcDo(t, http.MethodGet, baseURL+"/api/pets/"+pet.ID+"/helper-candidates", strangerToken, nil)
	if r.Status != http.StatusForbidden {
		t.Fatalf("non-owner candidates: want 403, got %d %s", r.Status, r.Body)
	}

	assertCode := func(r hcResp, status int, code string) {
		t.Helper()
		var e struct {
			Code string `json:"code"`
		}
		hcDecode(t, r, &e)
		if r.Status != status || e.Code != code {
			t.Fatalf("want %d %s, got %d %s", status, code, r.Status, r.Body)
		}
	}

	// Contestar es obligatorio: sin cuerpo, 400 y la mascota sigue perdida.
	assertCode(hcDo(t, http.MethodPatch, baseURL+"/api/pets/"+pet.ID+"/found", ownerToken, nil), http.StatusBadRequest, "helper_ids_required")
	// Un id que no es candidato (ni el propio dueno) se rechaza.
	assertCode(hcDo(t, http.MethodPatch, baseURL+"/api/pets/"+pet.ID+"/found", ownerToken, map[string]interface{}{"helper_ids": []string{strangerID}}), http.StatusBadRequest, "invalid_helpers")
	assertCode(hcDo(t, http.MethodPatch, baseURL+"/api/pets/"+pet.ID+"/found", ownerToken, map[string]interface{}{"helper_ids": []string{ownerID}}), http.StatusBadRequest, "invalid_helpers")
	r = hcDo(t, http.MethodGet, baseURL+"/api/pets/"+pet.ID, ownerToken, nil)
	var cur struct {
		Status string `json:"status"`
	}
	hcDecode(t, r, &cur)
	if cur.Status != "lost" {
		t.Fatalf("rejected requests must leave the pet lost, got %q", cur.Status)
	}

	// Antes de cerrar, el perfil del ayudante no tiene "Encontradas".
	profile := func(id string) (found int) {
		t.Helper()
		resp, err := http.Get(baseURL + "/api/users/" + id + "/profile")
		if err != nil {
			t.Fatalf("profile %s: %v", id, err)
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("profile %s: read: %v", id, err)
		}
		r := hcResp{Status: resp.StatusCode, Body: raw}
		var p struct {
			FoundCount int `json:"found_count"`
		}
		hcDecode(t, r, &p)
		if r.Status != http.StatusOK {
			t.Fatalf("profile %s: %d %s", id, r.Status, r.Body)
		}
		return p.FoundCount
	}
	if got := profile(helperID); got != 0 {
		t.Fatalf("helper found_count before the confirmation: want 0, got %d", got)
	}

	// Ahora si: el dueno confirma al ayudante.
	r = hcDo(t, http.MethodPatch, baseURL+"/api/pets/"+pet.ID+"/found", ownerToken, map[string]interface{}{"helper_ids": []string{helperID}})
	if r.Status != http.StatusOK {
		t.Fatalf("confirm: want 200, got %d %s", r.Status, r.Body)
	}
	if got := profile(helperID); got != 1 {
		t.Fatalf("helper found_count after the confirmation: want 1, got %d", got)
	}
	if got := profile(ownerID); got != 0 {
		t.Fatalf("owner must not earn found_count for their own pet, got %d", got)
	}
	if got := profile(strangerID); got != 0 {
		t.Fatalf("stranger found_count: want 0, got %d", got)
	}

	// Un reintento sobre la mascota ya encontrada devuelve 200 sin exigir la lista.
	r = hcDo(t, http.MethodPatch, baseURL+"/api/pets/"+pet.ID+"/found", ownerToken, nil)
	if r.Status != http.StatusOK {
		t.Fatalf("retry: want 200, got %d %s", r.Status, r.Body)
	}
	if got := profile(helperID); got != 1 {
		t.Fatalf("a retry must not credit twice: found_count %d", got)
	}
}
