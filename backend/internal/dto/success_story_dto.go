package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreateStoryRequest contiene los datos para crear una historia de éxito.
type CreateStoryRequest struct {
	PetID       uuid.UUID `json:"pet_id" binding:"required"`
	Title       string    `json:"title"`
	Body        string    `json:"body" binding:"required"`
	PhotoBefore string    `json:"photo_before"`
	PhotoAfter  string    `json:"photo_after"`
}

// SetFeaturedRequest contiene el flag para marcar/desmarcar featured.
type SetFeaturedRequest struct {
	Featured bool `json:"featured"`
}

// StoryResponse es la respuesta de una historia de éxito.
type StoryResponse struct {
	ID          uuid.UUID  `json:"id"`
	PetID       uuid.UUID  `json:"pet_id"`
	UserID      uuid.UUID  `json:"user_id"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	PhotoBefore string     `json:"photo_before,omitempty"`
	PhotoAfter  string     `json:"photo_after,omitempty"`
	LikeCount   int        `json:"like_count"`
	Featured    bool       `json:"featured"`
	FeaturedBy  *uuid.UUID `json:"featured_by,omitempty"`
	PetName     string     `json:"pet_name,omitempty"`
	UserName    string     `json:"user_name,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	LikedByMe   bool       `json:"liked_by_me"`
}

// ToStoryResponse convierte un domain.SuccessStory a StoryResponse.
// Incluye PetName y UserName desde las relaciones precargadas (Preload Pet + User).
func ToStoryResponse(s *domain.SuccessStory) StoryResponse {
	resp := StoryResponse{
		ID:          s.ID,
		PetID:       s.PetID,
		UserID:      s.UserID,
		Title:       s.Title,
		Body:        s.Body,
		PhotoBefore: s.PhotoBefore,
		PhotoAfter:  s.PhotoAfter,
		LikeCount:   s.LikeCount,
		Featured:    s.Featured,
		FeaturedBy:  s.FeaturedBy,
		CreatedAt:   s.CreatedAt,
	}
	if s.Pet.ID != (uuid.UUID{}) {
		resp.PetName = s.Pet.Name
	}
	if s.User.ID != (uuid.UUID{}) {
		resp.UserName = s.User.Name
	}
	return resp
}

// ToStoryListResponse convierte una lista de SuccessStory a []StoryResponse.
func ToStoryListResponse(stories []domain.SuccessStory) []StoryResponse {
	resp := make([]StoryResponse, 0, len(stories))
	for i := range stories {
		resp = append(resp, ToStoryResponse(&stories[i]))
	}
	return resp
}

// ToStoryResponseWithLike convierte un domain.SuccessStory a StoryResponse,
// fijando liked_by_me según el viewer actual.
func ToStoryResponseWithLike(s *domain.SuccessStory, liked bool) StoryResponse {
	resp := ToStoryResponse(s)
	resp.LikedByMe = liked
	return resp
}

// ToStoryListResponseWithLikes convierte una lista de SuccessStory a []StoryResponse,
// fijando liked_by_me por historia según likedSet (el conjunto de IDs que el viewer likeó).
func ToStoryListResponseWithLikes(stories []domain.SuccessStory, likedSet map[uuid.UUID]bool) []StoryResponse {
	resp := make([]StoryResponse, 0, len(stories))
	for i := range stories {
		resp = append(resp, ToStoryResponseWithLike(&stories[i], likedSet[stories[i].ID]))
	}
	return resp
}
