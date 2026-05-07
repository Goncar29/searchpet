package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ShareLinkPetResponse son los datos del pet que se exponen en un share link público.
type ShareLinkPetResponse struct {
	ID          uuid.UUID          `json:"id"`
	Name        string             `json:"name"`
	Type        string             `json:"type"`
	Breed       string             `json:"breed,omitempty"`
	Color       string             `json:"color,omitempty"`
	Description string             `json:"description,omitempty"`
	Photos      []PetPhotoResponse `json:"photos"`
}

// GenerateShareLinkResponse es la respuesta al generar un nuevo share link.
type GenerateShareLinkResponse struct {
	Token     string    `json:"token"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ShareLinkPublicResponse son los datos que se exponen en el endpoint público de share links.
type ShareLinkPublicResponse struct {
	Token     string               `json:"token"`
	Pet       ShareLinkPetResponse `json:"pet"`
	OwnerID   uuid.UUID            `json:"owner_id"`
	ExpiresAt *time.Time           `json:"expires_at,omitempty"`
	ViewCount int                  `json:"view_count"`
}

// ToGenerateShareLinkResponse construye la respuesta de generación de un share link.
func ToGenerateShareLinkResponse(token string, baseURL string, expiresAt time.Time) GenerateShareLinkResponse {
	return GenerateShareLinkResponse{
		Token:     token,
		URL:       baseURL + "/pet/" + token,
		ExpiresAt: expiresAt,
	}
}

// ToShareLinkPublicResponse convierte un domain.ShareLink en un ShareLinkPublicResponse.
// Requiere que el share link haya sido cargado con su Pet (Preload).
func ToShareLinkPublicResponse(link *domain.ShareLink) ShareLinkPublicResponse {
	photos := make([]PetPhotoResponse, len(link.Pet.Photos))
	for i, p := range link.Pet.Photos {
		photos[i] = PetPhotoResponse{
			ID:        p.ID,
			URL:       p.URL,
			IsPrimary: p.IsPrimary,
			CreatedAt: p.CreatedAt,
		}
	}

	return ShareLinkPublicResponse{
		Token: link.ShareToken,
		Pet: ShareLinkPetResponse{
			ID:          link.Pet.ID,
			Name:        link.Pet.Name,
			Type:        link.Pet.Type,
			Breed:       link.Pet.Breed,
			Color:       link.Pet.Color,
			Description: link.Pet.Description,
			Photos:      photos,
		},
		OwnerID:   link.Pet.OwnerID,
		ExpiresAt: link.ExpiresAt,
		ViewCount: link.ViewCount,
	}
}
