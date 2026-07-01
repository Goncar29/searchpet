package domain

import (
	"time"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
)

// ============================================================
// QUERY CRITERIA
// ============================================================

// PetSearchCriteria contiene los parámetros de búsqueda de mascotas.
// Vive en domain para que repository pueda usarlo sin importar dto.
type PetSearchCriteria struct {
	Type     string     // coincidencia exacta con pets.type
	Breed    string     // coincidencia parcial ILIKE %breed%
	Color    string     // coincidencia parcial ILIKE %color%
	Statuses []string   // IN clause on pets.status; empty defaults to FeedVisibleStatuses (lost, stray)
	From     *time.Time // pets cuyo reporte.occurred_at >= From
	To       *time.Time // pets cuyo reporte.occurred_at <= To
	// Optional geo filter: when all three are set, only pets with at least one
	// report within RadiusMeters of (Lat, Lng) match. nil = no distance filter.
	Lat          *float64
	Lng          *float64
	RadiusMeters *float64
	Page         int // página (default 1)
	Limit        int // tamaño de página (default 20, max 100)
}

// ============================================================
// CORE ENTITIES
// ============================================================

// User representa un usuario de la plataforma
type User struct {
	ID                 uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Email              string    `gorm:"uniqueIndex;not null;size:255" json:"email"`
	PasswordHash       string    `gorm:"not null;size:255" json:"-"`
	Name               string    `gorm:"size:100" json:"name"`
	Phone              string    `gorm:"size:20" json:"phone,omitempty"`
	ProfilePhotoURL    string    `gorm:"size:500" json:"profile_photo_url,omitempty"`
	Latitude           *float64  `gorm:"type:decimal(10,8)" json:"latitude,omitempty"`
	Longitude          *float64  `gorm:"type:decimal(11,8)" json:"longitude,omitempty"`
	IsAdmin            bool      `gorm:"default:false" json:"is_admin"`
	IsVerified         bool      `gorm:"default:false" json:"is_verified"`
	VerificationMethod string    `gorm:"size:50" json:"verification_method,omitempty"`
	EmailVerified      bool      `gorm:"default:false" json:"email_verified"`
	PhoneVerified      bool      `gorm:"default:false" json:"phone_verified"`
	City               string    `gorm:"default:''" json:"city"`
	IsBanned           bool      `gorm:"default:false" json:"is_banned"`
	BanReason          string    `gorm:"type:text" json:"ban_reason,omitempty"`
	SearchRadiusMeters int       `gorm:"default:5000" json:"search_radius_meters"`
	CreatedAt          time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt          time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relaciones
	Pets     []Pet     `gorm:"foreignKey:OwnerID" json:"pets,omitempty"`
	Messages []Message `gorm:"foreignKey:SenderID" json:"-"`
}

// Pet representa una mascota registrada
type Pet struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OwnerID     *uuid.UUID `gorm:"type:uuid;index" json:"owner_id,omitempty"`    // nullable — nil for stray pets
	ReporterID  *uuid.UUID `gorm:"type:uuid;index" json:"reporter_id,omitempty"` // populated for stray pets (the user who reported it)
	Name        string     `gorm:"not null;size:100" json:"name"`
	Type        string     `gorm:"not null;size:50;index:idx_pets_type_status,composite:type" json:"type"` // perro, gato, pajaro, otro
	Breed       string     `gorm:"size:100" json:"breed,omitempty"`
	Color       string     `gorm:"size:100" json:"color,omitempty"`
	Description string     `gorm:"type:text" json:"description,omitempty"`
	Gender      string     `gorm:"size:10" json:"gender,omitempty"` // male, female, unknown
	MicrochipID *string    `gorm:"uniqueIndex;size:50" json:"microchip_id,omitempty"`
	Status      string     `gorm:"size:50;default:'registered';index:idx_pets_type_status,composite:status" json:"status"` // registered, lost, stray, found, archived
	Version          int        `gorm:"default:1" json:"version"`                                                               // optimistic concurrency — increment on each status change
	CurrentEpisodeID *uuid.UUID `gorm:"type:uuid;index" json:"current_episode_id,omitempty"`
	// ReporterContactPublic is an opt-in (stray pets only): when true, the
	// reporter's profile phone is exposed publicly so logged-out finders can
	// reach them. Defaults false — a good-samaritan's number is never published
	// without explicit consent.
	ReporterContactPublic bool      `gorm:"default:false" json:"reporter_contact_public"`
	CreatedAt             time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt             time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relaciones
	Owner    User     `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	Reporter User     `gorm:"foreignKey:ReporterID" json:"reporter,omitempty"` // populated for stray pets
	Photos   []Photo  `gorm:"foreignKey:PetID" json:"photos,omitempty"`
	Reports  []Report `gorm:"foreignKey:PetID" json:"reports,omitempty"`
}

// Report representa un reporte de ubicación de una mascota
type Report struct {
	ID                  uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID               uuid.UUID  `gorm:"type:uuid;not null;index" json:"pet_id"`
	EpisodeID           *uuid.UUID `gorm:"type:uuid;index" json:"episode_id,omitempty"`
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

// SearchEpisode is one continuous search for a pet: it opens when the pet
// transitions into lost/stray and closes (ended_at + resolution) when it
// leaves that state. Reports created while an episode is open belong to it.
// The global map shows only the pet's CURRENT episode (pets.current_episode_id).
type SearchEpisode struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"pet_id"`
	StartedAt  time.Time  `gorm:"autoCreateTime;index" json:"started_at"`
	EndedAt    *time.Time `json:"ended_at,omitempty"`
	Resolution *string    `gorm:"size:50" json:"resolution,omitempty"`
}

// Photo representa una foto de mascota
type Photo struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID      uuid.UUID `gorm:"type:uuid;not null;index" json:"pet_id"`
	URL        string    `gorm:"not null;size:500" json:"url"`
	PublicID   string    `gorm:"size:500" json:"-"` // Cloudinary public_id, nunca expuesto al cliente
	UploadedBy uuid.UUID `gorm:"type:uuid;not null" json:"uploaded_by"`
	IsPrimary  bool      `gorm:"default:false" json:"is_primary"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// Message representa un mensaje entre usuarios.
// Text puede estar vacío cuando el mensaje es solo una foto (PhotoURL present).
type Message struct {
	ID            uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SenderID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"sender_id"`
	ReceiverID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"receiver_id"`
	ReportID      *uuid.UUID `gorm:"type:uuid" json:"report_id,omitempty"`
	Text          string     `gorm:"type:text" json:"text"`
	ReadAt        *time.Time `gorm:"index" json:"read_at,omitempty"`
	PhotoPublicID string     `gorm:"type:text" json:"-"` // Cloudinary public_id — NUNCA expuesto al cliente
	PhotoURL      string     `gorm:"type:text" json:"photo_url,omitempty"`
	CreatedAt     time.Time  `gorm:"autoCreateTime;index" json:"created_at"`

	// Relaciones
	Sender   User `gorm:"foreignKey:SenderID" json:"sender,omitempty"`
	Receiver User `gorm:"foreignKey:ReceiverID" json:"receiver,omitempty"`
}

// ============================================================
// SHARING & SOCIAL
// ============================================================

// ShareLink representa un link compartible en redes sociales
type ShareLink struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID          uuid.UUID  `gorm:"type:uuid;not null;index" json:"pet_id"`
	ShareToken     string     `gorm:"uniqueIndex;not null;size:50" json:"share_token"`
	Platform       string     `gorm:"size:50" json:"platform,omitempty"` // instagram, facebook, whatsapp, twitter
	ViewCount      int        `gorm:"default:0" json:"view_count"`
	ClickedContact int        `gorm:"default:0" json:"clicked_contact"`
	CreatedAt      time.Time  `gorm:"autoCreateTime" json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`

	// Relaciones
	Pet Pet `gorm:"foreignKey:PetID" json:"pet,omitempty"`
}

// ============================================================
// ALERTS & NOTIFICATIONS
// ============================================================

// LocationAlert representa una alerta por ubicación.
// PetID es opcional — las alertas son por zona, no necesariamente por mascota específica.
// PetType permite filtrar por tipo de mascota (e.g. "perro", "gato"); vacío = cualquier tipo.
type LocationAlert struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID         uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"`
	PetID          *uuid.UUID `gorm:"type:uuid;index" json:"pet_id,omitempty"`
	PetType        string     `gorm:"size:50" json:"pet_type,omitempty"`
	Name           string     `gorm:"size:100" json:"name,omitempty"`
	AlertLatitude  float64    `gorm:"type:decimal(10,8);not null" json:"alert_latitude"`
	AlertLongitude float64    `gorm:"type:decimal(11,8);not null" json:"alert_longitude"`
	RadiusKm       float64    `gorm:"type:decimal(5,2);default:5" json:"radius_km"`
	IsActive       bool       `gorm:"default:true;index" json:"is_active"`
	CreatedAt      time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
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
	ShareCount   int       `gorm:"default:0" json:"-"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relaciones
	User User `gorm:"foreignKey:UserID" json:"user,omitempty"`
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

	// Relaciones
	User User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// SuccessStory representa una historia de éxito (mascota encontrada)
type SuccessStory struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	PetID       uuid.UUID  `gorm:"type:uuid;not null;index" json:"pet_id"`
	UserID      uuid.UUID  `gorm:"type:uuid;not null;index" json:"user_id"` // quien crea la historia
	Title       string     `gorm:"size:255" json:"title"`
	Body        string     `gorm:"type:text;not null" json:"body"`
	PhotoBefore string     `gorm:"size:500" json:"photo_before,omitempty"` // URL Cloudinary
	PhotoAfter  string     `gorm:"size:500" json:"photo_after,omitempty"`  // URL Cloudinary
	LikeCount   int        `gorm:"default:0" json:"like_count"`
	Featured    bool       `gorm:"default:false;index" json:"featured"`
	FeaturedBy  *uuid.UUID `gorm:"type:uuid" json:"featured_by,omitempty"` // adminUserID que marcó featured
	CreatedAt   time.Time  `gorm:"autoCreateTime;index" json:"created_at"`
	DeletedAt   *time.Time `gorm:"index" json:"-"` // soft delete

	// Relaciones
	Pet  Pet  `gorm:"foreignKey:PetID" json:"pet,omitempty"`
	User User `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// StoryLike representa el like de un usuario a una historia de éxito.
// UniqueIndex en (story_id, user_id) garantiza un solo like por usuario por historia.
type StoryLike struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	StoryID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_story_likes_story_user;index" json:"story_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_story_likes_story_user" json:"user_id"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// ============================================================
// REVIEWS (V1.5)
// ============================================================

// UserReview representa una reseña de un usuario a otro.
// UniqueIndex en (reviewer_id, reviewee_id) garantiza una sola reseña por par.
type UserReview struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ReviewerID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_reviewer_reviewee" json:"reviewer_id"`
	RevieweeID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_reviewer_reviewee;index" json:"reviewee_id"`
	Stars      int       `gorm:"column:stars;not null;check:stars >= 1 AND stars <= 5" json:"stars"`
	Text       string    `gorm:"column:text;type:text;not null" json:"text"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt  time.Time `gorm:"autoUpdateTime" json:"updated_at"`

	// Relaciones
	Reviewer User `gorm:"foreignKey:ReviewerID" json:"reviewer,omitempty"`
	Reviewee User `gorm:"foreignKey:RevieweeID" json:"reviewee,omitempty"`
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

	// Relaciones
	Blocked User `gorm:"foreignKey:BlockedID" json:"blocked_user,omitempty"`
}

// ReportAbuse representa una denuncia de fraude/abuso
type ReportAbuse struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	TargetReportID *uuid.UUID `gorm:"type:uuid;column:target_report_id" json:"target_report_id,omitempty"`
	TargetUserID   *uuid.UUID `gorm:"type:uuid;column:target_user_id" json:"target_user_id,omitempty"`
	ReporterID     uuid.UUID  `gorm:"type:uuid;not null" json:"reporter_id"`
	Reason         string     `gorm:"not null;size:255" json:"reason"`
	Status         string     `gorm:"not null;size:50;default:'pending';index" json:"status"` // pending, resolved, dismissed
	ResolvedBy     *uuid.UUID `gorm:"type:uuid" json:"resolved_by,omitempty"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
	CreatedAt      time.Time  `gorm:"autoCreateTime;index" json:"created_at"`

	// Associations (admin enrichment) — not serialized raw; exposed via DTO refs.
	Reporter     User    `gorm:"foreignKey:ReporterID" json:"-"`
	TargetUser   *User   `gorm:"foreignKey:TargetUserID" json:"-"`
	TargetReport *Report `gorm:"foreignKey:TargetReportID;constraint:OnDelete:SET NULL" json:"-"`
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

// VerificationToken almacena los OTPs de verificación de identidad.
// CodeHash contiene SHA-256(code) en hex — NUNCA el código en texto plano.
type VerificationToken struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index" json:"user_id"`
	Channel     string    `gorm:"not null;size:10" json:"channel"` // "email" or "sms"
	CodeHash    string    `gorm:"not null;size:64" json:"-"`       // SHA-256 hex — never plaintext
	Attempts    int       `gorm:"default:0" json:"-"`
	ExpiresAt   time.Time `gorm:"not null;index" json:"expires_at"`
	Used        bool      `gorm:"default:false;index" json:"-"`
	TargetPhone string    `gorm:"size:20" json:"-"` // phone number OTP was sent to (sms only)
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
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

// ============================================================
// IMAGE SEARCH (pgvector + CLIP embeddings)
// ============================================================

// PetEmbedding stores the CLIP vector embedding for a pet photo.
// IMPORTANT: this model is NOT registered in AutoMigrate — the table is
// created exclusively via migration 000009_add_pgvector_embeddings.
type PetEmbedding struct {
	ID        uuid.UUID       `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	PetID     uuid.UUID       `gorm:"type:uuid;not null;index"`
	PhotoID   uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex"`
	Embedding pgvector.Vector `gorm:"type:vector(512);not null"`
	ModelVer  string          `gorm:"size:50;not null;default:'clip-vit-base-patch32'"`
	CreatedAt time.Time       `gorm:"autoCreateTime"`
}

// ImageSearchResult is the read model returned by PetEmbeddingRepository.FindSimilar.
// It is not a database entity — it is populated via a raw SQL query that joins
// pet_embeddings, pets and photos.
type ImageSearchResult struct {
	PetID      uuid.UUID
	PetName    string
	PetType    string
	Status     string
	PrimaryURL string  // URL of the best-matching photo
	Similarity float64 // 1 - cosine_distance (higher = more similar)
	OwnerID    uuid.UUID
}

// ============================================================
// ADMIN AUDIT
// ============================================================

// AdminAuditLog records every admin-role change made through the app (not the CLI).
// Actor/target emails are snapshotted so the log stays readable even if a user is
// later deleted.
type AdminAuditLog struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	ActorID     uuid.UUID `gorm:"type:uuid;not null;index" json:"actor_id"`
	TargetID    uuid.UUID `gorm:"type:uuid;not null;index" json:"target_id"`
	ActorEmail  string    `gorm:"size:255" json:"actor_email"`
	TargetEmail string    `gorm:"size:255" json:"target_email"`
	Action      string    `gorm:"size:20;not null;check:action IN ('grant','revoke')" json:"action"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// Admin-role audit actions. The DB enforces these via the CHECK constraint on
// AdminAuditLog.Action above; keep both in sync.
const (
	AdminActionGrant  = "grant"
	AdminActionRevoke = "revoke"
)

// Role-change listing bounds, shared by the handler (page size) and the
// repository (clamp). Single source of truth so the two layers can't drift.
const (
	DefaultRoleChangeLimit = 50
	MaxRoleChangeLimit     = 200
)
