package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreateLocationAlertRequest — body de POST /api/alerts.
// UserID se extrae del JWT, no del body.
type CreateLocationAlertRequest struct {
	Latitude  float64 `json:"latitude" binding:"required"`
	Longitude float64 `json:"longitude" binding:"required"`
	RadiusKm float64 `json:"radius_km"` // default 5 cuando omitido
	// Los `max` replican location_alerts.pet_type (size:50) y name (size:100).
	// PetType NO tiene allowlist —el servicio lo asigna tal cual— así que el
	// tope es lo único que lo separa de un SQLSTATE 22001 y su 500.
	PetType string `json:"pet_type" binding:"max=50"` // opcional: "perro", "gato", etc.
	Name    string `json:"name" binding:"max=100"`    // etiqueta amigable, opcional
}

// UpdateLocationAlertRequest — body de PUT /api/alerts/:id.
// Todos los campos son opcionales (partial update).
type UpdateLocationAlertRequest struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	RadiusKm  *float64 `json:"radius_km"`
	PetType   *string  `json:"pet_type" binding:"omitempty,max=50"`
	Name      *string  `json:"name" binding:"omitempty,max=100"`
	IsActive  *bool    `json:"is_active"`
}

// LocationAlertResponse — shape de respuesta HTTP. Nunca expone domain.LocationAlert directamente.
type LocationAlertResponse struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	PetID          *uuid.UUID `json:"pet_id,omitempty"`
	PetType        string     `json:"pet_type,omitempty"`
	Name           string     `json:"name,omitempty"`
	AlertLatitude  float64    `json:"alert_latitude"`
	AlertLongitude float64    `json:"alert_longitude"`
	RadiusKm       float64    `json:"radius_km"`
	IsActive       bool       `json:"is_active"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// ToLocationAlertResponse convierte un domain.LocationAlert en su DTO de respuesta.
func ToLocationAlertResponse(a *domain.LocationAlert) LocationAlertResponse {
	return LocationAlertResponse{
		ID:             a.ID,
		UserID:         a.UserID,
		PetID:          a.PetID,
		PetType:        a.PetType,
		Name:           a.Name,
		AlertLatitude:  a.AlertLatitude,
		AlertLongitude: a.AlertLongitude,
		RadiusKm:       a.RadiusKm,
		IsActive:       a.IsActive,
		CreatedAt:      a.CreatedAt,
		UpdatedAt:      a.UpdatedAt,
	}
}

// ToLocationAlertResponseList convierte un slice de alertas.
func ToLocationAlertResponseList(alerts []domain.LocationAlert) []LocationAlertResponse {
	out := make([]LocationAlertResponse, len(alerts))
	for i := range alerts {
		out[i] = ToLocationAlertResponse(&alerts[i])
	}
	return out
}
