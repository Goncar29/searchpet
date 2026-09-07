package tests

import (
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"

	"github.com/google/uuid"
)

// La allowlist tiene que decir que SÍ a los dos estados que se están buscando y
// que NO a los otros cinco. Las dos mitades importan: un test que sólo afirme la
// presencia pasaría con la lista invertida.
func TestLastSeenRelevantStatuses_SoloLosQueSeEstanBuscando(t *testing.T) {
	relevantes := map[string]bool{}
	for _, s := range domain.LastSeenRelevantStatuses {
		relevantes[s] = true
	}

	for _, s := range []string{domain.PetStatusLost, domain.PetStatusStray} {
		if !relevantes[s] {
			t.Errorf("%q debería estar en LastSeenRelevantStatuses", s)
		}
	}
	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		if relevantes[s] {
			t.Errorf("%q NO debería estar: 'visto por última vez' no significa nada ahí", s)
		}
	}
}

// El fallback al alta es ASIMÉTRICO, y las dos mitades importan por igual.
//
// Un callejero SÍ hereda su alta: la fila nace del avistamiento, alguien la
// creó porque vio al animal. Una mascota perdida NO: se registró cuando su
// dueño la dio de alta, que puede ser años antes de que se perdiera. Sin esta
// asimetría, una mascota registrada en 2023 y publicada como perdida hoy diría
// "visto por última vez hace 3 años", que es lo contrario de lo que la ficha
// existe para mostrar.
func TestPetLastSeen_ElAltaCuentaSoloParaElCallejero(t *testing.T) {
	alta := time.Date(2023, 1, 10, 12, 0, 0, 0, time.UTC)
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	// Con reporte, los dos estados devuelven el reporte.
	for _, st := range []string{domain.PetStatusStray, domain.PetStatusLost} {
		p := &domain.Pet{Status: st, CreatedAt: alta, LastReportedAt: &visto}
		if got := p.LastSeen(); got == nil || !got.Equal(visto) {
			t.Errorf("%s con reporte: esperaba %v, obtuve %v", st, visto, got)
		}
	}

	// Sin reporte: el callejero cae al alta...
	strayPelado := &domain.Pet{Status: domain.PetStatusStray, CreatedAt: alta}
	if got := strayPelado.LastSeen(); got == nil || !got.Equal(alta) {
		t.Errorf("stray sin reporte: esperaba el alta %v, obtuve %v", alta, got)
	}

	// ...y la perdida NO, porque su alta no es una vista.
	lostPelada := &domain.Pet{Status: domain.PetStatusLost, CreatedAt: alta}
	if got := lostPelada.LastSeen(); got != nil {
		t.Errorf("lost sin reporte: esperaba nil (su alta no es una vista), obtuve %v", *got)
	}
}

// Un estado fuera de la allowlist devuelve nil, y eso es lo que hace que el
// cliente no tenga que conocer la lista: si no viene el campo, no muestra nada.
func TestPetLastSeen_NilFueraDeLaAllowlist(t *testing.T) {
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)
	for _, s := range []string{
		domain.PetStatusRegistered,
		domain.PetStatusFound,
		domain.PetStatusArchived,
		domain.PetStatusAdoption,
		domain.PetStatusAdopted,
	} {
		p := &domain.Pet{Status: s, CreatedAt: visto, LastReportedAt: &visto}
		if got := p.LastSeen(); got != nil {
			t.Errorf("status %q: esperaba nil, obtuve %v", s, got)
		}
	}
}

// Go y SQL tienen que resolver la MISMA fecha.
//
// `Pet.LastSeen()` y el COALESCE de straySightingNotExpired son la misma regla
// escrita dos veces. Una divergencia sería invisible mirándolas por separado:
// los dos valores seguirían pareciendo razonables, mientras la ficha muestra una
// fecha distinta de la que decidió si la mascota aparece en el feed.
//
// Va contra Postgres real y no contra un mock a propósito: lo que se compara es
// el resultado de una expresión SQL, y un mock no tiene expresiones.
func TestPetLastSeen_CoincideConElCoalesceDelScope(t *testing.T) {
	db := testdb.SetupTestDB(t)

	alta := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	visto := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)

	casos := []struct {
		nombre string
		pet    domain.Pet
	}{
		{"con reporte", domain.Pet{ID: uuid.New(), Name: "Con", Type: "perro", Status: domain.PetStatusStray, CreatedAt: alta, LastReportedAt: &visto}},
		{"sin reporte", domain.Pet{ID: uuid.New(), Name: "Sin", Type: "perro", Status: domain.PetStatusStray, CreatedAt: alta}},
		{"perdida con reporte", domain.Pet{ID: uuid.New(), Name: "Perdida", Type: "gato", Status: domain.PetStatusLost, CreatedAt: alta, LastReportedAt: &visto}},
	}

	for _, c := range casos {
		pet := c.pet
		if err := db.Create(&pet).Error; err != nil {
			t.Fatalf("%s: creando: %v", c.nombre, err)
		}

		// LA MISMA expresión que usa straySightingNotExpired, tomada de la
		// constante exportada y NO copiada acá: con el SQL escrito a mano este
		// test seguiría verde ante cualquier cambio de la función real, que es
		// justo lo que dice custodiar.
		var desdeSQL time.Time
		err := db.Raw(
			"SELECT "+repository.LastSeenExpr+" FROM pets WHERE pets.id = ?",
			pet.ID,
		).Scan(&desdeSQL).Error
		if err != nil {
			t.Fatalf("%s: consultando: %v", c.nombre, err)
		}

		desdeGo := pet.LastSeen()
		if desdeGo == nil {
			t.Fatalf("%s: LastSeen() dio nil para un estado de la allowlist", c.nombre)
		}
		if !desdeGo.UTC().Round(time.Millisecond).Equal(desdeSQL.UTC().Round(time.Millisecond)) {
			t.Errorf("%s: Go dice %v y SQL dice %v — las dos definiciones divergieron",
				c.nombre, desdeGo.UTC(), desdeSQL.UTC())
		}
	}
}
