package tests

import (
	"testing"

	"lost-pets/internal/domain"
	"lost-pets/internal/repository"
	"lost-pets/internal/service"
	"lost-pets/tests/testdb"
)

// Un reporte que MUEVE el estado de la mascota es una decisión del dueño.
// POST /api/reports estaba en el grupo `protected` —exige sesión— pero nunca
// comparaba contra el dueño, así que cualquier usuario logueado podía marcar
// perdida la mascota de otro o cerrarle una búsqueda activa. Y el registro es
// abierto y sin verificar email: la sesión no acota a nadie en la práctica.
//
// El tercero no pierde nada: `sighting` sigue abierto, que es como aporta el
// seguimiento que el dueño ve, y después se coordinan por chat o WhatsApp.

func newReportServiceForAuthz(t *testing.T) (service.ReportService, repository.UserRepository, repository.PetRepository) {
	t.Helper()
	db := testdb.SetupTestDB(t)
	userRepo := repository.NewUserRepository(db)
	petRepo := repository.NewPetRepository(db)
	reportRepo := repository.NewReportRepository(db)
	uow := repository.NewUnitOfWork(db)
	svc := service.NewReportService(reportRepo, petRepo, nil, nil, nil, nil, uow)
	return svc, userRepo, petRepo
}

func TestCreateReport_UnTerceroNoPuedeMarcarPerdidaLaMascotaDeOtro(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	dueno := newTestUser(t, userRepo)
	tercero := newTestUser(t, userRepo)

	pet := &domain.Pet{OwnerID: ptrUUID(dueno.ID), Name: "Luna", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	_, err := svc.CreateReport(tercero.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "lost", Latitude: -34.9, Longitude: -56.1,
	})
	if err != domain.ErrForbidden {
		t.Fatalf("esperaba ErrForbidden, obtuve %v", err)
	}

	after, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("refetch: %v", err)
	}
	if after.Status != domain.PetStatusRegistered {
		t.Errorf("la mascota cambió de estado pese al rechazo: %q", after.Status)
	}
}

func TestCreateReport_UnTerceroNoPuedeCerrarLaBusquedaDeOtro(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	dueno := newTestUser(t, userRepo)
	tercero := newTestUser(t, userRepo)

	pet := &domain.Pet{OwnerID: ptrUUID(dueno.ID), Name: "Rocco", Type: "perro", Status: domain.PetStatusLost, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	_, err := svc.CreateReport(tercero.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "found", Latitude: -34.9, Longitude: -56.1,
	})
	if err != domain.ErrForbidden {
		t.Fatalf("esperaba ErrForbidden, obtuve %v", err)
	}

	after, _ := petRepo.FindByID(pet.ID.String())
	if after.Status != domain.PetStatusLost {
		t.Errorf("la búsqueda se cerró pese al rechazo: %q", after.Status)
	}
}

// Lo que el tercero SÍ puede, y es como ayuda: avistar.
func TestCreateReport_UnTerceroSiPuedeAvistar(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	dueno := newTestUser(t, userRepo)
	tercero := newTestUser(t, userRepo)

	pet := &domain.Pet{OwnerID: ptrUUID(dueno.ID), Name: "Toby", Type: "perro", Status: domain.PetStatusLost, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	rep, err := svc.CreateReport(tercero.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "sighting", Latitude: -34.9, Longitude: -56.1,
		LocationDescription: "lo vi en la plaza",
	})
	if err != nil {
		t.Fatalf("el avistamiento de un tercero debe seguir permitido: %v", err)
	}
	if rep == nil {
		t.Fatal("no se creó el reporte")
	}

	after, _ := petRepo.FindByID(pet.ID.String())
	if after.Status != domain.PetStatusLost {
		t.Errorf("un avistamiento no debe mover el estado, quedó %q", after.Status)
	}
}

func TestCreateReport_ElDuenoSiPuedeMarcarPerdidaYEncontrada(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	dueno := newTestUser(t, userRepo)

	pet := &domain.Pet{OwnerID: ptrUUID(dueno.ID), Name: "Nala", Type: "perro", Status: domain.PetStatusRegistered, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed pet: %v", err)
	}

	if _, err := svc.CreateReport(dueno.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "lost", Latitude: -34.9, Longitude: -56.1,
	}); err != nil {
		t.Fatalf("el dueño debe poder marcarla perdida: %v", err)
	}
	after, _ := petRepo.FindByID(pet.ID.String())
	if after.Status != domain.PetStatusLost {
		t.Fatalf("esperaba lost, quedó %q", after.Status)
	}

	if _, err := svc.CreateReport(dueno.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "found", Latitude: -34.9, Longitude: -56.1,
	}); err != nil {
		t.Fatalf("el dueño debe poder cerrarla: %v", err)
	}
	after, _ = petRepo.FindByID(pet.ID.String())
	if after.Status != domain.PetStatusFound {
		t.Errorf("esperaba found, quedó %q", after.Status)
	}
}

// Una callejera NO tiene dueño. Con una regla de "sólo el dueño" no la podría
// cerrar nadie nunca: por eso se usa canManagePet, que para las que no tienen
// dueño autoriza a quien la reportó.
func TestCreateReport_EnUnaCallejeraDecideQuienLaReporto(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	reportante := newTestUser(t, userRepo)
	tercero := newTestUser(t, userRepo)

	pet := &domain.Pet{ReporterID: ptrUUID(reportante.ID), Name: "Sin nombre", Type: "perro", Status: domain.PetStatusStray, Version: 1}
	if err := petRepo.Create(pet); err != nil {
		t.Fatalf("seed stray: %v", err)
	}

	if _, err := svc.CreateReport(tercero.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "found", Latitude: -34.9, Longitude: -56.1,
	}); err != domain.ErrForbidden {
		t.Fatalf("un tercero no debe poder cerrar una callejera ajena, obtuve %v", err)
	}

	if _, err := svc.CreateReport(reportante.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "found", Latitude: -34.9, Longitude: -56.1,
	}); err != nil {
		t.Fatalf("quien reportó la callejera debe poder cerrarla: %v", err)
	}
	after, _ := petRepo.FindByID(pet.ID.String())
	if after.Status != domain.PetStatusFound {
		t.Errorf("esperaba found, quedó %q", after.Status)
	}
}
