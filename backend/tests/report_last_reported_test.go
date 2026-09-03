package tests

import (
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
