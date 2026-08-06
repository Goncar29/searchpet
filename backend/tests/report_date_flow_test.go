package tests

import (
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// Los dos caminos de "reporte inicial" — publish-lost y la creación de una
// callejera — construyen el mismo domain.Report que POST /api/reports, pero sus
// DTOs no tenían fecha: sólo podían decir DÓNDE. Entre que una mascota se
// pierde y el dueño publica pueden pasar días, así que created_at no sirve como
// sustituto de cuándo ocurrió.
//
// Se lee el reporte DE VUELTA DESDE LA BASE en vez de mirar el struct que
// devuelve el servicio: lo que importa es que la fecha sobreviva al INSERT, no
// que se le haya asignado a un campo en memoria.

func newPetServiceForDates(t *testing.T) (service.PetService, repository.ReportRepository, repository.UserRepository, repository.PetRepository) {
	t.Helper()
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	uow := repository.NewUnitOfWork(db)
	svc := service.NewPetService(petRepo, nil, nil, reportRepo, uow, nil, nil, nil)
	return svc, reportRepo, userRepo, petRepo
}

func TestPublishLost_PersisteLaFechaEnQueSePerdio(t *testing.T) {
	svc, reportRepo, userRepo, petRepo := newPetServiceForDates(t)
	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		OwnerID: ptrUUID(owner.ID),
		Name:    "Luna",
		Type:    "perro",
		Status:  domain.PetStatusRegistered,
		Version: 1,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	// Tres días atrás: el caso real, no "ahora".
	perdida := time.Now().Add(-72 * time.Hour).UTC().Truncate(time.Second)

	if _, err := svc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{
		Latitude:   -34.9011,
		Longitude:  -56.1645,
		Note:       "se fue del patio",
		OccurredAt: &perdida,
	}); err != nil {
		t.Fatalf("publish lost: %v", err)
	}

	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("find reports: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("esperaba 1 reporte, hay %d", len(reports))
	}
	got := reports[0].OccurredAt
	if got == nil {
		t.Fatal("occurred_at quedó NULL: la fecha no llegó a la base")
	}
	if !got.UTC().Truncate(time.Second).Equal(perdida) {
		t.Errorf("occurred_at: quería %v, obtuve %v", perdida, got.UTC())
	}
}

func TestPublishLost_RechazaFechaFutura(t *testing.T) {
	svc, reportRepo, userRepo, petRepo := newPetServiceForDates(t)
	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		OwnerID: ptrUUID(owner.ID),
		Name:    "Rocco",
		Type:    "perro",
		Status:  domain.PetStatusRegistered,
		Version: 1,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	futura := time.Now().Add(48 * time.Hour)
	_, err := svc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{
		Latitude:   -34.9011,
		Longitude:  -56.1645,
		OccurredAt: &futura,
	})
	if err != domain.ErrInvalidInput {
		t.Fatalf("esperaba ErrInvalidInput, obtuve %v", err)
	}

	// Se valida antes de abrir la transacción, así que no debe haber tocado
	// NADA: ni el estado de la mascota ni un reporte suelto.
	after, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("refetch pet: %v", err)
	}
	if after.Status != domain.PetStatusRegistered {
		t.Errorf("la mascota cambió de estado pese al rechazo: %q", after.Status)
	}
	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("find reports: %v", err)
	}
	if len(reports) != 0 {
		t.Errorf("se creó un reporte pese al rechazo: %d", len(reports))
	}
}

func TestCreatePetCallejera_PersisteLaFechaDelAvistamiento(t *testing.T) {
	svc, reportRepo, userRepo, _ := newPetServiceForDates(t)
	reporter := newTestUser(t, userRepo)

	visto := time.Now().Add(-24 * time.Hour).UTC().Truncate(time.Second)

	pet, err := svc.CreatePet(reporter.ID.String(), dto.CreatePetRequest{
		Name:   "Sin nombre",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:   -34.9011,
			Longitude:  -56.1645,
			Note:       "en la plaza",
			OccurredAt: &visto,
		},
	})
	if err != nil {
		t.Fatalf("create stray: %v", err)
	}

	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("find reports: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("esperaba 1 reporte, hay %d", len(reports))
	}
	got := reports[0].OccurredAt
	if got == nil {
		t.Fatal("occurred_at quedó NULL: la fecha no llegó a la base")
	}
	if !got.UTC().Truncate(time.Second).Equal(visto) {
		t.Errorf("occurred_at: quería %v, obtuve %v", visto, got.UTC())
	}
}

func TestCreatePetCallejera_RechazaFechaFutura(t *testing.T) {
	svc, _, userRepo, _ := newPetServiceForDates(t)
	reporter := newTestUser(t, userRepo)

	futura := time.Now().Add(48 * time.Hour)
	_, err := svc.CreatePet(reporter.ID.String(), dto.CreatePetRequest{
		Name:   "Sin nombre",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:   -34.9011,
			Longitude:  -56.1645,
			OccurredAt: &futura,
		},
	})
	if err != domain.ErrInvalidInput {
		t.Fatalf("esperaba ErrInvalidInput, obtuve %v", err)
	}
}

// Sin fecha sigue funcionando igual: el campo es opcional y la enorme mayoría
// de los reportes viejos la tienen en NULL.
func TestPublishLost_SinFechaSigueAndando(t *testing.T) {
	svc, reportRepo, userRepo, petRepo := newPetServiceForDates(t)
	owner := newTestUser(t, userRepo)

	pet := &domain.Pet{
		OwnerID: ptrUUID(owner.ID),
		Name:    "Toby",
		Type:    "perro",
		Status:  domain.PetStatusRegistered,
		Version: 1,
	}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	if _, err := svc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{
		Latitude:  -34.9011,
		Longitude: -56.1645,
	}); err != nil {
		t.Fatalf("publish lost: %v", err)
	}

	reports, err := reportRepo.FindByPetID(pet.ID.String())
	if err != nil {
		t.Fatalf("find reports: %v", err)
	}
	if len(reports) != 1 {
		t.Fatalf("esperaba 1 reporte, hay %d", len(reports))
	}
	if reports[0].OccurredAt != nil {
		t.Errorf("occurred_at debería ser NULL, es %v", reports[0].OccurredAt)
	}
}
