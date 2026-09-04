package tests

import (
	"testing"
	"time"

	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/tests/testdb"

	"lost-pets/internal/repository"
	"lost-pets/internal/service"
)

// newPetServiceConReloj arma el pet service con UnitOfWork real, que es el
// camino de producción, y devuelve además el repo de mascotas para leer el
// reloj después.
func newPetServiceConReloj(t *testing.T) (service.PetService, repository.UserRepository, repository.PetRepository) {
	t.Helper()
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	episodeRepo := repository.NewEpisodeRepository(db)
	uow := repository.NewUnitOfWork(db)
	svc := service.NewPetService(petRepo, nil, nil, reportRepo, uow, nil, nil, episodeRepo)
	return svc, userRepo, petRepo
}

// Publicar una mascota como perdida CREA un reporte con lat/lng y occurred_at,
// así que tiene que mover el reloj igual que cualquier otro avistamiento.
//
// Si no lo mueve, el reloj queda NULL y el lector cae a `pets.created_at`, que
// es CUÁNDO SE REGISTRÓ LA MASCOTA — no cuándo se perdió. Un perro dado de alta
// hace un año y publicado como perdido hoy leería "visto hace un año" y, con la
// caducidad puesta, nacería vencido.
func TestPublishLost_MueveElRelojDeUltimaVista(t *testing.T) {
	svc, userRepo, petRepo := newPetServiceConReloj(t)
	owner := newTestUser(t, userRepo)

	// La mascota se registró hace mucho: es lo que hace visible el defecto,
	// porque el fallback a created_at daría justo esa fecha vieja.
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

	perdida := time.Now().Add(-72 * time.Hour).UTC().Truncate(time.Second)
	if _, err := svc.PublishLost(owner.ID.String(), pet.ID.String(), dto.PublishLostRequest{
		Latitude:   -34.9011,
		Longitude:  -56.1645,
		OccurredAt: &perdida,
	}); err != nil {
		t.Fatalf("PublishLost: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("publicar como perdida no movió el reloj: queda NULL y el lector caería a la fecha de ALTA")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(perdida) {
		t.Errorf("want %v (cuándo se perdió), got %v", perdida, got.LastReportedAt.UTC())
	}
}

// Crear una callejera lleva un reporte inicial con occurred_at OPCIONAL y
// provisto por el usuario. Sin estampar, el reloj cae a `pets.created_at` = hoy,
// y eso EXAGERA la frescura justo en la dirección que mantiene viva una
// publicación vieja: alguien reporta hoy un animal que vio hace tres semanas.
func TestCreatePet_CallejeraMueveElRelojConSuOccurredAt(t *testing.T) {
	svc, userRepo, petRepo := newPetServiceConReloj(t)
	reporter := newTestUser(t, userRepo)

	visto := time.Now().Add(-21 * 24 * time.Hour).UTC().Truncate(time.Second)
	pet, err := svc.CreatePet(reporter.ID.String(), dto.CreatePetRequest{
		Name:   "Callejero",
		Type:   "perro",
		Status: domain.PetStatusStray,
		InitialReport: &dto.InitialReportRequest{
			Latitude:   -34.9011,
			Longitude:  -56.1645,
			OccurredAt: &visto,
		},
	})
	if err != nil {
		t.Fatalf("CreatePet: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("crear la callejera no movió el reloj")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(visto) {
		t.Errorf("want %v (cuándo se lo vio), got %v — se perdió el occurred_at del reporte inicial",
			visto, got.LastReportedAt.UTC())
	}
}
