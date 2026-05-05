package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ReportResponse son los datos del reporte que retornamos al cliente.
type ReportResponse struct {
	ID                  uuid.UUID `json:"id"`
	PetID               uuid.UUID `json:"pet_id"`
	PetName             string    `json:"pet_name"`
	ReporterID          uuid.UUID `json:"reporter_id"`
	ReporterName        string    `json:"reporter_name"`
	Status              string    `json:"status"`
	Latitude            float64   `json:"latitude"`
	Longitude           float64   `json:"longitude"`
	LocationDescription string    `json:"location_description,omitempty"`
	IsVerified          bool      `json:"is_verified"`
	CreatedAt           time.Time `json:"created_at"`
}

// ToReportResponse convierte un domain.Report en un ReportResponse limpio.
func ToReportResponse(report *domain.Report) ReportResponse {
	return ReportResponse{
		ID:                  report.ID,
		PetID:               report.PetID,
		PetName:             report.Pet.Name,
		ReporterID:          report.ReporterID,
		ReporterName:        report.Reporter.Name,
		Status:              report.Status,
		Latitude:            report.Latitude,
		Longitude:           report.Longitude,
		LocationDescription: report.LocationDescription,
		IsVerified:          report.IsVerified,
		CreatedAt:           report.CreatedAt,
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
