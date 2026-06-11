package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreatePetRequest contiene los datos para crear una mascota.
// Es el input que viene del Handler — ya parseado, listo para usar.
type CreatePetRequest struct {
	Name        string  `json:"name" binding:"required"`
	Type        string  `json:"type" binding:"required"`
	Breed       string  `json:"breed"`
	Color       string  `json:"color"`
	Description string  `json:"description"`
	Gender      string  `json:"gender"`
	MicrochipID *string `json:"microchip_id"`
	// Status is optional. Accepted values: "registered" (default) and "stray".
	// Any other value is rejected by the service layer.
	Status string `json:"status"`
	// InitialReport is required when Status == "stray" (400 initial_report_required
	// otherwise) and forbidden when Status == "registered" or omitted
	// (400 initial_report_not_allowed otherwise).
	InitialReport *InitialReportRequest `json:"initial_report"`
}

// InitialReportRequest contains the location data for the initial report that
// must accompany a stray pet creation or a publish-lost transition.
type InitialReportRequest struct {
	Latitude  float64 `json:"latitude" binding:"required"`
	Longitude float64 `json:"longitude" binding:"required"`
	Note      string  `json:"note"`
}

// UpdatePetRequest contiene los datos para actualizar una mascota.
type UpdatePetRequest struct {
	Name        string `json:"name"`
	Breed       string `json:"breed"`
	Color       string `json:"color"`
	Description string `json:"description"`
	Status      string `json:"status"`
	// Version is used for optimistic concurrency. Send the value received from the
	// last GET response; the server rejects the update with 409 if it has changed.
	Version int `json:"version"`
}

// PetSearchResponse es la respuesta paginada del endpoint GET /api/pets/search.
type PetSearchResponse struct {
	Data  []PetResponse `json:"data"`
	Total int64         `json:"total"`
	Page  int           `json:"page"`
	Limit int           `json:"limit"`
}

// PetOwnerResponse son los datos del dueño que exponemos dentro de un Pet.
type PetOwnerResponse struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Phone      string    `json:"phone,omitempty"`
	IsVerified bool      `json:"is_verified"`
}

// PetPhotoResponse son los datos de una foto de mascota.
type PetPhotoResponse struct {
	ID        uuid.UUID `json:"id"`
	URL       string    `json:"url"`
	IsPrimary bool      `json:"is_primary"`
	CreatedAt time.Time `json:"created_at"`
}

// PetResponse son los datos de la mascota que retornamos al cliente.
type PetResponse struct {
	ID          uuid.UUID          `json:"id"`
	OwnerID     *uuid.UUID         `json:"owner_id,omitempty"`
	ReporterID  *uuid.UUID         `json:"reporter_id,omitempty"`
	Name        string             `json:"name"`
	Type        string             `json:"type"`
	Breed       string             `json:"breed,omitempty"`
	Color       string             `json:"color,omitempty"`
	Description string             `json:"description,omitempty"`
	Status      string             `json:"status"`
	Version     int                `json:"version"`
	Photos      []PetPhotoResponse `json:"photos"`
	Owner       *PetOwnerResponse  `json:"owner,omitempty"`
	CreatedAt   time.Time          `json:"created_at"`
}

// ToPetResponse convierte un domain.Pet en un PetResponse limpio.
func ToPetResponse(pet *domain.Pet) PetResponse {
	photos := make([]PetPhotoResponse, len(pet.Photos))
	for i, p := range pet.Photos {
		photos[i] = PetPhotoResponse{
			ID:        p.ID,
			URL:       p.URL,
			IsPrimary: p.IsPrimary,
			CreatedAt: p.CreatedAt,
		}
	}

	resp := PetResponse{
		ID:          pet.ID,
		OwnerID:     pet.OwnerID,
		ReporterID:  pet.ReporterID,
		Name:        pet.Name,
		Type:        pet.Type,
		Breed:       pet.Breed,
		Color:       pet.Color,
		Description: pet.Description,
		Status:      pet.Status,
		Version:     pet.Version,
		Photos:      photos,
		CreatedAt:   pet.CreatedAt,
	}

	// Owner es opcional — solo lo incluimos si fue cargado (Preload)
	if pet.Owner.ID != (uuid.UUID{}) {
		resp.Owner = &PetOwnerResponse{
			ID:         pet.Owner.ID,
			Name:       pet.Owner.Name,
			Phone:      pet.Owner.Phone,
			IsVerified: pet.Owner.IsVerified,
		}
	}

	return resp
}

// ToPetListResponse convierte un slice de domain.Pet en un slice de PetResponse.
func ToPetListResponse(pets []domain.Pet) []PetResponse {
	result := make([]PetResponse, len(pets))
	for i, pet := range pets {
		result[i] = ToPetResponse(&pet)
	}
	return result
}

// ToPhotoResponse convierte un domain.Photo en un PetPhotoResponse.
// Reutilizamos el DTO existente — no creamos uno nuevo para evitar duplicación.
func ToPhotoResponse(photo *domain.Photo) PetPhotoResponse {
	return PetPhotoResponse{
		ID:        photo.ID,
		URL:       photo.URL,
		IsPrimary: photo.IsPrimary,
		CreatedAt: photo.CreatedAt,
	}
}

// ToPhotoListResponse convierte un slice de domain.Photo en un slice de PetPhotoResponse.
func ToPhotoListResponse(photos []domain.Photo) []PetPhotoResponse {
	result := make([]PetPhotoResponse, len(photos))
	for i, p := range photos {
		result[i] = ToPhotoResponse(&p)
	}
	return result
}
