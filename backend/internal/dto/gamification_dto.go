package dto

import (
	"time"

	"github.com/google/uuid"
)

// BadgeResponse es el DTO de respuesta para un badge/logro de usuario.
type BadgeResponse struct {
	ID        uuid.UUID `json:"id"`
	BadgeType string    `json:"badge_type"`
	EarnedAt  time.Time `json:"earned_at"`
}

// UserProfileResponse es el DTO de respuesta para el perfil público de un usuario.
// No expone campos sensibles como email o password hash.
type UserProfileResponse struct {
	ID              uuid.UUID       `json:"id"`
	Name            string          `json:"name"`
	City            string          `json:"city"`
	ProfilePhotoURL string          `json:"profile_photo_url,omitempty"`
	TotalPoints     int             `json:"total_points"`
	TotalReports    int             `json:"total_reports"`
	FoundCount      int             `json:"found_count"`
	ShareCount      int             `json:"share_count"`
	AvgRating       float64         `json:"avg_rating"`    // V1.5 — 0.0 si no tiene reseñas
	ReviewCount     int             `json:"review_count"`  // V1.5 — 0 si no tiene reseñas
	Badges          []BadgeResponse `json:"badges"`
}

// LeaderboardEntry es una entrada del ranking de usuarios por ciudad.
type LeaderboardEntry struct {
	UserID uuid.UUID `json:"user_id"`
	Name   string    `json:"name"`
	City   string    `json:"city"`
	TotalPoints int       `json:"total_points"`
	Rank        int       `json:"rank"`
}
