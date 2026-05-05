package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ReportPetResponse es el objeto pet anidado dentro del reporte.
type ReportPetResponse struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Type string    `json:"type"`
}

// ReportReporterResponse es el objeto reporter anidado dentro del reporte.
type ReportReporterResponse struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// ReportResponse son los datos del reporte que retornamos al cliente.
type ReportResponse struct {
	ID                  uuid.UUID              `json:"id"`
	PetID               uuid.UUID              `json:"pet_id"`
	ReporterID          uuid.UUID              `json:"reporter_id"`
	Status              string                 `json:"status"`
	Latitude            float64                `json:"latitude"`
	Longitude           float64                `json:"longitude"`
	LocationDescription string                 `json:"location_description,omitempty"`
	IsVerified          bool                   `json:"is_verified"`
	Pet                 ReportPetResponse      `json:"pet"`
	Reporter            ReportReporterResponse `json:"reporter"`
	CreatedAt           time.Time              `json:"created_at"`
}

// ToReportResponse convierte un domain.Report en un ReportResponse limpio.
func ToReportResponse(report *domain.Report) ReportResponse {
	return ReportResponse{
		ID:                  report.ID,
		PetID:               report.PetID,
		ReporterID:          report.ReporterID,
		Status:              report.Status,
		Latitude:            report.Latitude,
		Longitude:           report.Longitude,
		LocationDescription: report.LocationDescription,
		IsVerified:          report.IsVerified,
		Pet: ReportPetResponse{
			ID:   report.Pet.ID,
			Name: report.Pet.Name,
			Type: report.Pet.Type,
		},
		Reporter: ReportReporterResponse{
			ID:   report.Reporter.ID,
			Name: report.Reporter.Name,
		},
		CreatedAt: report.CreatedAt,
	}
}

// ToReportListResponse convierte un slice de domain.Report en un slice de ReportResponse.
func ToReportListResponse(reports []domain.Report) []ReportResponse {
	result := make([]ReportResponse, len(reports))
	for i, report := range reports {
		result[i] = ToReportResponse(&report)
	}
	return result
}
