package dto

import (
	"time"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// CreateShelterRequest contiene los campos para crear un refugio desde la API admin.
type CreateShelterRequest struct {
	Name        string   `json:"name" binding:"required"`
	City        string   `json:"city" binding:"required"`
	Address     string   `json:"address"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	WebsiteURL  string   `json:"website_url"`
	DonationURL string   `json:"donation_url"`
	Description string   `json:"description"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
}

// UpdateShelterRequest contiene los campos opcionales para actualizar un refugio.
// Todos los campos son punteros para distinguir "no enviado" de "enviado vacío".
type UpdateShelterRequest struct {
	Name        *string  `json:"name"`
	City        *string  `json:"city"`
	Address     *string  `json:"address"`
	Phone       *string  `json:"phone"`
	Email       *string  `json:"email"`
	WebsiteURL  *string  `json:"website_url"`
	DonationURL *string  `json:"donation_url"`
	Description *string  `json:"description"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	IsVerified  *bool    `json:"is_verified"`
}

// ToCreateShelterDomain convierte CreateShelterRequest en un domain.Shelter listo para persistir.
func ToCreateShelterDomain(req *CreateShelterRequest) *domain.Shelter {
	return &domain.Shelter{
		Name:        req.Name,
		City:        req.City,
		Phone:       req.Phone,
		Email:       req.Email,
		WebsiteURL:  req.WebsiteURL,
		DonationURL: req.DonationURL,
		Description: req.Description,
		Latitude:    req.Latitude,
		Longitude:   req.Longitude,
	}
}

// ToUpdateShelterDomain aplica los campos presentes en UpdateShelterRequest sobre un shelter existente.
// Solo modifica los campos que llegaron (no nil).
func ToUpdateShelterDomain(existing *domain.Shelter, req *UpdateShelterRequest) {
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.City != nil {
		existing.City = *req.City
	}
	if req.Phone != nil {
		existing.Phone = *req.Phone
	}
	if req.Email != nil {
		existing.Email = *req.Email
	}
	if req.WebsiteURL != nil {
		existing.WebsiteURL = *req.WebsiteURL
	}
	if req.DonationURL != nil {
		existing.DonationURL = *req.DonationURL
	}
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.Latitude != nil {
		existing.Latitude = req.Latitude
	}
	if req.Longitude != nil {
		existing.Longitude = req.Longitude
	}
	if req.IsVerified != nil {
		existing.IsVerified = *req.IsVerified
	}
}

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
