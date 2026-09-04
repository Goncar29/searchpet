package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/tests/testdb"
)

// newStrayForClock persists a stray pet with no sighting clock set yet.
func newStrayForClock(t *testing.T, petRepo repository.PetRepository, reporterID uuid.UUID) *domain.Pet {
	t.Helper()
	pet := &domain.Pet{
		ID:         uuid.New(),
		ReporterID: ptrUUID(reporterID),
		Name:       "Callejero",
		Type:       "perro",
		Status:     domain.PetStatusStray,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("Create stray: %v", err)
	}
	return pet
}

func TestPetRepository_TouchLastReported_EstampaElReloj(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	seen := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	if err := petRepo.TouchLastReported(pet.ID.String(), seen); err != nil {
		t.Fatalf("TouchLastReported: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("LastReportedAt quedó nil: el reloj no se estampó")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(seen) {
		t.Errorf("want LastReportedAt %v, got %v", seen, got.LastReportedAt.UTC())
	}
}

// El reloj mide cuándo se vio al animal por última vez, así que sólo puede
// avanzar. Un reporte se puede cargar HOY por algo visto hace dos meses
// (OccurredAt es input del usuario), y si esa carga pisara el valor guardado,
// un avistamiento fresco pasaría a parecer viejo y se apagaría solo.
func TestPetRepository_TouchLastReported_NuncaRetrocede(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	reciente := time.Now().Add(-1 * time.Hour).UTC().Truncate(time.Second)
	viejo := time.Now().Add(-60 * 24 * time.Hour).UTC().Truncate(time.Second)

	if err := petRepo.TouchLastReported(pet.ID.String(), reciente); err != nil {
		t.Fatalf("TouchLastReported reciente: %v", err)
	}
	// Un avistamiento retroactivo, cargado después pero ocurrido antes.
	if err := petRepo.TouchLastReported(pet.ID.String(), viejo); err != nil {
		t.Fatalf("TouchLastReported viejo: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("LastReportedAt quedó nil")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(reciente) {
		t.Errorf("el reloj retrocedió: want %v (el más reciente), got %v", reciente, got.LastReportedAt.UTC())
	}
}

// Update usa db.Save, que escribe TODAS las columnas del struct — incluida
// last_reported_at, cargada antes de mutar. Eso rodea por afuera la guarda de
// monotonía: la comparación vive en el UPDATE de TouchLastReported, y un Save
// no pasa por ahí.
//
// El escenario es real y no necesita mala suerte: el dueño abre el formulario
// de edición, mientras tanto entra un avistamiento, y al guardar la descripción
// el Save reescribe el valor que había cargado. El reloj retrocede, o vuelve a
// NULL si estaba en NULL al cargar.
func TestPetRepository_Update_NoPisaElRelojDeUltimaVista(t *testing.T) {
	gormDB := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(gormDB)
	petRepo := repository.NewPetRepository(gormDB)

	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	viejo := time.Now().Add(-10 * 24 * time.Hour).UTC().Truncate(time.Second)
	if err := petRepo.TouchLastReported(pet.ID.String(), viejo); err != nil {
		t.Fatalf("TouchLastReported viejo: %v", err)
	}

	// El dueño carga la mascota para editarla: se lleva el reloj viejo.
	cargada, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}

	// Mientras el formulario está abierto, entra un avistamiento.
	nuevo := time.Now().Add(-1 * time.Hour).UTC().Truncate(time.Second)
	if err := petRepo.TouchLastReported(pet.ID.String(), nuevo); err != nil {
		t.Fatalf("TouchLastReported nuevo: %v", err)
	}

	// El dueño guarda su cambio, con el struct que cargó ANTES.
	cargada.Description = "descripción editada"
	if err := petRepo.Update(cargada); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID final: %v", err)
	}
	if got.Description != "descripción editada" {
		t.Errorf("el Update no guardó el cambio del usuario: %q", got.Description)
	}
	if got.LastReportedAt == nil {
		t.Fatal("el Update dejó el reloj en NULL: pisó el avistamiento")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(nuevo) {
		t.Errorf("el Update hizo retroceder el reloj: want %v (el avistamiento), got %v",
			nuevo, got.LastReportedAt.UTC())
	}
}
