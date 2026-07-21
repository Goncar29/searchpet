package dto

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"lost-pets/internal/domain"
)

var validHousingTypes = map[string]bool{"house": true, "apartment": true}
var validAnimalTypes = map[string]bool{"dog": true, "cat": true, "other": true}

// Límites de longitud (en runes/caracteres) de los campos de texto libre.
// Deben coincidir con los maxLength del form web/mobile. whatsapp = tamaño de
// la columna (size:20). Sin esto, un string enorme rompe el layout de la card.
const (
	fosterCityMaxLen        = 100
	fosterDescriptionMaxLen = 500
	fosterWhatsappMaxLen    = 20
)

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
	if utf8.RuneCountInString(r.City) > fosterCityMaxLen ||
		utf8.RuneCountInString(r.Description) > fosterDescriptionMaxLen {
		return domain.ErrInvalidInput
	}
	if r.WhatsappPhone != nil && utf8.RuneCountInString(*r.WhatsappPhone) > fosterWhatsappMaxLen {
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
	if r.City != nil && utf8.RuneCountInString(*r.City) > fosterCityMaxLen {
		return domain.ErrInvalidInput
	}
	if r.Description != nil && utf8.RuneCountInString(*r.Description) > fosterDescriptionMaxLen {
		return domain.ErrInvalidInput
	}
	if r.WhatsappPhone != nil && utf8.RuneCountInString(*r.WhatsappPhone) > fosterWhatsappMaxLen {
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

// MyFosterHomeResponse — vista del dueño (+ status/rejection_reason). También
// alimenta la cola de moderación admin: OwnerName/OwnerEmail se pueblan cuando
// el Owner viene preloadeado (cola admin) y quedan omitidos si no (vista /mine).
// Nunca llega al directorio público, que usa FosterHomeResponse.
type MyFosterHomeResponse struct {
	FosterHomeResponse
	Status          string `json:"status"`
	RejectionReason string `json:"rejection_reason,omitempty"`
	OwnerName       string `json:"owner_name,omitempty"`
	OwnerEmail      string `json:"owner_email,omitempty"`
}

func ToMyFosterHomeResponse(fh *domain.FosterHome) MyFosterHomeResponse {
	return MyFosterHomeResponse{
		FosterHomeResponse: ToFosterHomeResponse(fh),
		Status:             fh.Status,
		RejectionReason:    fh.RejectionReason,
		OwnerName:          fh.Owner.Name,
		OwnerEmail:         fh.Owner.Email,
	}
}

func ToMyFosterHomeListResponse(list []domain.FosterHome) []MyFosterHomeResponse {
	out := make([]MyFosterHomeResponse, len(list))
	for i := range list {
		out[i] = ToMyFosterHomeResponse(&list[i])
	}
	return out
}

// FosterHomeModerationLogResponse — vista admin del rastro de moderación (§18).
type FosterHomeModerationLogResponse struct {
	ID            uuid.UUID `json:"id"`
	FosterHomeID  uuid.UUID `json:"foster_home_id"`
	ActorAdminID  uuid.UUID `json:"actor_admin_id"`
	Action        string    `json:"action"`
	Reason        string    `json:"reason,omitempty"`
	OwnerUserID   uuid.UUID `json:"owner_user_id"`
	OwnerEmail    string    `json:"owner_email,omitempty"`
	OwnerPhone    string    `json:"owner_phone,omitempty"`
	OwnerWhatsapp string    `json:"owner_whatsapp,omitempty"`
	CreatedAt     string    `json:"created_at"`
}

func ToFosterHomeModerationLogResponse(l *domain.FosterHomeModerationLog) FosterHomeModerationLogResponse {
	return FosterHomeModerationLogResponse{
		ID:            l.ID,
		FosterHomeID:  l.FosterHomeID,
		ActorAdminID:  l.ActorAdminID,
		Action:        l.Action,
		Reason:        l.Reason,
		OwnerUserID:   l.OwnerUserID,
		OwnerEmail:    l.OwnerEmail,
		OwnerPhone:    l.OwnerPhone,
		OwnerWhatsapp: l.OwnerWhatsapp,
		CreatedAt:     l.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func ToFosterHomeModerationLogListResponse(list []domain.FosterHomeModerationLog) []FosterHomeModerationLogResponse {
	out := make([]FosterHomeModerationLogResponse, len(list))
	for i := range list {
		out[i] = ToFosterHomeModerationLogResponse(&list[i])
	}
	return out
}

// FosterHomeChangeLogResponse — vista admin del historial de ediciones (§18.1).
// ChangedFields se expone como objeto JSON (no string) usando json.RawMessage.
type FosterHomeChangeLogResponse struct {
	ID            uuid.UUID       `json:"id"`
	FosterHomeID  uuid.UUID       `json:"foster_home_id"`
	EditedByID    uuid.UUID       `json:"edited_by_id"`
	ChangeType    string          `json:"change_type"`
	ChangedFields json.RawMessage `json:"changed_fields"`
	OwnerEmail    string          `json:"owner_email,omitempty"`
	OwnerPhone    string          `json:"owner_phone,omitempty"`
	OwnerWhatsapp string          `json:"owner_whatsapp,omitempty"`
	CreatedAt     string          `json:"created_at"`
}

func ToFosterHomeChangeLogResponse(l *domain.FosterHomeChangeLog) FosterHomeChangeLogResponse {
	cf := json.RawMessage(l.ChangedFields)
	if len(l.ChangedFields) == 0 {
		cf = json.RawMessage("null")
	}
	return FosterHomeChangeLogResponse{
		ID:            l.ID,
		FosterHomeID:  l.FosterHomeID,
		EditedByID:    l.EditedByID,
		ChangeType:    l.ChangeType,
		ChangedFields: cf,
		OwnerEmail:    l.OwnerEmail,
		OwnerPhone:    l.OwnerPhone,
		OwnerWhatsapp: l.OwnerWhatsapp,
		CreatedAt:     l.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func ToFosterHomeChangeLogListResponse(list []domain.FosterHomeChangeLog) []FosterHomeChangeLogResponse {
	out := make([]FosterHomeChangeLogResponse, len(list))
	for i := range list {
		out[i] = ToFosterHomeChangeLogResponse(&list[i])
	}
	return out
}
