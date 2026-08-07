//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// El par (birth_date, birth_date_precision) contra POSTGRES REAL, y no contra un
// mock, por el motivo más caro que aprendió este proyecto: los mocks de
// repositorio NO TIENEN COLUMNAS. No fallan por ancho, ni por NOT NULL, ni por
// tipo. Un `varchar(10)` que no entra ya dejó una feature entera como un no-op
// silencioso en producción mientras toda la suite pasaba en verde.
//
// Acá el riesgo es concreto y medible: la precisión 'month' son 5 caracteres y
// la columna se declara VARCHAR(10) en DOS lugares que tienen que coincidir —el
// tag del struct y la migración 000023—. Este test es lo único que ejecuta los
// dos caminos de creación de esquema contra la misma base.

type birthDatePetResponse struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Gender             string  `json:"gender"`
	BirthDate          *string `json:"birth_date"`
	BirthDatePrecision string  `json:"birth_date_precision"`
	Version            int     `json:"version"`
}

func birthDateRequest(t *testing.T, method, url, token string, body interface{}) *http.Response {
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
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
}

func TestPetBirthDate_GuardaYDevuelveElParContraPostgresReal(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// 'month' es la precisión más larga (5 chars). Si la columna quedara más
	// angosta que el tag, Postgres rechaza el insert con SQLSTATE 22001 y este
	// test se pone rojo — que es exactamente lo que ningún mock puede hacer.
	nacimiento := time.Date(2022, 3, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)

	crear := map[string]interface{}{
		"name":                 "Koda",
		"type":                 "perro",
		"gender":               "male",
		"birth_date":           nacimiento,
		"birth_date_precision": "month",
	}

	resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, crear)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("crear mascota: status %d, se esperaba 201", resp.StatusCode)
	}

	var creada birthDatePetResponse
	if err := json.NewDecoder(resp.Body).Decode(&creada); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if creada.BirthDatePrecision != "month" {
		t.Fatalf("precision guardada = %q, se esperaba \"month\"", creada.BirthDatePrecision)
	}
	if creada.BirthDate == nil {
		t.Fatal("birth_date volvió nil después de crearla")
	}
	if creada.Gender != "male" {
		t.Fatalf("gender guardado = %q, se esperaba \"male\"", creada.Gender)
	}

	// Releer por HTTP, no confiar en la respuesta del create: lo que se está
	// probando es que el dato SOBREVIVIÓ a la base, no que el handler lo eco.
	leer := birthDateRequest(t, http.MethodGet, baseURL+"/api/pets/"+creada.ID, token, nil)
	defer leer.Body.Close()
	if leer.StatusCode != http.StatusOK {
		t.Fatalf("leer mascota: status %d", leer.StatusCode)
	}

	var leida birthDatePetResponse
	if err := json.NewDecoder(leer.Body).Decode(&leida); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	if leida.BirthDatePrecision != "month" {
		t.Fatalf("precision releída = %q, se esperaba \"month\"", leida.BirthDatePrecision)
	}
	if leida.BirthDate == nil {
		t.Fatal("birth_date releído es nil: la columna no persistió el dato")
	}
}

func TestPetBirthDate_VaciarLaPrecisionBorraLaFecha(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	nacimiento := time.Date(2021, 7, 9, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	crear := map[string]interface{}{
		"name": "Michi", "type": "gato",
		"birth_date": nacimiento, "birth_date_precision": "day",
	}
	resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, crear)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("crear: status %d", resp.StatusCode)
	}
	var creada birthDatePetResponse
	if err := json.NewDecoder(resp.Body).Decode(&creada); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Mandar la precisión vacía es el ÚNICO interruptor para borrar el par: con
	// `birth_date` en nil no se puede distinguir "no lo mandé" de "borralo".
	limpiar := map[string]interface{}{
		"name": "Michi", "version": creada.Version,
		"birth_date_precision": "",
	}
	upd := birthDateRequest(t, http.MethodPut, baseURL+"/api/pets/"+creada.ID, token, limpiar)
	defer upd.Body.Close()
	if upd.StatusCode != http.StatusOK {
		t.Fatalf("update: status %d, se esperaba 200", upd.StatusCode)
	}

	var actualizada birthDatePetResponse
	if err := json.NewDecoder(upd.Body).Decode(&actualizada); err != nil {
		t.Fatalf("decode update: %v", err)
	}
	if actualizada.BirthDate != nil {
		t.Fatalf("birth_date quedó en %v: vaciar la precisión tiene que borrar la fecha, o queda una fecha huérfana que nadie puede mostrar sin mentir sobre cuánto se sabe", *actualizada.BirthDate)
	}
	if actualizada.BirthDatePrecision != "" {
		t.Fatalf("precision quedó en %q", actualizada.BirthDatePrecision)
	}
}

func TestPetBirthDate_RechazaElParIncoherente(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	casos := []struct {
		nombre string
		body   map[string]interface{}
	}{
		{
			// Fecha sin precisión: no se puede mostrar sin inventar cuánto se sabe.
			nombre: "fecha sin precision",
			body: map[string]interface{}{
				"name": "A", "type": "perro",
				"birth_date": time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339),
			},
		},
		{
			// Precisión sin fecha: afirma saber algo que no tiene.
			nombre: "precision sin fecha",
			body:   map[string]interface{}{"name": "B", "type": "perro", "birth_date_precision": "year"},
		},
		{
			nombre: "precision inventada",
			body: map[string]interface{}{
				"name": "C", "type": "perro",
				"birth_date":           time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339),
				"birth_date_precision": "decada",
			},
		},
		{
			// Una mascota no puede haber nacido mañana.
			nombre: "fecha futura",
			body: map[string]interface{}{
				"name": "D", "type": "perro",
				"birth_date":           time.Now().AddDate(0, 0, 2).Format(time.RFC3339),
				"birth_date_precision": "day",
			},
		},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, c.body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status %d, se esperaba 400", resp.StatusCode)
			}
		})
	}
}
