package domain

import (
	"time"

	"github.com/google/uuid"
)

// ============================================================
// CORE ENTITIES
// ============================================================

// User representa un usuario de la plataforma
type User struct {
	ID                 uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Email              string     `gorm:"uniqueIndex;not null;size:255" json:"email"`
	PasswordHash       string     `gorm:"not null;size:255" json:"-"`
	Name               string     `gorm:"size:100" json:"name"`
	Phone              string     `gorm:"size:20" json:"phone,omitempty"`
	ProfilePhotoURL    string     `gorm:"size:500" json:"profile_photo_url,omitempty"`
	Latitude           *float64   `gorm:"type:decimal(10,8)" json:"latitude,omitempty"`
	Longitude          *float64   `gorm:"type:decimal(11,8)" json:"longitude,omitempty"`
	IsVerified         bool       `gorm:"default:false" json:"is_verified"`
	VerificationMethod string     `gorm:"size:50" json:"verification_method,omitempty"`
	IsBanned           bool       `gorm:"default:false" json:"is_banned"`
	BanReason          string     `gorm:"type:text" json:"ban_reason,omitempty"`
	CreatedAt          time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt          time.Time  `gorm:"autoUpdateTime" json:"updated_at"`

	// Relaciones
	Pets     []Pet     `gorm:"foreignKey:OwnerID" json:"pets,omitempty"`
	Messages []Message `gorm:"foreignKey:SenderID" json:"-"`
}

// Pet representa una mascota registrada
type Pet struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OwnerID     uuid.UUID `gorm:"type:uuid;not null;index" json:"owner_id"`
	Name        string    `gorm:"not null;size:100" json:"name"`
	Type        string    `gorm:"not null;size:50" json:"type"` // perro, gato, pajaro, otro
	Breed       string    `gorm:"size:100" json:"breed,omitempty"`
	Color       string    `gorm:"size:100" json:"color,omitempty"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	Gender      string    `gorm:"size:10" json:"gender,omitempty"` // male, female, unknown
	MicrochipID *string   `gorm:"uniqueIndex;size:50" json:"microchip_id,omitempty"`
	Status      string    `gorm:"size:50;default:'active';index" json:"status"` // active, found, archived
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relaciones
	Owner   User     `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Photos  []Photo  `gorm:"foreignKey:PetID" json:"photos,omitempty"`
	Reports []Report `gorm:"foreignKey:PetID" json:"reports,omitempty"`
}

// Report representa un reporte de ubicación de una mascota
type Report struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID               uuid.UUID  `gorm:"type:uuid;not null;index" json:"pet_id"`
	ReporterID          uuid.UUID  `gorm:"type:uuid;not null;index" json:"reporter_id"`
	Status              string     `gorm:"not null;size:50;index" json:"status"` // lost, found, sighting
	Latitude            float64    `gorm:"type:decimal(10,8);not null" json:"latitude"`
	Longitude           float64    `gorm:"type:decimal(11,8);not null" json:"longitude"`
	LocationDescription string     `gorm:"type:text" json:"location_description,omitempty"`
	OccurredAt          *time.Time `gorm:"index" json:"occurred_at,omitempty"`
	IsVerified          bool       `gorm:"default:false;index" json:"is_verified"`
	VerifiedBy          *uuid.UUID `gorm:"type:uuid" json:"verified_by,omitempty"`
	VerifiedAt          *time.Time `json:"verified_at,omitempty"`
	CreatedAt           time.Time  `gorm:"autoCreateTime;index" json:"created_at"`

	// Relaciones
	Pet      Pet  `gorm:"foreignKey:PetID" json:"pet,omitempty"`
	Reporter User `gorm:"foreignKey:ReporterID" json:"reporter,omitempty"`
}

// Photo representa una foto de mascota
type Photo struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID      uuid.UUID `gorm:"type:uuid;not null;index" json:"pet_id"`
	URL        string    `gorm:"not null;size:500" json:"url"`
	UploadedBy uuid.UUID `gorm:"type:uuid;not null" json:"uploaded_by"`
	IsPrimary  bool      `gorm:"default:false" json:"is_primary"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// Message representa un mensaje entre usuarios
type Message struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SenderID   uuid.UUID  `gorm:"type:uuid;not null;index" json:"sender_id"`
	ReceiverID uuid.UUID  `gorm:"type:uuid;not null;index" json:"receiver_id"`
	ReportID   *uuid.UUID `gorm:"type:uuid" json:"report_id,omitempty"`
	Text       string     `gorm:"type:text;not null" json:"text"`
	IsRead     bool       `gorm:"default:false;index" json:"is_read"`
	CreatedAt  time.Time  `gorm:"autoCreateTime;index" json:"created_at"`

	// Relaciones
	Sender   User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	Receiver User `gorm:"foreignKey:ReceiverID" json:"receiver,omitempty"`
}

// Favorite representa una mascota marcada como favorita
type Favorite struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_user_pet" json:"user_id"`
	PetID     uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_user_pet" json:"pet_id"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// ============================================================
// SHARING & SOCIAL
// ============================================================

// ShareLink representa un link compartible en redes sociales
type ShareLink struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID          uuid.UUID `gorm:"type:uuid;not null;index" json:"pet_id"`
	ShareToken     string    `gorm:"uniqueIndex;not null;size:50" json:"share_token"`
	Platform       string    `gorm:"size:50" json:"platform,omitempty"` // instagram, facebook, whatsapp, twitter
	ViewCount      int       `gorm:"default:0" json:"view_count"`
	ClickedContact int       `gorm:"default:0" json:"clicked_contact"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`

	// Relaciones
	Pet Pet `gorm:"foreignKey:PetID" json:"pet,omitempty"`
}

// ============================================================
// ALERTS & NOTIFICATIONS
// ============================================================

// LocationAlert representa una alerta por ubicación
type LocationAlert struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID         uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	PetID          uuid.UUID `gorm:"type:uuid;not null;index" json:"pet_id"`
	AlertLatitude  float64   `gorm:"type:decimal(10,8);not null" json:"alert_latitude"`
	AlertLongitude float64   `gorm:"type:decimal(11,8);not null" json:"alert_longitude"`
	RadiusKm       int       `gorm:"default:5" json:"radius_km"`
	IsActive       bool      `gorm:"default:true;index" json:"is_active"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// ============================================================
// GAMIFICATION
// ============================================================

// Badge representa un logro/badge de usuario
type Badge struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_user_badge" json:"user_id"`
	BadgeType string    `gorm:"not null;size:100;uniqueIndex:idx_user_badge" json:"badge_type"`
	EarnedAt  time.Time `gorm:"autoCreateTime" json:"earned_at"`
}

// UserPoints representa los puntos acumulados de un usuario
type UserPoints struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID       uuid.UUID `gorm:"type:uuid;not null;uniqueIndex" json:"user_id"`
	Points       int       `gorm:"default:0" json:"points"`
	TotalReports int       `gorm:"default:0" json:"total_reports"`
	FoundCount   int       `gorm:"default:0" json:"found_count"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// ============================================================
// COMMUNITY
// ============================================================

// LocalGroup representa un grupo local por ciudad
type LocalGroup struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name        string    `gorm:"not null;size:255" json:"name"`
	City        string    `gorm:"not null;size:100;uniqueIndex" json:"city"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	CreatedBy   uuid.UUID `gorm:"type:uuid;not null" json:"created_by"`
	MemberCount int       `gorm:"default:1" json:"member_count"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// GroupMember representa la membresía de un usuario en un grupo
type GroupMember struct {
	ID       uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	GroupID  uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_group_user" json:"group_id"`
	UserID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_group_user" json:"user_id"`
	JoinedAt time.Time `gorm:"autoCreateTime" json:"joined_at"`
}

// SuccessStory representa una historia de éxito (mascota encontrada)
type SuccessStory struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID       uuid.UUID  `gorm:"type:uuid;not null" json:"pet_id"`
	ReportID    uuid.UUID  `gorm:"type:uuid;not null" json:"report_id"`
	StoryText   string     `gorm:"type:text;not null" json:"story_text"`
	HeroID      uuid.UUID  `gorm:"type:uuid;not null" json:"hero_id"` // quien encontró
	PhotoBefore *uuid.UUID `gorm:"type:uuid" json:"photo_before,omitempty"`
	PhotoAfter  *uuid.UUID `gorm:"type:uuid" json:"photo_after,omitempty"`
	Likes       int        `gorm:"default:0" json:"likes"`
	Featured    bool       `gorm:"default:false;index" json:"featured"`
	CreatedAt   time.Time  `gorm:"autoCreateTime;index" json:"created_at"`

	// Relaciones
	Pet  Pet  `gorm:"foreignKey:PetID" json:"pet,omitempty"`
	Hero User `gorm:"foreignKey:HeroID" json:"hero,omitempty"`
}

// ============================================================
// SECURITY
// ============================================================

// BlockedUser representa un bloqueo entre usuarios
type BlockedUser struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	BlockerID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_blocker_blocked;index" json:"blocker_id"`
	BlockedID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_blocker_blocked" json:"blocked_id"`
	Reason    string    `gorm:"type:text" json:"reason,omitempty"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// ReportAbuse representa una denuncia de fraude/abuso
type ReportAbuse struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ReportID    *uuid.UUID `gorm:"type:uuid" json:"report_id,omitempty"`
	UserID      *uuid.UUID `gorm:"type:uuid" json:"user_id,omitempty"`
	ReporterID  uuid.UUID  `gorm:"type:uuid;not null" json:"reporter_id"`
	Reason      string     `gorm:"not null;size:255" json:"reason"`
	Description string     `gorm:"type:text" json:"description,omitempty"`
	IsResolved  bool       `gorm:"default:false;index" json:"is_resolved"`
	CreatedAt   time.Time  `gorm:"autoCreateTime;index" json:"created_at"`
}

// ============================================================
// NOTIFICATIONS
// ============================================================

// DeviceToken almacena el token FCM de un dispositivo para push notifications.
// Un token físico pertenece exactamente a un usuario en todo momento (uniqueIndex global).
type DeviceToken struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Token     string    `gorm:"uniqueIndex;not null;size:500" json:"token"`
	Platform  string    `gorm:"not null;size:20" json:"platform"` // ios, android, web
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// Shelter representa un refugio de animales
type Shelter struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name        string    `gorm:"not null;size:255" json:"name"`
	City        string    `gorm:"not null;size:100;index" json:"city"`
	Latitude    *float64  `gorm:"type:decimal(10,8)" json:"latitude,omitempty"`
	Longitude   *float64  `gorm:"type:decimal(11,8)" json:"longitude,omitempty"`
	Phone       string    `gorm:"size:20" json:"phone,omitempty"`
	Email       string    `gorm:"size:255" json:"email,omitempty"`
	WebsiteURL  string    `gorm:"size:500" json:"website_url,omitempty"`
	DonationURL string    `gorm:"size:500" json:"donation_url,omitempty"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	IsVerified  bool      `gorm:"default:false;index" json:"is_verified"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}
