package tests

import (
	"fmt"
	"strings"
	"testing"

	"lost-pets/tests/testdb"
)

// Los índices GiST tienen que EXISTIR y el planner tiene que USARLOS.
//
// Las dos mitades importan, y la segunda es la que casi nadie escribe: un índice
// cuya expresión no coincide EXACTAMENTE con la de la consulta se crea sin
// error, ocupa espacio, cuesta en cada escritura, y Postgres lo ignora. O sea
// que un test que sólo mire `pg_indexes` daría verde sobre un índice decorativo
// — y peor que no tenerlo, porque el problema parece resuelto.
//
// Las expresiones de la migración 000026 se copiaron de los repositorios. Si
// alguien cambia una de las dos puntas (la consulta o el índice), este test es
// el que avisa.
func TestGeoIndexes_ExistenYSonGiST(t *testing.T) {
	db := testdb.SetupTestDB(t)

	esperados := []string{"idx_reports_geog", "idx_vets_geog", "idx_location_alerts_geog"}
	for _, nombre := range esperados {
		var metodo string
		err := db.Raw(`
			SELECT am.amname FROM pg_class c
			JOIN pg_am am ON am.oid = c.relam
			WHERE c.relname = ?`, nombre).Scan(&metodo).Error
		if err != nil {
			t.Fatalf("%s: consultando: %v", nombre, err)
		}
		if metodo != "gist" {
			t.Errorf("%s: esperaba un índice gist, obtuve %q (vacío = no existe)", nombre, metodo)
		}
	}
}

// El planner ELIGE el índice para la consulta real.
//
// Es la mitad que un chequeo de existencia no puede dar. Se siembra volumen a
// propósito: con pocas filas Postgres prefiere el scan secuencial aunque el
// índice sea perfecto, así que una medición sobre una tabla casi vacía diría
// "no lo usa" sin que eso signifique nada.
func TestGeoIndexes_ElPlannerUsaElDeReports(t *testing.T) {
	db := testdb.SetupTestDB(t)

	// Un dueño y una mascota para colgar los reportes (FKs).
	ownerID := "11111111-1111-1111-1111-111111111111"
	petID := "22222222-2222-2222-2222-222222222222"
	if err := db.Exec(`
		INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
		VALUES (?, 'geo-bench@test.local', 'x', 'Bench', now(), now())`, ownerID).Error; err != nil {
		t.Fatalf("sembrando usuario: %v", err)
	}
	if err := db.Exec(`
		INSERT INTO pets (id, owner_id, name, type, status, created_at, updated_at)
		VALUES (?, ?, 'Bench', 'perro', 'stray', now(), now())`, petID, ownerID).Error; err != nil {
		t.Fatalf("sembrando mascota: %v", err)
	}

	// 20.000 alcanzan para que el planner prefiera el índice y el test siga
	// siendo rápido. Con 200 elige el scan y el test no probaría nada.
	if err := db.Exec(`
		INSERT INTO reports (id, pet_id, reporter_id, status, latitude, longitude, is_verified, created_at)
		SELECT gen_random_uuid(), ?, ?, 'sighting',
		       (-34.9 + (random()-0.5)*3)::numeric(10,8),
		       (-56.2 + (random()-0.5)*3)::numeric(11,8),
		       false, now()
		FROM generate_series(1, 20000)`, petID, ownerID).Error; err != nil {
		t.Fatalf("sembrando reportes: %v", err)
	}
	if err := db.Exec("ANALYZE reports").Error; err != nil {
		t.Fatalf("ANALYZE: %v", err)
	}

	// La MISMA expresión que usa FindNearby (report_repository.go). Copiarla mal
	// acá haría que el test verifique un índice que la app no usa.
	var plan []string
	err := db.Raw(`
		EXPLAIN SELECT count(*) FROM reports
		WHERE ST_DWithin(
			ST_SetSRID(ST_MakePoint(reports.longitude, reports.latitude), 4326)::geography,
			ST_SetSRID(ST_MakePoint(-56.1645, -34.9011), 4326)::geography,
			5000
		)`).Scan(&plan).Error
	if err != nil {
		t.Fatalf("EXPLAIN: %v", err)
	}

	completo := strings.Join(plan, "\n")
	if !strings.Contains(completo, "idx_reports_geog") {
		t.Errorf("el planner NO usa idx_reports_geog — el índice existe pero es decorativo.\n"+
			"Casi siempre significa que su expresión dejó de coincidir con la de la consulta.\nPlan:\n%s",
			completo)
	}
	if strings.Contains(completo, "Seq Scan on reports") {
		t.Errorf("sigue habiendo un Seq Scan sobre reports:\n%s", completo)
	}
	fmt.Fprintf(nopWriter{}, "%s", completo) // el plan queda disponible si hace falta depurar
}

type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }
