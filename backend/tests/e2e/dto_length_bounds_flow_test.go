//go:build e2e

package e2e_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

// Un valor más largo que su columna tiene que dar 400, nunca 500.
//
// Es la regla #34 a nivel de clase. Cuando un campo `string` de un DTO no
// declara `max`, un valor más largo viaja intacto hasta Postgres, que lo
// rechaza con SQLSTATE 22001; el handler colapsa cualquier error no-dominio en
// 500 ErrInternal y el usuario lee "ocurrió un error inesperado", pierde lo que
// escribió y no se entera de qué campo fue. Ya mordió tres veces en este repo:
// el `varchar(10)` del canal de OTP, el `rejection_reason` de los hogares de
// acogida (PR #198), y `local_groups.city`.
//
// Por eso este test es UNA tabla y no un test por endpoint: la clase se cierra
// entera o se vuelve a abrir sola en el próximo campo que alguien agregue. Los
// mocks de repositorio NO pueden verlo —no tienen columnas, no fallan por
// largo— así que esto vive en e2e, contra Postgres real.
//
// Cada caso manda UNA runa más que el ancho de la columna. El `max` de
// go-playground/validator cuenta runas y `varchar(n)` de Postgres cuenta
// caracteres, que acá son lo mismo (no es el caso de bcrypt, cuyo límite es de
// bytes — regla #36).
//
// Los campos que NO están en esta tabla es porque se verificó que no los
// necesitan: `pets.description`, `shelters.description`, `success_stories.body`
// y el motivo de rechazo de refugios son `text` (sin tope), y `platform`,
// `housing_type`, `gender` y el `status` de las denuncias ya están acotados por
// sus allowlists.
func TestDTOLengthBounds_UnLargoDeMasDa400YNo500(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	userToken, userEmail := registerAndLogin(t, baseURL)
	adminToken, adminEmail := registerAndLogin(t, baseURL)
	markAdmin(t, db, adminEmail)
	// Sin esto, seis de los casos mueren en 403 email_not_verified antes de
	// llegar al chequeo de largo: darían rojo igual y no probarían nada. El
	// arnés corre con EnableEmailVerification en false —los endpoints de OTP
	// contestan 501— así que escribir la columna es el único camino.
	markEmailVerified(t, db, userEmail)
	markEmailVerified(t, db, adminEmail)
	// Un target ajeno y REAL para la denuncia: el servicio rechaza denunciarse a
	// uno mismo antes de llegar al insert, y con un UUID inventado el 500 podría
	// venir de la foreign key en vez del largo — o sea que el rojo probaría otra
	// cosa.
	targetAjeno := userIDPorEmail(t, db, adminEmail)

	deMas := func(ancho int) string { return strings.Repeat("a", ancho+1) }

	casos := []struct {
		nombre string
		ruta   string
		token  string
		cuerpo map[string]any
	}{
		// users.name size:100 — público y sin auth: cualquiera puede provocarlo.
		{"register / users.name(100)", "/api/auth/register", "", map[string]any{
			"email": uniqueEmail(), "password": "password123", "name": deMas(100)}},
		// users.email size:255. El local part largo sigue siendo un email
		// sintácticamente válido, así que pasa el validador `email` y llega.
		{"register / users.email(255)", "/api/auth/register", "", map[string]any{
			"email": strings.Repeat("a", 250) + "@example.com", "password": "password123", "name": "E2E"}},

		{"pets / pets.name(100)", "/api/pets", userToken, map[string]any{
			"name": deMas(100), "type": "perro"}},
		{"pets / pets.type(50)", "/api/pets", userToken, map[string]any{
			"name": "Firulais", "type": deMas(50)}},
		{"pets / pets.breed(100)", "/api/pets", userToken, map[string]any{
			"name": "Firulais", "type": "perro", "breed": deMas(100)}},
		{"pets / pets.color(100)", "/api/pets", userToken, map[string]any{
			"name": "Firulais", "type": "perro", "color": deMas(100)}},
		{"pets / pets.city(120)", "/api/pets", userToken, map[string]any{
			"name": "Firulais", "type": "perro", "city": deMas(120)}},

		{"shelters / shelters.name(255)", "/api/shelters", userToken, map[string]any{
			"name": deMas(255), "city": "Montevideo"}},
		{"shelters / shelters.city(100)", "/api/shelters", userToken, map[string]any{
			"name": "Refugio", "city": deMas(100)}},
		{"shelters / shelters.phone(20)", "/api/shelters", userToken, map[string]any{
			"name": "Refugio", "city": "Montevideo", "phone": deMas(20)}},
		{"shelters / shelters.email(255)", "/api/shelters", userToken, map[string]any{
			"name": "Refugio", "city": "Montevideo", "email": deMas(255)}},
		{"shelters / shelters.website_url(500)", "/api/shelters", userToken, map[string]any{
			"name": "Refugio", "city": "Montevideo", "website_url": "https://e.com/" + deMas(500)}},
		{"shelters / shelters.donation_url(500)", "/api/shelters", userToken, map[string]any{
			"name": "Refugio", "city": "Montevideo", "donation_url": "https://e.com/" + deMas(500)}},

		{"abuse-reports / report_abuses.reason(255)", "/api/abuse-reports", userToken, map[string]any{
			"target_user_id": targetAjeno, "reason": deMas(255)}},

		{"devices/token / device_tokens.token(500)", "/api/devices/token", userToken, map[string]any{
			"token": deMas(500), "platform": "android"}},

		// admin-only (router.go: admin.POST("/groups"))
		{"groups / local_groups.city(100)", "/api/groups", adminToken, map[string]any{
			"city": deMas(100), "name": "Grupo"}},
		{"groups / local_groups.name(255)", "/api/groups", adminToken, map[string]any{
			"city": "Montevideo", "name": deMas(255)}},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			cuerpo, err := json.Marshal(c.cuerpo)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			req, err := http.NewRequest(http.MethodPost, baseURL+c.ruta, bytes.NewReader(cuerpo))
			if err != nil {
				t.Fatalf("build request: %v", err)
			}
			req.Header.Set("Content-Type", "application/json")
			if c.token != "" {
				req.Header.Set("Authorization", "Bearer "+c.token)
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)

			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("want 400, got %d — body: %s", resp.StatusCode, body)
				return
			}

			// El 400 solo no alcanza, y esto lo descubrió un /verify: tres de
			// estos endpoints pasaban el error CRUDO del binding a writeError,
			// y `CodeFor` devuelve "internal_error" para cualquier cosa que no
			// sea un error de dominio. El frontend traduce por CODIGO, así que
			// el usuario seguía leyendo "Ocurrió un error interno" — la misma
			// frase que antes del arreglo, con otro número de status.
			//
			// Sin esta aserción, revertir los handlers deja el test VERDE.
			var e struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if err := json.Unmarshal(body, &e); err != nil {
				t.Fatalf("cuerpo no es JSON: %s", body)
			}
			if e.Code == "internal_error" {
				t.Errorf("un 400 no puede traer code=internal_error — body: %s", body)
			}
			// El string de go-playground nombra el struct y el tag. No llega a
			// la pantalla (getErrorMessage ignora `message`), pero sí al cuerpo
			// de la respuesta: devtools, logs y cualquier consumidor de la API.
			if strings.Contains(e.Message, "Field validation") || strings.Contains(e.Message, "Key: '") {
				t.Errorf("se filtra el error crudo del validador — body: %s", body)
			}
		})
	}
}

// El `max` sobre un campo PUNTERO se aplica de verdad.
//
// Va aparte de la tabla porque necesita una mascota ya creada, y existe porque
// los opcionales de UpdatePetRequest son `*string` (regla #22: nil = no
// enviado, &"" = vaciar) y no era obvio que go-playground/validator mirara el
// valor apuntado. Si no lo hiciera, los `max` del update serían tags que se ven
// correctos en el diff y no hacen absolutamente nada — y editar seguiría dando
// 500 mientras crear daba 400.
//
// La segunda mitad es la que impide "arreglarlo" rompiendo el update parcial:
// vaciar un campo opcional con &"" tiene que seguir siendo válido.
func TestDTOLengthBounds_ElMaxSobrePunterosSeAplica(t *testing.T) {
	baseURL, db, cleanup := startTestServerWithDB(t)
	defer cleanup()

	token, email := registerAndLogin(t, baseURL)
	markEmailVerified(t, db, email)

	crear, _ := json.Marshal(map[string]any{"name": "Firulais", "type": "perro"})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/api/pets", bytes.NewReader(crear))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("crear mascota: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		cuerpo, _ := io.ReadAll(resp.Body)
		t.Fatalf("crear mascota: %d — %s", resp.StatusCode, cuerpo)
	}
	var creada struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&creada); err != nil {
		t.Fatalf("decodificar mascota: %v", err)
	}

	put := func(t *testing.T, cuerpo map[string]any) int {
		t.Helper()
		b, _ := json.Marshal(cuerpo)
		req, _ := http.NewRequest(http.MethodPut, baseURL+"/api/pets/"+creada.ID, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("PUT: %v", err)
		}
		defer r.Body.Close()
		cuerpoResp, _ := io.ReadAll(r.Body)
		t.Logf("PUT -> %d %s", r.StatusCode, cuerpoResp)
		return r.StatusCode
	}

	t.Run("un breed mas largo que su columna da 400", func(t *testing.T) {
		if got := put(t, map[string]any{"name": "Firulais", "breed": strings.Repeat("a", 101)}); got != http.StatusBadRequest {
			t.Errorf("want 400, got %d", got)
		}
	})

	t.Run("vaciar un opcional con \"\" sigue siendo valido", func(t *testing.T) {
		if got := put(t, map[string]any{"name": "Firulais", "breed": ""}); got == http.StatusBadRequest {
			t.Errorf("vaciar un opcional no puede dar 400 (regla #22)")
		}
	})
}

// userIDPorEmail lee el id de un usuario ya registrado por HTTP.
func userIDPorEmail(t *testing.T, db *gorm.DB, email string) uuid.UUID {
	t.Helper()
	var u domain.User
	if err := db.Where("email = ?", email).First(&u).Error; err != nil {
		t.Fatalf("buscar usuario %s: %v", email, err)
	}
	return u.ID
}
