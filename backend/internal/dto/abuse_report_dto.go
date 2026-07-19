package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// AbuseUserRef is a minimal user reference for admin enrichment.
type AbuseUserRef struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	IsBanned bool      `json:"is_banned"`
}

// AbuseTargetReportRef is a minimal report reference (with its pet) for admin enrichment.
type AbuseTargetReportRef struct {
	ID      uuid.UUID `json:"id"`
	PetID   uuid.UUID `json:"pet_id"`
	PetName string    `json:"pet_name"`
}

// CreateAbuseReportRequest contiene los datos para enviar una denuncia.
// Al menos uno de TargetUserID, TargetReportID o TargetFosterHomeID debe estar presente.
type CreateAbuseReportRequest struct {
	TargetUserID       *uuid.UUID `json:"target_user_id"`
	TargetReportID     *uuid.UUID `json:"target_report_id"`
	TargetFosterHomeID *uuid.UUID `json:"target_foster_home_id"`
	Reason             string     `json:"reason" binding:"required"`
}

// ResolveAbuseReportRequest contiene el nuevo status de la denuncia.
type ResolveAbuseReportRequest struct {
	Status string `json:"status" binding:"required"` // resolved | dismissed
}

// AbuseReportResponse es la respuesta de una denuncia de abuso.
type AbuseReportResponse struct {
	ID                 uuid.UUID  `json:"id"`
	TargetReportID     *uuid.UUID `json:"target_report_id,omitempty"`
	TargetUserID       *uuid.UUID `json:"target_user_id,omitempty"`
	TargetFosterHomeID *uuid.UUID `json:"target_foster_home_id,omitempty"`
	ReporterID         uuid.UUID  `json:"reporter_id"`
	Reason         string     `json:"reason"`
	Status         string     `json:"status"`
	ResolvedBy     *uuid.UUID `json:"resolved_by,omitempty"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	Reporter       *AbuseUserRef         `json:"reporter,omitempty"`
	TargetUser     *AbuseUserRef         `json:"target_user,omitempty"`
	TargetReport   *AbuseTargetReportRef `json:"target_report,omitempty"`
}

// ToAbuseReportResponse convierte un domain.ReportAbuse a AbuseReportResponse.
func ToAbuseReportResponse(r *domain.ReportAbuse) AbuseReportResponse {
	resp := AbuseReportResponse{
		ID:                 r.ID,
		TargetReportID:     r.TargetReportID,
		TargetUserID:       r.TargetUserID,
		TargetFosterHomeID: r.TargetFosterHomeID,
		ReporterID:         r.ReporterID,
		Reason:             r.Reason,
		Status:             r.Status,
		ResolvedBy:         r.ResolvedBy,
		ResolvedAt:         r.ResolvedAt,
		CreatedAt:          r.CreatedAt,
	}
	if r.Reporter.ID != (uuid.UUID{}) {
		resp.Reporter = &AbuseUserRef{ID: r.Reporter.ID, Name: r.Reporter.Name, IsBanned: r.Reporter.IsBanned}
	}
	if r.TargetUser != nil && r.TargetUser.ID != (uuid.UUID{}) {
		resp.TargetUser = &AbuseUserRef{ID: r.TargetUser.ID, Name: r.TargetUser.Name, IsBanned: r.TargetUser.IsBanned}
	}
	// Only expose target_report when its pet is also resolvable; otherwise the
	// frontend would render a link with a blank label. Omitting it lets the UI
	// fall back to the raw target_report_id (same as a deleted user/report).
	if r.TargetReport != nil && r.TargetReport.ID != (uuid.UUID{}) && r.TargetReport.Pet.ID != (uuid.UUID{}) {
		resp.TargetReport = &AbuseTargetReportRef{
			ID:      r.TargetReport.ID,
			PetID:   r.TargetReport.PetID,
			PetName: r.TargetReport.Pet.Name,
		}
	}
	return resp
}

// ToAbuseReportListResponse convierte una lista a []AbuseReportResponse.
func ToAbuseReportListResponse(reports []domain.ReportAbuse) []AbuseReportResponse {
	resp := make([]AbuseReportResponse, 0, len(reports))
	for i := range reports {
		resp = append(resp, ToAbuseReportResponse(&reports[i]))
	}
	return resp
}
