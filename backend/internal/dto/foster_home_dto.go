package dto

import (
	"strings"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"lost-pets/internal/domain"
)

var validHousingTypes = map[string]bool{"house": true, "apartment": true}
var validAnimalTypes = map[string]bool{"dog": true, "cat": true, "other": true}

// RegisterFosterHomeRequest — POST /api/foster-homes.
type RegisterFosterHomeRequest struct {
	City          string   `json:"city" binding:"required"`
	HousingType   string   `json:"housing_type" binding:"required"`
	AnimalTypes   []string `json:"animal_types" binding:"required"`
	Capacity      int      `json:"capacity" binding:"required"`
	Description   string   `json:"description" binding:"required"`
	WhatsappPhone *string  `json:"whatsapp_phone"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
}

func (r *RegisterFosterHomeRequest) Validate() error {
	if strings.TrimSpace(r.City) == "" || strings.TrimSpace(r.Description) == "" {
		return domain.ErrInvalidInput
	}
	if !validHousingTypes[r.HousingType] {
		return domain.ErrInvalidInput
	}
	if r.Capacity < 1 {
		return domain.ErrInvalidInput
	}
	if len(r.AnimalTypes) == 0 {
		return domain.ErrInvalidInput
	}
	for _, t := range r.AnimalTypes {
		if !validAnimalTypes[t] {
			return domain.ErrInvalidInput
		}
	}
	return nil
}

func ToRegisterFosterHomeDomain(req *RegisterFosterHomeRequest) *domain.FosterHome {
	return &domain.FosterHome{
		City:          req.City,
		HousingType:   req.HousingType,
		AnimalTypes:   pq.StringArray(req.AnimalTypes),
		Capacity:      req.Capacity,
		Description:   req.Description,
		WhatsappPhone: req.WhatsappPhone,
		Latitude:      req.Latitude,
		Longitude:     req.Longitude,
	}
}

// UpdateMyFosterHomeRequest — PUT /api/foster-homes/mine. Punteros (regla #22):
// nil = no tocar, valor = aplicar. Los arrays: nil = no tocar.
type UpdateMyFosterHomeRequest struct {
	City          *string  `json:"city"`
	HousingType   *string  `json:"housing_type"`
	AnimalTypes   []string `json:"animal_types"`
	Capacity      *int     `json:"capacity"`
	Description   *string  `json:"description"`
	WhatsappPhone *string  `json:"whatsapp_phone"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
}

func (r *UpdateMyFosterHomeRequest) Validate() error {
	if r.City != nil && strings.TrimSpace(*r.City) == "" {
		return domain.ErrInvalidInput
	}
	if r.Description != nil && strings.TrimSpace(*r.Description) == "" {
		return domain.ErrInvalidInput
	}
	if r.HousingType != nil && !validHousingTypes[*r.HousingType] {
		return domain.ErrInvalidInput
	}
	if r.Capacity != nil && *r.Capacity < 1 {
		return domain.ErrInvalidInput
	}
	if r.AnimalTypes != nil {
		if len(r.AnimalTypes) == 0 {
			return domain.ErrInvalidInput
		}
		for _, t := range r.AnimalTypes {
			if !validAnimalTypes[t] {
				return domain.ErrInvalidInput
			}
		}
	}
	return nil
}

// ReasonRequest — reject/suspend comparten forma (motivo requerido).
type ReasonRequest struct {
	Reason string `json:"reason" binding:"required"`
}

type FosterHomePhotoResponse struct {
	ID  uuid.UUID `json:"id"`
	URL string    `json:"url"`
}

// FosterHomeResponse — vista de directorio (usuarios logueados).
type FosterHomeResponse struct {
	ID            uuid.UUID                 `json:"id"`
	OwnerUserID   uuid.UUID                 `json:"owner_user_id"`
	City          string                    `json:"city"`
	HousingType   string                    `json:"housing_type"`
	AnimalTypes   []string                  `json:"animal_types"`
	Capacity      int                       `json:"capacity"`
	Description   string                    `json:"description"`
	WhatsappPhone *string                   `json:"whatsapp_phone,omitempty"`
	Photos        []FosterHomePhotoResponse `json:"photos"`
	CreatedAt     string                    `json:"created_at"`
}

func ToFosterHomeResponse(fh *domain.FosterHome) FosterHomeResponse {
	photos := make([]FosterHomePhotoResponse, 0, len(fh.Photos))
	for _, p := range fh.Photos {
		photos = append(photos, FosterHomePhotoResponse{ID: p.ID, URL: p.URL})
	}
	return FosterHomeResponse{
		ID:            fh.ID,
		OwnerUserID:   fh.OwnerUserID,
		City:          fh.City,
		HousingType:   fh.HousingType,
		AnimalTypes:   []string(fh.AnimalTypes),
		Capacity:      fh.Capacity,
		Description:   fh.Description,
		WhatsappPhone: fh.WhatsappPhone,
		Photos:        photos,
		CreatedAt:     fh.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func ToFosterHomeListResponse(list []domain.FosterHome) []FosterHomeResponse {
	out := make([]FosterHomeResponse, len(list))
	for i := range list {
		out[i] = ToFosterHomeResponse(&list[i])
	}
	return out
}

// MyFosterHomeResponse — vista del dueño (+ status/rejection_reason).
type MyFosterHomeResponse struct {
	FosterHomeResponse
	Status          string `json:"status"`
	RejectionReason string `json:"rejection_reason,omitempty"`
}

func ToMyFosterHomeResponse(fh *domain.FosterHome) MyFosterHomeResponse {
	return MyFosterHomeResponse{
		FosterHomeResponse: ToFosterHomeResponse(fh),
		Status:             fh.Status,
		RejectionReason:    fh.RejectionReason,
	}
}

func ToMyFosterHomeListResponse(list []domain.FosterHome) []MyFosterHomeResponse {
	out := make([]MyFosterHomeResponse, len(list))
	for i := range list {
		out[i] = ToMyFosterHomeResponse(&list[i])
	}
	return out
}
