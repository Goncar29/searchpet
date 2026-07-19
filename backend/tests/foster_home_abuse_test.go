package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
	"lost-pets/internal/service"
)

// ============================================================
// Abuse reports against foster homes — service-level rules.
// Reuses fakeFHRepo/newFakeFHRepo (foster_home_service_test.go) and
// mockAbuseReportRepository (abuse_report_service_test.go), both already
// defined in this package.
// ============================================================

func TestAbuseReportService_Submit_SelfFosterHome_ReturnsErrSelfAbuseReport(t *testing.T) {
	ctx := context.Background()
	ownerID := uuid.New()
	fhID := uuid.New()

	fhRepo := newFakeFHRepo()
	fhRepo.byOwner[ownerID] = &domain.FosterHome{ID: fhID, OwnerUserID: ownerID}

	abuseRepo := &mockAbuseReportRepository{}
	svc := service.NewAbuseReportService(abuseRepo, fhRepo)

	_, err := svc.Submit(ctx, ownerID, dto.CreateAbuseReportRequest{
		TargetFosterHomeID: &fhID,
		Reason:             "self report attempt",
	})
	if err != domain.ErrSelfAbuseReport {
		t.Fatalf("expected ErrSelfAbuseReport, got %v", err)
	}
}

func TestAbuseReportService_Submit_DuplicatePendingFosterHome_ReturnsErrDuplicateAbuseReport(t *testing.T) {
	ctx := context.Background()
	ownerID := uuid.New()
	reporterID := uuid.New()
	fhID := uuid.New()

	fhRepo := newFakeFHRepo()
	fhRepo.byOwner[ownerID] = &domain.FosterHome{ID: fhID, OwnerUserID: ownerID}

	abuseRepo := &mockAbuseReportRepository{
		existsPendingFn: func(_ context.Context, rID, fID uuid.UUID) (bool, error) {
			return rID == reporterID && fID == fhID, nil
		},
	}
	svc := service.NewAbuseReportService(abuseRepo, fhRepo)

	_, err := svc.Submit(ctx, reporterID, dto.CreateAbuseReportRequest{
		TargetFosterHomeID: &fhID,
		Reason:             "second pending report",
	})
	if err != domain.ErrDuplicateAbuseReport {
		t.Fatalf("expected ErrDuplicateAbuseReport, got %v", err)
	}
}

func TestAbuseReportService_Submit_FosterHomeNotFound(t *testing.T) {
	ctx := context.Background()
	reporterID := uuid.New()
	missingID := uuid.New()

	fhRepo := newFakeFHRepo()
	abuseRepo := &mockAbuseReportRepository{}
	svc := service.NewAbuseReportService(abuseRepo, fhRepo)

	_, err := svc.Submit(ctx, reporterID, dto.CreateAbuseReportRequest{
		TargetFosterHomeID: &missingID,
		Reason:             "reporting a ghost",
	})
	if err != domain.ErrFosterHomeNotFound {
		t.Fatalf("expected ErrFosterHomeNotFound, got %v", err)
	}
}

func TestAbuseReportService_Submit_FosterHomeOK(t *testing.T) {
	ctx := context.Background()
	ownerID := uuid.New()
	reporterID := uuid.New()
	fhID := uuid.New()

	fhRepo := newFakeFHRepo()
	fhRepo.byOwner[ownerID] = &domain.FosterHome{ID: fhID, OwnerUserID: ownerID}

	abuseRepo := &mockAbuseReportRepository{
		createFn: func(_ context.Context, r *domain.ReportAbuse) error {
			r.ID = uuid.New()
			return nil
		},
		getByIDFn: func(_ context.Context, id uuid.UUID) (*domain.ReportAbuse, error) {
			return &domain.ReportAbuse{
				ID:                 id,
				TargetFosterHomeID: &fhID,
				ReporterID:         reporterID,
				Reason:             "legit report",
				Status:             "pending",
			}, nil
		},
	}
	svc := service.NewAbuseReportService(abuseRepo, fhRepo)

	report, err := svc.Submit(ctx, reporterID, dto.CreateAbuseReportRequest{
		TargetFosterHomeID: &fhID,
		Reason:             "legit report",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report.TargetFosterHomeID == nil || *report.TargetFosterHomeID != fhID {
		t.Errorf("expected TargetFosterHomeID %s, got %+v", fhID, report.TargetFosterHomeID)
	}
}
