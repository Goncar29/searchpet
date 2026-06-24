package tests

import (
	"testing"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
)

func TestToAbuseReportResponse_EnrichedUserRefs(t *testing.T) {
	reporterID := uuid.New()
	targetUserID := uuid.New()
	r := &domain.ReportAbuse{
		ID:           uuid.New(),
		ReporterID:   reporterID,
		TargetUserID: &targetUserID,
		Reason:       "spam",
		Status:       "pending",
		Reporter:     domain.User{ID: reporterID, Name: "Alice"},
		TargetUser:   &domain.User{ID: targetUserID, Name: "Bob"},
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.Reporter == nil || resp.Reporter.Name != "Alice" || resp.Reporter.ID != reporterID {
		t.Errorf("want reporter Alice/%s, got %+v", reporterID, resp.Reporter)
	}
	if resp.TargetUser == nil || resp.TargetUser.Name != "Bob" {
		t.Errorf("want target_user Bob, got %+v", resp.TargetUser)
	}
	if resp.TargetReport != nil {
		t.Errorf("want nil target_report for a user-target report, got %+v", resp.TargetReport)
	}
}

func TestToAbuseReportResponse_EnrichedReportRef(t *testing.T) {
	reportID := uuid.New()
	petID := uuid.New()
	r := &domain.ReportAbuse{
		ID:             uuid.New(),
		ReporterID:     uuid.New(),
		TargetReportID: &reportID,
		Reason:         "fake",
		Status:         "pending",
		TargetReport: &domain.Report{
			ID:    reportID,
			PetID: petID,
			Pet:   domain.Pet{ID: petID, Name: "Toby"},
		},
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.TargetReport == nil {
		t.Fatal("want target_report, got nil")
	}
	if resp.TargetReport.PetName != "Toby" || resp.TargetReport.PetID != petID || resp.TargetReport.ID != reportID {
		t.Errorf("want report ref Toby/%s/%s, got %+v", petID, reportID, resp.TargetReport)
	}
}

func TestToAbuseReportResponse_OmitsUnloadedAssociations(t *testing.T) {
	targetUserID := uuid.New()
	r := &domain.ReportAbuse{
		ID:           uuid.New(),
		ReporterID:   uuid.New(), // Reporter association left zero-value (e.g. deleted)
		TargetUserID: &targetUserID,
		Reason:       "other",
		Status:       "pending",
		// Reporter zero, TargetUser nil, TargetReport nil
	}

	resp := dto.ToAbuseReportResponse(r)

	if resp.Reporter != nil {
		t.Errorf("want nil reporter when association not loaded, got %+v", resp.Reporter)
	}
	if resp.TargetUser != nil {
		t.Errorf("want nil target_user when association not loaded, got %+v", resp.TargetUser)
	}
}
