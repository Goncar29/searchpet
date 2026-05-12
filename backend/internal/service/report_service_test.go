package service_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/service"
)

func newReportSvc(rRepo *mockReportRepo, pRepo *mockPetRepo) service.ReportService {
	// eventBus nil → los eventos no se publican, sin side-effects en unit tests
	return service.NewReportService(rRepo, pRepo, nil)
}

func validReportReq(petID string) service.CreateReportRequest {
	return service.CreateReportRequest{
		PetID:               petID,
		Status:              "sighting",
		Latitude:            -34.9011,
		Longitude:           -56.1645,
		LocationDescription: "Parque Rodó",
	}
}

// ============================================================
// Tests: CreateReport — validaciones de input
// ============================================================

func TestCreateReport_HappyPath(t *testing.T) {
	petID := uuid.New()
	rRepo := &mockReportRepo{}
	pRepo := &mockPetRepo{pet: petWithStatus(uuid.New(), "active")}
	svc := newReportSvc(rRepo, pRepo)

	report, err := svc.CreateReport(uuid.New().String(), validReportReq(petID.String()))

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if report == nil {
		t.Fatal("expected report, got nil")
	}
}

func TestCreateReport_InvalidReporterID(t *testing.T) {
	svc := newReportSvc(&mockReportRepo{}, &mockPetRepo{})

	_, err := svc.CreateReport("not-a-uuid", validReportReq(uuid.New().String()))

	if err != domain.ErrInvalidInput {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateReport_InvalidPetID(t *testing.T) {
	svc := newReportSvc(&mockReportRepo{}, &mockPetRepo{})

	req := validReportReq("not-a-uuid")
	_, err := svc.CreateReport(uuid.New().String(), req)

	if err != domain.ErrInvalidInput {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateReport_InvalidStatus(t *testing.T) {
	svc := newReportSvc(&mockReportRepo{}, &mockPetRepo{})

	req := validReportReq(uuid.New().String())
	req.Status = "desaparecido" // no es lost/found/sighting

	_, err := svc.CreateReport(uuid.New().String(), req)

	if err != domain.ErrInvalidStatus {
		t.Errorf("expected ErrInvalidStatus, got %v", err)
	}
}

func TestCreateReport_FutureDate(t *testing.T) {
	svc := newReportSvc(&mockReportRepo{}, &mockPetRepo{})

	future := time.Now().Add(2 * time.Hour)
	req := validReportReq(uuid.New().String())
	req.OccurredAt = &future

	_, err := svc.CreateReport(uuid.New().String(), req)

	if err != domain.ErrInvalidInput {
		t.Errorf("expected ErrInvalidInput for future date, got %v", err)
	}
}

// ============================================================
// Tests: CreateReport — sincronización de status del pet
// ============================================================

func TestCreateReport_FoundStatus_UpdatesPetToFound(t *testing.T) {
	petID := uuid.New()
	rRepo := &mockReportRepo{}
	pRepo := &mockPetRepo{pet: petWithStatus(uuid.New(), "active")}
	svc := newReportSvc(rRepo, pRepo)

	req := validReportReq(petID.String())
	req.Status = "found"

	_, err := svc.CreateReport(uuid.New().String(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(pRepo.statusCalls) != 1 || pRepo.statusCalls[0] != "found" {
		t.Errorf("expected UpdateStatus('found'), got %v", pRepo.statusCalls)
	}
}

func TestCreateReport_LostStatus_UpdatesPetToActive(t *testing.T) {
	petID := uuid.New()
	rRepo := &mockReportRepo{}
	pRepo := &mockPetRepo{pet: petWithStatus(uuid.New(), "found")}
	svc := newReportSvc(rRepo, pRepo)

	req := validReportReq(petID.String())
	req.Status = "lost"

	_, err := svc.CreateReport(uuid.New().String(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(pRepo.statusCalls) != 1 || pRepo.statusCalls[0] != "active" {
		t.Errorf("expected UpdateStatus('active'), got %v", pRepo.statusCalls)
	}
}

func TestCreateReport_SightingStatus_NoStatusUpdate(t *testing.T) {
	petID := uuid.New()
	rRepo := &mockReportRepo{}
	pRepo := &mockPetRepo{pet: petWithStatus(uuid.New(), "active")}
	svc := newReportSvc(rRepo, pRepo)

	req := validReportReq(petID.String())
	req.Status = "sighting"

	_, err := svc.CreateReport(uuid.New().String(), req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(pRepo.statusCalls) != 0 {
		t.Errorf("expected no UpdateStatus call for sighting, got %v", pRepo.statusCalls)
	}
}

// ============================================================
// Tests: GetNearbyReports
// ============================================================

// El service ya no aplica defaults — el handler resuelve el radio con precedencia.
// Este test verifica que el service pasa el valor recibido directamente al repo.
func TestGetNearbyReports_PassesThroughRadius(t *testing.T) {
	rRepo := &mockReportRepo{reports: []domain.Report{}}
	svc := newReportSvc(rRepo, &mockPetRepo{})

	_, err := svc.GetNearbyReports(-34.9011, -56.1645, 5000)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rRepo.capturedRadius != 5000 {
		t.Errorf("expected radius 5000, got %v", rRepo.capturedRadius)
	}
}

func TestGetNearbyReports_CustomRadius(t *testing.T) {
	rRepo := &mockReportRepo{reports: []domain.Report{}}
	svc := newReportSvc(rRepo, &mockPetRepo{})

	_, err := svc.GetNearbyReports(-34.9011, -56.1645, 1500)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rRepo.capturedRadius != 1500 {
		t.Errorf("expected radius 1500, got %v", rRepo.capturedRadius)
	}
}

// ============================================================
// Tests: GetReportsByPet
// ============================================================

func TestGetReportsByPet_ReturnsAll(t *testing.T) {
	petID := uuid.New()
	expected := []domain.Report{
		{ID: uuid.New(), PetID: petID, Status: "sighting"},
		{ID: uuid.New(), PetID: petID, Status: "lost"},
	}
	rRepo := &mockReportRepo{reports: expected}
	svc := newReportSvc(rRepo, &mockPetRepo{})

	reports, err := svc.GetReportsByPet(petID.String())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(reports) != len(expected) {
		t.Errorf("expected %d reports, got %d", len(expected), len(reports))
	}
}
