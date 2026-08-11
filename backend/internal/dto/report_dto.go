package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ReportPetPhotoResponse es la foto que el mapa usa para identificar la mascota.
//
// NO expone `PublicID` de Cloudinary. `domain.Photo` lo marca `json:"-"`, pero
// eso protege al modelo, no a este DTO: si algún día se serializara la entidad
// directo, la protección viene de allá. Acá se listan los campos a mano — que
// es la regla #7, y también el motivo por el que este struct existe.
type ReportPetPhotoResponse struct {
	ID        uuid.UUID `json:"id"`
	URL       string    `json:"url"`
	IsPrimary bool      `json:"is_primary"`
}

// ReportPetResponse es el objeto pet anidado dentro del reporte.
//
// LLEVA COMO MUCHO UNA FOTO, a propósito. El mapa dibuja decenas de reportes
// por pantalla y sólo necesita la que va en el marcador; mandar la galería
// entera multiplicaría la respuesta sin que nadie la use. Se conserva la forma
// de LISTA porque es la que el frontend ya lee (`photos.find(is_primary)`), no
// porque se planee mandar más de una.
//
// `Breed` y `Color` los usa el subtítulo del popup del mapa.
type ReportPetResponse struct {
	ID     uuid.UUID                `json:"id"`
	Name   string                   `json:"name"`
	Type   string                   `json:"type"`
	Breed  string                   `json:"breed,omitempty"`
	Color  string                   `json:"color,omitempty"`
	Photos []ReportPetPhotoResponse `json:"photos"`
}

// fotoDelMarcador elige la foto que representa a la mascota en el mapa.
//
// La primaria si existe; si no, la primera. Devuelve una lista de 0 o 1
// elemento — nunca nil, porque `photos: null` obligaría a cada consumidor a
// distinguir "sin fotos" de "no vino el campo", y son lo mismo.
func fotoDelMarcador(fotos []domain.Photo) []ReportPetPhotoResponse {
	elegida := -1
	for i, f := range fotos {
		if f.IsPrimary {
			elegida = i
			break
		}
		if elegida == -1 {
			elegida = i
		}
	}
	if elegida == -1 {
		return []ReportPetPhotoResponse{}
	}
	f := fotos[elegida]
	return []ReportPetPhotoResponse{{ID: f.ID, URL: f.URL, IsPrimary: f.IsPrimary}}
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
	OccurredAt          *time.Time             `json:"occurred_at"`
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
			ID:     report.Pet.ID,
			Name:   report.Pet.Name,
			Type:   report.Pet.Type,
			Breed:  report.Pet.Breed,
			Color:  report.Pet.Color,
			Photos: fotoDelMarcador(report.Pet.Photos),
		},
		Reporter: ReportReporterResponse{
			ID:   report.Reporter.ID,
			Name: report.Reporter.Name,
		},
		OccurredAt: report.OccurredAt,
		CreatedAt:  report.CreatedAt,
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

// NearbyReportsResponse es la respuesta de GET /api/reports/nearby.
// Incluye radius_used para que el cliente sepa qué radio se aplicó.
type NearbyReportsResponse struct {
	Data       []ReportResponse `json:"data"`
	RadiusUsed int              `json:"radius_used"`
}
