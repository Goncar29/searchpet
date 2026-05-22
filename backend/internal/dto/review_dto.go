package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreateReviewRequest es el DTO para crear una reseña.
type CreateReviewRequest struct {
	Stars int    `json:"stars" binding:"required,min=1,max=5"`
	Text  string `json:"text" binding:"required,min=1,max=2000"`
}

// UpdateReviewRequest es el DTO para actualizar una reseña. Ambos campos son opcionales (punteros).
type UpdateReviewRequest struct {
	Stars *int    `json:"stars,omitempty" binding:"omitempty,min=1,max=5"`
	Text  *string `json:"text,omitempty" binding:"omitempty,min=1,max=2000"`
}

// ReviewResponse es el DTO de respuesta para una reseña individual.
type ReviewResponse struct {
	ID            uuid.UUID `json:"id"`
	ReviewerID    uuid.UUID `json:"reviewer_id"`
	ReviewerName  string    `json:"reviewer_name"`
	ReviewerPhoto string    `json:"reviewer_photo,omitempty"`
	Stars         int       `json:"stars"`
	Text          string    `json:"text"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ReviewListResponse envuelve reseñas paginadas con metadatos de paginación.
type ReviewListResponse struct {
	Reviews  []ReviewResponse `json:"reviews"`
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

// MapReviewToResponse convierte un domain.UserReview al DTO de respuesta.
// El reviewer puede ser nil si no se cargó la relación.
func MapReviewToResponse(r *domain.UserReview) ReviewResponse {
	resp := ReviewResponse{
		ID:         r.ID,
		ReviewerID: r.ReviewerID,
		Stars:      r.Stars,
		Text:       r.Text,
		CreatedAt:  r.CreatedAt,
		UpdatedAt:  r.UpdatedAt,
	}
	// Poblar datos del reviewer si la relación fue precargada.
	if r.Reviewer.ID != uuid.Nil {
		resp.ReviewerName = r.Reviewer.Name
		resp.ReviewerPhoto = r.Reviewer.ProfilePhotoURL
	}
	return resp
}
