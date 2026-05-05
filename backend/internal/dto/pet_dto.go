package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// PetResponse son los datos de la mascota que retornamos al cliente.
// Incluye solo el nombre del owner, no el objeto completo.
type PetResponse struct {
	ID          uuid.UUID `json:"id"`
	OwnerID     uuid.UUID `json:"owner_id"`
	OwnerName   string    `json:"owner_name"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Breed       string    `json:"breed,omitempty"`
	Gender      string    `json:"gender,omitempty"`
	Color       string    `json:"color,omitempty"`
	Description string    `json:"description,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// ToPetResponse convierte un domain.Pet en un PetResponse limpio.
func ToPetResponse(pet *domain.Pet) PetResponse {
	return PetResponse{
		ID:          pet.ID,
		OwnerID:     pet.OwnerID,
		OwnerName:   pet.Owner.Name,
		Name:        pet.Name,
		Type:        pet.Type,
		Breed:       pet.Breed,
		Gender:      pet.Gender,
		Color:       pet.Color,
		Description: pet.Description,
		Status:      pet.Status,
		CreatedAt:   pet.CreatedAt,
	}
}

// ToPetListResponse convierte un slice de domain.Pet en un slice de PetResponse.
func ToPetListResponse(pets []domain.Pet) []PetResponse {
	result := make([]PetResponse, len(pets))
	for i, pet := range pets {
		result[i] = ToPetResponse(&pet)
	}
	return result
}
