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
		// La fecha se calcula en UTC, igual que la guarda. Con `time.Now()` a
		// secas —que es LOCAL— este caso se apoyaba en que la máquina estuviera
		// en UTC: en Montevideo (UTC-3) después de las 21:00, el día local va
		// uno atrás del de UTC, así que local+2 da UTC+1, que es exactamente el
		// borde que el día de gracia ACEPTA. Pasaba en CI sólo porque los
		// runners de GitHub están en UTC.
		//
		// Son +3 y no +2 para no volver a quedar pegado al borde.
		{"fecha futura", map[string]interface{}{"birth_date": time.Now().UTC().AddDate(0, 0, 3).Format("2006-01-02"), "birth_date_precision": "day"}},
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

// EL test del día de gracia, y existe porque sin él la línea no estaba
// protegida por nadie: revertir la guarda a `dia.After(hoy)` dejaba la suite
// ENTERA en verde mientras volvía a romper al usuario para el que se escribió.
// El caso "fecha futura" de arriba no sirve de guarda porque las dos versiones
// lo rechazan igual.
//
// Hacen falta las DOS aserciones, y son un par: la de aceptar se pone roja si
// alguien saca el día de gracia, y la de rechazar impide que el arreglo sea
// "aflojar la guarda hasta que pase", que aceptaría cualquier futuro.
//
// Todo se calcula en UTC, igual que la guarda, para no heredar el bug del caso
// de arriba: con `time.Now()` local, una máquina atrasada de UTC corre estas
// fechas un día y el test miente en las dos direcciones.
func TestPetBirthDate_ElDiaDeGraciaAceptaManianaYRechazaPasado(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	hoy := time.Now().UTC()

	// +1: el usuario adelantado de UTC. Alguien en España cargando a las 00:30
	// elige su día local, que en UTC todavía es ayer — sin el margen se lo
	// rechazaba con 400 por una fecha perfectamente válida. La app se publica
	// en es/en/pt, así que esas zonas están en alcance.
	aceptada := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Manana", "type": "perro",
		"birth_date": hoy.AddDate(0, 0, 1).Format("2006-01-02"), "birth_date_precision": "day",
	})
	defer aceptada.Body.Close()
	if aceptada.StatusCode != http.StatusCreated {
		t.Fatalf("UTC+1 día: status %d, se esperaba 201 — sin el día de gracia se rechaza al usuario adelantado de UTC, que es justo para quien existe el margen", aceptada.StatusCode)
	}

	// +2: el margen es de UN día, no de los que hagan falta. Ninguna zona del
	// mundo pasa de UTC+14, así que un día de calendario local nunca puede ir
	// más de uno adelante del de UTC: dos días ya es un dato absurdo.
	rechazada := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Pasado", "type": "perro",
		"birth_date": hoy.AddDate(0, 0, 2).Format("2006-01-02"), "birth_date_precision": "day",
	})
	defer rechazada.Body.Close()
	if rechazada.StatusCode != http.StatusBadRequest {
		t.Fatalf("UTC+2 días: status %d, se esperaba 400 — el margen es de un día y ninguna zona pasa de UTC+14", rechazada.StatusCode)
	}
}

// microchip_id es el campo de al lado de gender y tenía exactamente el mismo
// agujero: `uniqueIndex;size:50`, sin guarda, derecho al INSERT. Un valor de 60
// caracteres daba SQLSTATE 22001 → 500 por un dato que el servidor tenía que
// rechazar con 400. Contra Postgres real y no contra un mock, por lo de siempre:
// un mock de repositorio no tiene ancho de columna.
func TestPetMicrochipID_LargoFueraDeRangoDa400(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Chip", "type": "perro",
		"microchip_id": strings.Repeat("9", 51),
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, se esperaba 400 (un 500 acá significa que el largo llegó hasta Postgres)", resp.StatusCode)
	}
}

// EL test que fija la UNIDAD, que es lo único no obvio de esta guarda. `size:50`
// produce un VARCHAR(50) y Postgres cuenta VARCHAR en CARACTERES, así que 50
// runas acentuadas ENTRAN aunque ocupen 100 bytes.
//
// Si alguien cambia el chequeo a bytes, este test se pone rojo con un 400 sobre
// un identificador que la base acepta sin chistar — el error inverso al del tag
// `max` del validador contra el límite en bytes de bcrypt. El caso del largo
// pelado no distingue las dos implementaciones; éste sí.
func TestPetMicrochipID_ElLargoSeCuentaEnRunasNoEnBytes(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// 50 runas, 100 bytes en UTF-8.
	chip := strings.Repeat("ñ", 50)
	if len(chip) != 100 {
		t.Fatalf("el caso de prueba no vale: %d bytes, se esperaban 100", len(chip))
	}

	resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Ñoño", "type": "gato", "microchip_id": chip,
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, se esperaba 201: 50 runas entran en un VARCHAR(50) aunque sean 100 bytes; un 400 acá significa que el chequeo está contando bytes", resp.StatusCode)
	}
}

// El vacío tiene que guardarse como NULL. En un uniqueIndex de Postgres los NULL
// no colisionan entre sí, pero los strings vacíos SÍ: sin normalizar, la segunda
// mascota creada con el campo del formulario en blanco moría con SQLSTATE 23505
// → 500. Es el mismo defecto que el largo, con otro código de error, y por eso
// hacen falta DOS altas para verlo — la primera pasa siempre.
func TestPetMicrochipID_DosVaciosNoColisionan(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	// Cada forma del blanco va DOS veces, porque la primera alta siempre pasa:
	// la colisión sólo aparece en la segunda. Y los espacios van además del
	// vacío exacto porque son un agujero aparte — normalizar sólo `""` deja que
	// "   " se guarde como tres espacios literales, y dos mascotas cargadas así
	// vuelven a chocar con 23505.
	for i, caso := range []struct{ nombre, chip string }{
		{"Primera", ""},
		{"Segunda", ""},
		// EXACTAMENTE el mismo string las dos veces. Con largos distintos ("   "
		// contra "  ") son valores distintos y no colisionan ni sin el recorte:
		// el caso pasaba en verde sin probar nada.
		{"TerceraConEspacios", "   "},
		{"CuartaConEspacios", "   "},
	} {
		resp := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
			"name": caso.nombre, "type": "perro", "microchip_id": caso.chip,
		})
		if resp.StatusCode != http.StatusCreated {
			resp.Body.Close()
			t.Fatalf("alta %d (%s, chip=%q): status %d, se esperaba 201 — un microchip en blanco no es un duplicado, con o sin espacios", i+1, caso.nombre, caso.chip, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

// El recorte también protege la unicidad, que es para lo que existe el índice:
// " 985141" y "985141" son el MISMO microchip y no pueden entrar como dos filas
// distintas. Sin TrimSpace las dos altas dan 201 y el uniqueIndex queda inerte
// justo en el único campo donde la identidad es todo el punto.
func TestPetMicrochipID_ElRecorteHaceValerLaUnicidad(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)

	primera := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Chipeada", "type": "perro", "microchip_id": "985141000123456",
	})
	defer primera.Body.Close()
	if primera.StatusCode != http.StatusCreated {
		t.Fatalf("primera alta: status %d, se esperaba 201", primera.StatusCode)
	}

	// Mismo número, con espacios alrededor: es el MISMO microchip y el
	// uniqueIndex tiene que verlo como uno solo. Se afirma el 409 y no un
	// "distinto de 201" porque ese assert flojo también lo satisface el 500 que
	// este flujo daba antes — y un 500 le dice al cliente "error nuestro,
	// reintentá" ante un dato suyo que nunca va a funcionar.
	segunda := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Clon", "type": "perro", "microchip_id": "  985141000123456  ",
	})
	defer segunda.Body.Close()
	if segunda.StatusCode != http.StatusConflict {
		t.Fatalf("status %d, se esperaba 409: \" 985141… \" y \"985141…\" son el mismo microchip", segunda.StatusCode)
	}
}

// Un microchip repetido es un CONFLICTO con un recurso existente, no una falla
// del servidor. El caso no es exótico y fue el que trajo el code review: un
// finder registra una callejera con el chip X que le escaneó el veterinario, y
// más tarde el dueño registra su mascota con el mismo X.
//
// Se afirma el CÓDIGO del cuerpo además del status, porque es lo único que el
// frontend puede usar para explicar qué corregir: `getErrorMessage` mapea
// `code`, no el status. Y el campo es de sólo escritura —no viaja en
// PetResponse ni se puede editar— así que quien choca no tiene forma de
// inspeccionar el valor: el mensaje es toda la ayuda que recibe.
func TestPetMicrochipID_DuplicadoDa409YNo500(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	const chip = "985141000999888"

	primera := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Original", "type": "perro", "microchip_id": chip,
	})
	defer primera.Body.Close()
	if primera.StatusCode != http.StatusCreated {
		t.Fatalf("primera alta: status %d, se esperaba 201", primera.StatusCode)
	}

	segunda := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, map[string]interface{}{
		"name": "Duplicada", "type": "perro", "microchip_id": chip,
	})
	defer segunda.Body.Close()
	if segunda.StatusCode != http.StatusConflict {
		t.Fatalf("status %d, se esperaba 409 (un 500 acá significa que el 23505 de Postgres llegó crudo al handler)", segunda.StatusCode)
	}

	var cuerpo struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(segunda.Body).Decode(&cuerpo); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if cuerpo.Code != "microchip_taken" {
		t.Fatalf("code = %q, se esperaba \"microchip_taken\": es lo único que el frontend puede traducir", cuerpo.Code)
	}
}

// La colisión tiene que dar 409 también cuando la mascota entra por el camino
// TRANSACCIONAL. Una callejera se crea dentro de uow.Execute junto a su reporte
// inicial, que es un Create distinto del de una mascota registrada — y es
// justamente el caso del finder que escanea un chip, o sea el más probable de
// los dos. Si la traducción del error viviera en el servicio en vez del
// repositorio, esta rama se quedaría sin ella y nadie lo notaría.
func TestPetMicrochipID_DuplicadoEnCallejeraTambienDa409(t *testing.T) {
	baseURL, cleanup := startTestServer(t)
	defer cleanup()

	token, _ := registerAndLogin(t, baseURL)
	const chip = "985141000777666"

	stray := map[string]interface{}{
		"name": "Callejera", "type": "perro", "status": "stray", "microchip_id": chip,
		"initial_report": map[string]interface{}{"latitude": -34.9011, "longitude": -56.1645},
	}
	primera := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, stray)
	defer primera.Body.Close()
	if primera.StatusCode != http.StatusCreated {
		t.Fatalf("primera callejera: status %d, se esperaba 201", primera.StatusCode)
	}

	stray["name"] = "Callejera duplicada"
	segunda := birthDateRequest(t, http.MethodPost, baseURL+"/api/pets", token, stray)
	defer segunda.Body.Close()
	if segunda.StatusCode != http.StatusConflict {
		t.Fatalf("status %d, se esperaba 409 en el camino transaccional", segunda.StatusCode)
	}
}
