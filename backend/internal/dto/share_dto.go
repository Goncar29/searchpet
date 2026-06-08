package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ShareLinkOwnerResponse contiene información pública del dueño de la mascota.
type ShareLinkOwnerResponse struct {
	Name  string `json:"name"`
	Phone string `json:"phone,omitempty"`
}

// ShareLinkPetResponse son los datos del pet que se exponen en un share link público.
type ShareLinkPetResponse struct {
	ID          uuid.UUID          `json:"id"`
	Name        string             `json:"name"`
	Type        string             `json:"type"`
	Breed       string             `json:"breed,omitempty"`
	Color       string             `json:"color,omitempty"`
	Description string             `json:"description,omitempty"`
	Status      string             `json:"status"`
	Photos      []PetPhotoResponse `json:"photos"`
}

// GenerateShareLinkResponse es la respuesta al generar un nuevo share link.
type GenerateShareLinkResponse struct {
	ShareToken string    `json:"share_token"`
	ShareURL   string    `json:"share_url"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// ShareLinkPublicResponse son los datos que se exponen en el endpoint público de share links.
type ShareLinkPublicResponse struct {
	Token     string                 `json:"token"`
	Pet       ShareLinkPetResponse   `json:"pet"`
	Owner     ShareLinkOwnerResponse `json:"owner"`
	ExpiresAt *time.Time             `json:"expires_at,omitempty"`
	ViewCount int                    `json:"view_count"`
}

// ToGenerateShareLinkResponse construye la respuesta de generación de un share link.
func ToGenerateShareLinkResponse(token string, baseURL string, expiresAt time.Time) GenerateShareLinkResponse {
	return GenerateShareLinkResponse{
		ShareToken: token,
		ShareURL:   strings.TrimRight(baseURL, "/") + "/pet/" + token,
		ExpiresAt:  expiresAt,
	}
}

// ToShareLinkPublicResponse convierte un domain.ShareLink en un ShareLinkPublicResponse.
// Requiere que el share link haya sido cargado con su Pet, Pet.Owner y Pet.Photos (Preload).
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
			Status:      link.Pet.Status,
			Photos:      photos,
		},
		Owner: ShareLinkOwnerResponse{
			Name:  link.Pet.Owner.Name,
			Phone: link.Pet.Owner.Phone,
		},
		ExpiresAt: link.ExpiresAt,
		ViewCount: link.ViewCount,
	}
}
