package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ShelterResponse son los datos de un refugio que retornamos al cliente.
// Expone todos los campos públicos del domain.Shelter.
type ShelterResponse struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	City        string    `json:"city"`
	Latitude    *float64  `json:"latitude,omitempty"`
	Longitude   *float64  `json:"longitude,omitempty"`
	Phone       string    `json:"phone,omitempty"`
	Email       string    `json:"email,omitempty"`
	WebsiteURL  string    `json:"website_url,omitempty"`
	DonationURL string    `json:"donation_url,omitempty"`
	Description string    `json:"description,omitempty"`
	IsVerified  bool      `json:"is_verified"`
	CreatedAt   time.Time `json:"created_at"`
}

// ToShelterResponse convierte un domain.Shelter en un ShelterResponse limpio.
func ToShelterResponse(shelter *domain.Shelter) ShelterResponse {
	return ShelterResponse{
		ID:          shelter.ID,
		Name:        shelter.Name,
		City:        shelter.City,
		Latitude:    shelter.Latitude,
		Longitude:   shelter.Longitude,
		Phone:       shelter.Phone,
		Email:       shelter.Email,
		WebsiteURL:  shelter.WebsiteURL,
		DonationURL: shelter.DonationURL,
		Description: shelter.Description,
		IsVerified:  shelter.IsVerified,
		CreatedAt:   shelter.CreatedAt,
	}
}

// ToShelterListResponse convierte un slice de domain.Shelter en un slice de ShelterResponse.
// Siempre retorna un slice inicializado (nunca nil) para que JSON serialice como [] en vez de null.
func ToShelterListResponse(shelters []domain.Shelter) []ShelterResponse {
	result := make([]ShelterResponse, len(shelters))
	for i, s := range shelters {
		result[i] = ToShelterResponse(&s)
	}
	return result
}
