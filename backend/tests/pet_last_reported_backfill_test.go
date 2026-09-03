package tests

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// El backfill de la migración 000025 tiene que darle a cada mascota la fecha de
// su ÚLTIMO avistamiento real, no la del deploy. Sin él, todo callejero viejo
// arrancaría marcado como recién visto y la caducidad tardaría un plazo entero
// en empezar a hacer algo — que es exactamente el problema que viene a resolver.
//
// El test EJECUTA EL ARCHIVO de migración, no una copia de su SQL. Una copia
// probaría que el SQL del test funciona, que no es la pregunta: si el archivo
// cambiara, el test seguiría verde midiendo otra cosa.
func TestMigracion000025_BackfillTomaElUltimoAvistamiento(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	hace40 := time.Now().Add(-40 * 24 * time.Hour).UTC().Truncate(time.Second)
	hace10 := time.Now().Add(-10 * 24 * time.Hour).UTC().Truncate(time.Second)

	// Tres reportes. El más reciente es el que NO tiene occurred_at, así que
	// sólo un COALESCE lo ve: con MAX(occurred_at) pelado ganaría el de hace 10
	// días y el reloj quedaría diez días atrasado.
	reports := []domain.Report{
		{ID: uuid.New(), PetID: pet.ID, ReporterID: reporter.ID, Status: "sighting", Latitude: -34.9, Longitude: -56.1, OccurredAt: &hace40},
		{ID: uuid.New(), PetID: pet.ID, ReporterID: reporter.ID, Status: "sighting", Latitude: -34.9, Longitude: -56.1, OccurredAt: &hace10},
		{ID: uuid.New(), PetID: pet.ID, ReporterID: reporter.ID, Status: "sighting", Latitude: -34.9, Longitude: -56.1},
	}
	for i := range reports {
		if err := gormDB.Create(&reports[i]).Error; err != nil {
			t.Fatalf("seed report %d: %v", i, err)
		}
	}

	// Simulamos el estado PRE-migración: la columna existe (AutoMigrate ya la
	// creó) pero nadie la llenó todavía.
	if err := gormDB.Exec("UPDATE pets SET last_reported_at = NULL WHERE id = ?", pet.ID).Error; err != nil {
		t.Fatalf("reset last_reported_at: %v", err)
	}

	sqlBytes, err := os.ReadFile(filepath.Join("..", "migrations", "000025_add_pet_last_reported_at.up.sql"))
	if err != nil {
		t.Fatalf("leer la migración: %v", err)
	}
	if err := gormDB.Exec(string(sqlBytes)).Error; err != nil {
		t.Fatalf("ejecutar la migración: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("el backfill no llenó last_reported_at")
	}
	// El reporte sin occurred_at se creó recién, así que su created_at es el
	// máximo. Margen amplio: lo que se afirma es que ganó ÉSE y no el de hace
	// 10 días, no el instante exacto.
	if got.LastReportedAt.Before(time.Now().Add(-1 * time.Hour)) {
		t.Errorf("el backfill ignoró el reporte sin occurred_at: got %v, esperaba ~ahora", got.LastReportedAt.UTC())
	}
}

// Una mascota sin ningún reporte se queda en NULL a propósito: quien lee la
// columna hace COALESCE(last_reported_at, created_at), así que su fecha de alta
// ya responde "desde cuándo no se sabe nada". Rellenarla acá sería guardar un
// dato derivable y crear una segunda fuente de verdad que puede divergir.
func TestMigracion000025_BackfillDejaEnNullLaQueNoTieneReportes(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	if err := gormDB.Exec("UPDATE pets SET last_reported_at = NULL WHERE id = ?", pet.ID).Error; err != nil {
		t.Fatalf("reset last_reported_at: %v", err)
	}

	sqlBytes, err := os.ReadFile(filepath.Join("..", "migrations", "000025_add_pet_last_reported_at.up.sql"))
	if err != nil {
		t.Fatalf("leer la migración: %v", err)
	}
	if err := gormDB.Exec(string(sqlBytes)).Error; err != nil {
		t.Fatalf("ejecutar la migración: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt != nil {
		t.Errorf("want NULL para una mascota sin reportes, got %v", got.LastReportedAt.UTC())
	}
}
