package tests

import (
	"context"
	"testing"
	"time"

	"lost-pets/internal/service"
)

// El avistamiento manda sobre la carga: si el reporte trae occurred_at, ése es
// el momento en que se vio al animal. Medir por created_at haría parecer fresco
// un avistamiento de hace meses sólo porque alguien lo cargó hoy.
func TestCreateReport_ElRelojUsaOccurredAtCuandoViene(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	visto := time.Now().Add(-30 * 24 * time.Hour).UTC().Truncate(time.Second)
	_, err := svc.CreateReport(reporter.ID.String(), service.CreateReportRequest{
		PetID:      pet.ID.String(),
		Status:     "sighting",
		Latitude:   -34.9011,
		Longitude:  -56.1645,
		OccurredAt: &visto,
	})
	if err != nil {
		t.Fatalf("CreateReport: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("crear un reporte no estampó el reloj de la mascota")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(visto) {
		t.Errorf("want occurred_at %v, got %v", visto, got.LastReportedAt.UTC())
	}
}

// occurred_at es opcional. Sin él, lo único que sabemos del avistamiento es
// cuándo se cargó, así que el reloj cae a created_at igual que el
// COALESCE(occurred_at, created_at) que ya usan FindByPetID y FindNearby.
func TestCreateReport_ElRelojCaeACreatedAtSinOccurredAt(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	antes := time.Now().Add(-1 * time.Minute)
	rep, err := svc.CreateReport(reporter.ID.String(), service.CreateReportRequest{
		PetID:     pet.ID.String(),
		Status:    "sighting",
		Latitude:  -34.9011,
		Longitude: -56.1645,
	})
	if err != nil {
		t.Fatalf("CreateReport: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("crear un reporte sin occurred_at no estampó el reloj")
	}
	if got.LastReportedAt.Before(antes) {
		t.Errorf("el reloj quedó viejo: want ~%v (created_at del reporte %v), got %v",
			antes, rep.CreatedAt, got.LastReportedAt.UTC())
	}
}

// Borrar un reporte es moderación: un troll publica un avistamiento falso de un
// callejero y un admin lo borra. Como el reloj SÓLO AVANZA, sin recálculo la
// mascota queda estampada con la fecha del reporte falso para siempre y no hay
// ningún camino que pueda bajarla — la moderación saca la evidencia pero no su
// efecto.
//
// El recálculo usa la MISMA consulta que el backfill de la migración
// (MAX(COALESCE(occurred_at, created_at))), así que no agrega una quinta
// definición del reloj.
func TestDeleteReport_RecalculaElRelojConLoQueQueda(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	legitimo := time.Now().Add(-20 * 24 * time.Hour).UTC().Truncate(time.Second)
	falso := time.Now().Add(-1 * time.Hour).UTC().Truncate(time.Second)

	if _, err := svc.CreateReport(reporter.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "sighting", Latitude: -34.9, Longitude: -56.1,
		OccurredAt: &legitimo,
	}); err != nil {
		t.Fatalf("reporte legítimo: %v", err)
	}
	troll, err := svc.CreateReport(reporter.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "sighting", Latitude: -34.9, Longitude: -56.1,
		OccurredAt: &falso,
	})
	if err != nil {
		t.Fatalf("reporte falso: %v", err)
	}

	// Precondición: el falso adelantó el reloj, que es el daño a revertir.
	antes, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID antes: %v", err)
	}
	if antes.LastReportedAt == nil || !antes.LastReportedAt.UTC().Truncate(time.Second).Equal(falso) {
		t.Fatalf("precondición rota: el reloj debería estar en %v, está en %v", falso, antes.LastReportedAt)
	}

	if err := svc.Delete(context.Background(), troll.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID después: %v", err)
	}
	if got.LastReportedAt == nil {
		t.Fatal("el recálculo borró el reloj: queda un reporte legítimo, no debería quedar NULL")
	}
	if !got.LastReportedAt.UTC().Truncate(time.Second).Equal(legitimo) {
		t.Errorf("want %v (el reporte que queda), got %v", legitimo, got.LastReportedAt.UTC())
	}
}

// Si se borra el ÚNICO reporte, el reloj vuelve a NULL y no a una fecha
// inventada: NULL es lo que el lector resuelve con COALESCE a pets.created_at,
// o sea exactamente el estado "de esta mascota no hay ningún avistamiento".
func TestDeleteReport_SinReportesElRelojVuelveANull(t *testing.T) {
	svc, userRepo, petRepo := newReportServiceForAuthz(t)
	reporter := newTestUser(t, userRepo)
	pet := newStrayForClock(t, petRepo, reporter.ID)

	visto := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	rep, err := svc.CreateReport(reporter.ID.String(), service.CreateReportRequest{
		PetID: pet.ID.String(), Status: "sighting", Latitude: -34.9, Longitude: -56.1,
		OccurredAt: &visto,
	})
	if err != nil {
		t.Fatalf("CreateReport: %v", err)
	}

	if err := svc.Delete(context.Background(), rep.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	got, err := petRepo.FindByID(pet.ID.String())
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got.LastReportedAt != nil {
		t.Errorf("want NULL sin reportes, got %v", got.LastReportedAt.UTC())
	}
}
