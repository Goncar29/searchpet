package dto

import (
	"net/url"
	"strings"
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

// ============================================================
// SELF-REGISTRATION (owner) — V2.1
// ============================================================

// validOptionalHTTPSURL acepta "" (campo opcional/limpiado) o una URL https:// bien formada.
func validOptionalHTTPSURL(s string) bool {
	if s == "" {
		return true
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}

// RegisterShelterRequest son los campos del auto-registro (POST /api/shelters).
type RegisterShelterRequest struct {
	Name        string   `json:"name" binding:"required"`
	City        string   `json:"city" binding:"required"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	WebsiteURL  string   `json:"website_url"`
	DonationURL string   `json:"donation_url"`
	Description string   `json:"description"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
}

// Validate exige https:// en los links (la validación inline del form es la
// primera línea; esto es el contrato del backend — spec: invalid_input).
func (r *RegisterShelterRequest) Validate() error {
	if !validOptionalHTTPSURL(r.WebsiteURL) || !validOptionalHTTPSURL(r.DonationURL) {
		return domain.ErrInvalidInput
	}
	return nil
}

// ToRegisterShelterDomain convierte el request en un domain.Shelter sin owner ni
// status — el service setea ambos (RegisterOwn es quien conoce la regla).
func ToRegisterShelterDomain(req *RegisterShelterRequest) *domain.Shelter {
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

// UpdateMyShelterRequest — PUT /api/shelters/mine. Punteros (regla #22):
// nil = no tocar, &"" = vaciar. El service decide si un cambio de link
// aplica directo (pending/rejected) o queda staged (approved).
type UpdateMyShelterRequest struct {
	Name        *string  `json:"name"`
	City        *string  `json:"city"`
	Phone       *string  `json:"phone"`
	Email       *string  `json:"email"`
	Description *string  `json:"description"`
	WebsiteURL  *string  `json:"website_url"`
	DonationURL *string  `json:"donation_url"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
}

// Validate exige https:// en los links presentes ("" explícito = limpiar, válido)
// y que Name/City, si llegan, no queden en blanco: son REQUERIDOS — el clear
// con &"" es solo para campos opcionales (regla #22, mismo contrato que UpdatePet).
func (r *UpdateMyShelterRequest) Validate() error {
	if r.Name != nil && strings.TrimSpace(*r.Name) == "" {
		return domain.ErrInvalidInput
	}
	if r.City != nil && strings.TrimSpace(*r.City) == "" {
		return domain.ErrInvalidInput
	}
	if r.WebsiteURL != nil && !validOptionalHTTPSURL(*r.WebsiteURL) {
		return domain.ErrInvalidInput
	}
	if r.DonationURL != nil && !validOptionalHTTPSURL(*r.DonationURL) {
		return domain.ErrInvalidInput
	}
	return nil
}

// RejectShelterRequest — POST /api/admin/shelters/:id/reject.
type RejectShelterRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// MyShelterResponse es la vista del DUEÑO: campos públicos + estado de revisión.
// NUNCA usar para el directorio público (regla #7 — ToShelterResponse es el público).
type MyShelterResponse struct {
	ShelterResponse
	Status             string  `json:"status"`
	RejectionReason    string  `json:"rejection_reason,omitempty"`
	PendingDonationURL *string `json:"pending_donation_url,omitempty"`
	PendingWebsiteURL  *string `json:"pending_website_url,omitempty"`
}

// ToMyShelterResponse arma la vista del dueño.
func ToMyShelterResponse(shelter *domain.Shelter) MyShelterResponse {
	return MyShelterResponse{
		ShelterResponse:    ToShelterResponse(shelter),
		Status:             shelter.Status,
		RejectionReason:    shelter.RejectionReason,
		PendingDonationURL: shelter.PendingDonationURL,
		PendingWebsiteURL:  shelter.PendingWebsiteURL,
	}
}

// AdminShelterResponse es la vista ADMIN: vista del dueño + owner_user_id.
type AdminShelterResponse struct {
	MyShelterResponse
	OwnerUserID *uuid.UUID `json:"owner_user_id,omitempty"`
}

// ToAdminShelterResponse arma la vista admin de un refugio.
func ToAdminShelterResponse(shelter *domain.Shelter) AdminShelterResponse {
	return AdminShelterResponse{
		MyShelterResponse: ToMyShelterResponse(shelter),
		OwnerUserID:       shelter.OwnerUserID,
	}
}

// ToAdminShelterListResponse siempre retorna slice inicializado (JSON [] y no null).
func ToAdminShelterListResponse(shelters []domain.Shelter) []AdminShelterResponse {
	result := make([]AdminShelterResponse, len(shelters))
	for i, s := range shelters {
		result[i] = ToAdminShelterResponse(&s)
	}
	return result
}
