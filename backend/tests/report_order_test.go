package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// FindByPetID devuelve los reportes DEL MÁS NUEVO AL MÁS VIEJO, y eso no es una
// preferencia de presentación: es una garantía de la que depende algo que se
// imprime y se pega en un poste.
//
// La cadena cruza el borde de la API entera:
//
//	Postgres ordena → handler → cliente HTTP → React Query → PdfFlyerButton hace
//	`reports[0]` → se imprime "Visto: <fecha>" en el volante.
//
// El frontend no puede notar si el orden cambia: recibe una lista y agarra el
// primero. Si alguien toca el `Order(...)` —refactorizando, agregando
// paginación, metiendo un Preload que cambie el plan— el volante empieza a
// imprimir la fecha del avistamiento MÁS VIEJO bajo la etiqueta "Visto". Un dato
// falso, en papel, en la calle, sin que nada se caiga.
//
// LOS TESTS QUE YA EXISTÍAN NO PODÍAN VERLO. TestPublishLost_PersisteLaFecha...,
// TestCreatePetCallejera_PersisteLaFecha... y TestPublishLost_SinFechaSigueAndando
// tocan los tres `reports[0]`, pero siembran UN SOLO reporte cada uno: con un
// elemento, `reports[0]` es el mismo con cualquier orden. Pasarían igual con el
// ORDER BY borrado.
func TestFindByPetID_DevuelveDelMasNuevoAlMasViejo(t *testing.T) {
	db := testdb.SetupTestDB(t)
	repo := repository.NewReportRepository(db)

	userID := uuid.New()
	petID := uuid.New()
	if err := db.Exec(`
		INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
		VALUES (?, 'orden@test.local', 'x', 'Orden', now(), now())`, userID).Error; err != nil {
		t.Fatalf("sembrando usuario: %v", err)
	}
	if err := db.Exec(`
		INSERT INTO pets (id, reporter_id, name, type, status, created_at, updated_at)
		VALUES (?, ?, 'Negrita', 'perro', 'stray', now(), now())`, petID, userID).Error; err != nil {
		t.Fatalf("sembrando mascota: %v", err)
	}

	viejo := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	medio := time.Date(2026, 5, 3, 9, 30, 0, 0, time.UTC)
	nuevo := time.Date(2026, 8, 20, 18, 0, 0, 0, time.UTC)

	// SE INSERTAN DESORDENADOS A PROPÓSITO. Sembrarlos ya ordenados haría que el
	// test pase aunque el ORDER BY no exista: Postgres suele devolver en orden de
	// inserción cuando no se le pide nada.
	//
	// Y el del MEDIO va con `occurred_at` NULL para cubrir el COALESCE: tiene que
	// ordenarse por su `created_at`, no irse al fondo ni al frente por ser nulo.
	// Sin este caso, cambiar `COALESCE(occurred_at, created_at)` por
	// `occurred_at` a secas dejaría el test verde.
	casos := []struct {
		nombre     string
		occurredAt *time.Time
		createdAt  time.Time
	}{
		{"medio (occurred_at NULL, ordena por created_at)", nil, medio},
		{"el más nuevo", &nuevo, viejo},
		{"el más viejo", &viejo, nuevo},
	}
	for _, c := range casos {
		if err := db.Exec(`
			INSERT INTO reports (id, pet_id, reporter_id, status, latitude, longitude, occurred_at, is_verified, created_at)
			VALUES (?, ?, ?, 'sighting', -34.9011, -56.1645, ?, false, ?)`,
			uuid.New(), petID, userID, c.occurredAt, c.createdAt).Error; err != nil {
			t.Fatalf("sembrando %s: %v", c.nombre, err)
		}
	}

	encontrados, err := repo.FindByPetID(petID.String())
	if err != nil {
		t.Fatalf("FindByPetID: %v", err)
	}
	if len(encontrados) != 3 {
		t.Fatalf("esperaba 3 reportes, obtuve %d", len(encontrados))
	}

	// La fecha efectiva de cada reporte es la misma que usa el ORDER BY y la
	// misma que el volante imprime: occurred_at, o created_at si es NULL.
	efectiva := func(r domain.Report) time.Time {
		if r.OccurredAt != nil {
			return *r.OccurredAt
		}
		return r.CreatedAt
	}

	esperado := []time.Time{nuevo, medio, viejo}
	for i, quiero := range esperado {
		if got := efectiva(encontrados[i]); !got.UTC().Equal(quiero) {
			t.Errorf("posición %d: esperaba %v, obtuve %v — el orden dejó de ser del más nuevo al más viejo",
				i, quiero, got.UTC())
		}
	}

	// Y explícitamente el que consume el volante: `reports[0]` tiene que ser el
	// avistamiento MÁS RECIENTE. Es la aserción que ata este test a lo que se
	// imprime.
	if got := efectiva(encontrados[0]); !got.UTC().Equal(nuevo) {
		t.Errorf("reports[0] —el que el volante imprime como \"Visto\"— es %v y debería ser %v",
			got.UTC(), nuevo)
	}
}
