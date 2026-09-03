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
