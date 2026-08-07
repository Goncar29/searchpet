//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// El par (birth_date, birth_date_precision) contra POSTGRES REAL, y no contra un
// mock, por el motivo más caro que aprendió este proyecto: los mocks de
// repositorio NO TIENEN COLUMNAS. No fallan por ancho, ni por NOT NULL, ni por
// tipo. Un `varchar(10)` que no entra ya dejó una feature entera como un no-op
// silencioso en producción mientras toda la suite pasaba en verde.

type birthDatePetResponse struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Gender             string `json:"gender"`
	BirthDate          string `json:"birth_date"`
	BirthDatePrecision string `json:"birth_date_precision"`
	Version            int    `json:"version"`
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

func crearMascotaConNacimiento(t *testing.T, baseURL, token string, body map[string]interface{}) birthDatePetResponse {
	t.Helper()
	resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("crear mascota: status %d, se esperaba 201", resp.StatusCode)
	}
	var creada birthDatePetResponse
	if err := json.NewDecoder(resp.Body).Decode(&creada); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	return creada
}

// EL test de este archivo. La fecha de nacimiento es un DÍA DE CALENDARIO y
// tiene que viajar como tal en las dos direcciones, sin hora y sin zona.
//
// El bug que atiende: la columna es DATE, así que Postgres se queda con el día
// del valor que recibe y tira el resto. Si el transporte fuera un instante ISO
// —lo que devuelve `calendarDayToISO`, correcto para `occurred_at` porque esa
// columna es timestamptz— un usuario en UTC+2 que elige el 6 manda
// `2026-08-05T22:00:00Z` y se guarda el 5, para siempre: el instante no
// sobrevive al INSERT, así que el día local es irrecuperable.
func TestPetBirthDate_ViajaComoDiaDeCalendarioEnLasDosDirecciones(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// 'month' es la precisión más larga (5 chars): si la columna quedara más
	// angosta que el tag del struct, Postgres rechaza el insert con SQLSTATE
	// 22001. Ningún mock puede ver eso.
	creada := crearMascotaConNacimiento(t, baseURL, token, map[string]interface{}{
		"name": "Koda", "type": "perro", "gender": "male",
		"birth_date": "2022-03-01", "birth_date_precision": "month",
	})

	if creada.BirthDate != "2022-03-01" {
		t.Fatalf("birth_date devuelto = %q, se esperaba exactamente \"2022-03-01\"", creada.BirthDate)
	}
	// El guard que impide que vuelva el transporte roto: si alguien cambia el
	// campo por un time.Time, la respuesta pasa a traer "T" y "Z" y este assert
	// se pone rojo.
	if strings.ContainsAny(creada.BirthDate, "TZ:") {
		t.Fatalf("birth_date volvió como instante (%q): tiene que ser un día de calendario plano, o la zona del cliente corre la fecha un día", creada.BirthDate)
	}
	if creada.Gender != "male" {
		t.Fatalf("gender guardado = %q", creada.Gender)
	}

	// Releer por HTTP: lo que se prueba es que el dato SOBREVIVIÓ a la base y a
	// la vuelta, no que el handler hizo eco de lo que le mandaron.
	leer := birthDateRequest(t, http.MethodGet, baseURL+"/api/pets/"+creada.ID, token, nil)
	defer leer.Body.Close()
	if leer.StatusCode != http.StatusOK {
		t.Fatalf("leer mascota: status %d", leer.StatusCode)
	}
	var leida birthDatePetResponse
	if err := json.NewDecoder(leer.Body).Decode(&leida); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	if leida.BirthDate != "2022-03-01" {
		t.Fatalf("birth_date releído = %q, se esperaba \"2022-03-01\"", leida.BirthDate)
	}
	if leida.BirthDatePrecision != "month" {
		t.Fatalf("precision releída = %q", leida.BirthDatePrecision)
	}
}

// Un instante ISO tiene que ser RECHAZADO, no interpretado. Aceptarlo sería
// aceptar justo el formato cuyo día depende de la zona de quien lo mandó.
func TestPetBirthDate_RechazaUnInstanteISO(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Koda", "type": "perro",
		"birth_date": "2022-03-01T00:00:00Z", "birth_date_precision": "day",
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, se esperaba 400: un instante ISO no es un día de calendario", resp.StatusCode)
	}
}

func TestPetBirthDate_VaciarLaPrecisionBorraLaFecha(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	creada := crearMascotaConNacimiento(t, baseURL, token, map[string]interface{}{
		"name": "Michi", "type": "gato",
		"birth_date": "2021-07-09", "birth_date_precision": "day",
	})

	upd := birthDateRequest(t, http.MethodPut, baseURL+"/api/pets/"+creada.ID, token, map[string]interface{}{
		"name": "Michi", "version": creada.Version, "birth_date_precision": "",
	})
	defer upd.Body.Close()
	if upd.StatusCode != http.StatusOK {
		t.Fatalf("update: status %d, se esperaba 200", upd.StatusCode)
	}

	var actualizada birthDatePetResponse
	if err := json.NewDecoder(upd.Body).Decode(&actualizada); err != nil {
		t.Fatalf("decode update: %v", err)
	}
	if actualizada.BirthDate != "" || actualizada.BirthDatePrecision != "" {
		t.Fatalf("quedó fecha=%q precision=%q: vaciar la precisión tiene que borrar el par completo, o queda una fecha huérfana que nadie puede mostrar sin mentir sobre cuánto se sabe",
			actualizada.BirthDate, actualizada.BirthDatePrecision)
	}
}

// Un update que NO menciona el nacimiento no puede fallar por el nacimiento.
// Validar siempre significaría revalidar lo ya guardado, y una fila que quedara
// fuera de rango bloquearía toda edición futura — incluido un cambio de estado
// que no tiene nada que ver con la fecha.
func TestPetBirthDate_UnUpdateQueNoLoMencionaNoRevalidaLoGuardado(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	creada := crearMascotaConNacimiento(t, baseURL, token, map[string]interface{}{
		"name": "Rocco", "type": "perro",
		"birth_date": "2020-05-20", "birth_date_precision": "day",
	})

	upd := birthDateRequest(t, http.MethodPut, baseURL+"/api/pets/"+creada.ID, token, map[string]interface{}{
		"name": "Rocco II", "version": creada.Version,
	})
	defer upd.Body.Close()
	if upd.StatusCode != http.StatusOK {
		t.Fatalf("update sin tocar el nacimiento: status %d, se esperaba 200", upd.StatusCode)
	}

	var actualizada birthDatePetResponse
	if err := json.NewDecoder(upd.Body).Decode(&actualizada); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if actualizada.BirthDate != "2020-05-20" {
		t.Fatalf("la fecha se perdió en un update que no la mencionaba: %q", actualizada.BirthDate)
	}
}

// El par incoherente tiene que dar 400 por PUT igual que por POST. El handler
// de update no tenía rama para ErrInvalidInput y contestaba 500: un dato malo
// del cliente se presentaba como una falla del servidor.
func TestPetBirthDate_RechazaElParIncoherente(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	casos := []struct {
		nombre string
		campos map[string]interface{}
	}{
		// Fecha sin precisión: no se puede mostrar sin inventar cuánto se sabe.
		{"fecha sin precision", map[string]interface{}{"birth_date": "2020-01-01"}},
		// Precisión sin fecha: afirma saber algo que no tiene.
		{"precision sin fecha", map[string]interface{}{"birth_date_precision": "year"}},
		{"precision inventada", map[string]interface{}{"birth_date": "2020-01-01", "birth_date_precision": "decada"}},
		{"fecha futura", map[string]interface{}{"birth_date": time.Now().AddDate(0, 0, 2).Format("2006-01-02"), "birth_date_precision": "day"}},
		// Sin piso, el año 0001 que manda un cliente roto se persiste y después
		// cualquier cálculo de edad devuelve un absurdo.
		{"fecha absurdamente vieja", map[string]interface{}{"birth_date": "0001-01-01", "birth_date_precision": "year"}},
		{"dia inexistente", map[string]interface{}{"birth_date": "2021-02-30", "birth_date_precision": "day"}},
		// Contradictorio: pide borrar y setear a la vez. Se prefiere el 400
		// explícito antes que aceptar descartando en silencio lo que mandó.
		{"fecha con precision vacia", map[string]interface{}{"birth_date": "2020-01-01", "birth_date_precision": ""}},
	}

	for _, c := range casos {
		t.Run("POST/"+c.nombre, func(t *testing.T) {
			body := map[string]interface{}{"name": "X", "type": "perro"}
			for k, v := range c.campos {
				body[k] = v
			}
			resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status %d, se esperaba 400", resp.StatusCode)
			}
		})

		t.Run("PUT/"+c.nombre, func(t *testing.T) {
			base := crearMascotaConNacimiento(t, baseURL, token, map[string]interface{}{"name": "Y", "type": "perro"})
			body := map[string]interface{}{"name": "Y", "version": base.Version}
			for k, v := range c.campos {
				body[k] = v
			}
			resp := birthDateRequest(t, http.MethodPut, baseURL+"/api/pets/"+base.ID, token, body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status %d, se esperaba 400 (un 500 acá significa que falta la rama de ErrInvalidInput en el handler)", resp.StatusCode)
			}
		})
	}
}

// gender es un VARCHAR(10): sin allowlist, un valor largo revienta en Postgres
// y el usuario recibe un 500 por un dato que el servidor tenía que rechazar.
func TestPetBirthDate_GenderFueraDeLaAllowlistDa400(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	crear := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Z", "type": "perro", "gender": "no-binarie-x",
	})
	defer crear.Body.Close()
	if crear.StatusCode != http.StatusBadRequest {
		t.Fatalf("POST: status %d, se esperaba 400", crear.StatusCode)
	}

	base := crearMascotaConNacimiento(t, baseURL, token, map[string]interface{}{"name": "W", "type": "perro"})
	upd := birthDateRequest(t, http.MethodPut, baseURL+"/api/pets/"+base.ID, token, map[string]interface{}{
		"name": "W", "version": base.Version, "gender": "no-binarie-x",
	})
	defer upd.Body.Close()
	if upd.StatusCode != http.StatusBadRequest {
		t.Fatalf("PUT: status %d, se esperaba 400", upd.StatusCode)
	}
}
