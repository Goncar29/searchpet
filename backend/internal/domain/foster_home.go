package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// Estados del ciclo de vida de un hogar transitorio.
// suspended = baja lógica admin — el registro NUNCA se borra (retención forense).
const (
	FosterHomeStatusPending   = "pending"
	FosterHomeStatusApproved  = "approved"
	FosterHomeStatusRejected  = "rejected"
	FosterHomeStatusSuspended = "suspended"
)

// Acciones de moderación (columna action de FosterHomeModerationLog).
const (
	FosterHomeActionApprove   = "approve"
	FosterHomeActionReject    = "reject"
	FosterHomeActionSuspend   = "suspend"
	FosterHomeActionReinstate = "reinstate"
)

// Tipos de cambio del historial de ediciones (FosterHomeChangeLog.ChangeType).
const (
	FosterHomeChangeListingEdit  = "listing_edit"
	FosterHomeChangeOwnerContact = "owner_contact_changed"
)

// FosterHome es el hogar transitorio de un usuario (domicilio que aloja animales).
type FosterHome struct {
	ID              uuid.UUID      `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OwnerUserID     uuid.UUID      `gorm:"type:uuid;not null;uniqueIndex" json:"owner_user_id"`
	City            string         `gorm:"not null" json:"city"`
	HousingType     string         `gorm:"not null;size:20" json:"housing_type"` // house | apartment
	AnimalTypes     pq.StringArray `gorm:"type:text[];not null" json:"animal_types"` // dog | cat | other
	Capacity        int            `gorm:"not null" json:"capacity"`
	Description     string         `gorm:"not null" json:"description"`
	WhatsappPhone   *string        `gorm:"size:20" json:"whatsapp_phone,omitempty"`
	Latitude        *float64       `json:"latitude,omitempty"`
	Longitude       *float64       `json:"longitude,omitempty"`
	Status          string         `gorm:"not null;default:'pending';index" json:"status"`
	RejectionReason string         `gorm:"size:500" json:"rejection_reason,omitempty"`
	CreatedAt       time.Time      `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time      `gorm:"autoUpdateTime" json:"updated_at"`

	Owner  User              `gorm:"foreignKey:OwnerUserID" json:"-"`
	Photos []FosterHomePhoto `gorm:"foreignKey:FosterHomeID" json:"photos,omitempty"`
}

// FosterHomePhoto es una foto del ESPACIO del hogar (no de una mascota).
type FosterHomePhoto struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	FosterHomeID uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
	URL          string    `gorm:"not null" json:"url"`
	PublicID     string    `gorm:"not null" json:"-"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// FosterHomeModerationLog registra CADA acción admin sobre un hogar, con snapshot
// inmutable del contacto del dueño al momento de la acción (evidencia forense).
type FosterHomeModerationLog struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	FosterHomeID  uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
	ActorAdminID  uuid.UUID `gorm:"type:uuid;not null;index" json:"actor_admin_id"`
	Action        string    `gorm:"size:20;not null" json:"action"`
	Reason        string    `gorm:"size:500" json:"reason"`
	OwnerUserID   uuid.UUID `gorm:"type:uuid;not null" json:"owner_user_id"`
	OwnerEmail    string    `gorm:"size:255" json:"owner_email"`
	OwnerPhone    string    `gorm:"size:20" json:"owner_phone"`
	OwnerWhatsapp string    `gorm:"size:20" json:"owner_whatsapp"`
	CreatedAt     time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}

// FosterHomeChangeLog registra cada EDICIÓN (append-only) con el diff before→after.
type FosterHomeChangeLog struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	FosterHomeID  uuid.UUID `gorm:"type:uuid;not null;index" json:"foster_home_id"`
	EditedByID    uuid.UUID `gorm:"type:uuid;not null;index" json:"edited_by_id"`
	ChangeType    string    `gorm:"size:30;not null" json:"change_type"`
	ChangedFields string    `gorm:"type:jsonb" json:"changed_fields"` // {"field":{"old":..,"new":..}}
	OwnerEmail    string    `gorm:"size:255" json:"owner_email"`
	OwnerPhone    string    `gorm:"size:20" json:"owner_phone"`
	OwnerWhatsapp string    `gorm:"size:20" json:"owner_whatsapp"`
	CreatedAt     time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}
