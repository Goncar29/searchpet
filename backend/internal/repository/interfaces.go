package repository

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
)

// ============================================================
// Style B repositories (legado — sin context, string IDs)
// NO modificar firmas — usadas por servicios existentes.
// ============================================================

// PetRepository define el contrato para acceder a datos de mascotas.
type PetRepository interface {
	Create(pet *domain.Pet) error
	FindByID(id string) (*domain.Pet, error)
	FindByOwnerID(ownerID string) ([]domain.Pet, error)
	Update(pet *domain.Pet) error
	UpdateStatus(id string, status string) error
	Delete(id string) error
	// Search aplica filtros opcionales, devuelve los resultados paginados y el total.
	Search(criteria domain.PetSearchCriteria) ([]domain.Pet, int64, error)
}

// ReportRepository define el contrato para acceder a datos de reportes.
type ReportRepository interface {
	Create(report *domain.Report) error
	FindByID(id string) (*domain.Report, error)
	FindByPetID(petID string) ([]domain.Report, error)
	FindNearby(lat, lng float64, radiusMeters float64) ([]domain.Report, error)
	// UpdateVerified marca un reporte como verificado y registra quién lo verificó.
	// Style A para el nuevo método.
	UpdateVerified(ctx context.Context, id uuid.UUID, verifiedBy uuid.UUID) error
}

// PhotoRepository define el contrato para acceder a datos de fotos de mascotas.
type PhotoRepository interface {
	Create(photo *domain.Photo) error
	FindByPetID(petID string) ([]domain.Photo, error)
	FindByID(photoID string) (*domain.Photo, error)
	HasPrimaryPhoto(petID string) (bool, error)
	UnsetPrimaryPhotos(petID string) error
	CountByPetID(petID string) (int64, error)
	DeleteByPetID(petID string) error
	DeleteByID(photoID string) error
}

// ============================================================
// Style A repositories (context.Context, uuid.UUID)
// ============================================================

// UserRepository define el contrato para acceder a datos de usuarios.
type UserRepository interface {
	Create(ctx context.Context, user *domain.User) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.User, error)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	Update(ctx context.Context, user *domain.User) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// MessageRepository define el contrato para acceder a datos de mensajes.
type MessageRepository interface {
	Create(ctx context.Context, message *domain.Message) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	GetConversation(ctx context.Context, userA, userB uuid.UUID, limit, offset int) ([]domain.Message, error)
	GetConversations(ctx context.Context, userID uuid.UUID) ([]domain.Message, error)
	MarkAsRead(ctx context.Context, messageID uuid.UUID) error
	// MarkConversationRead marca como leídos todos los mensajes sin leer de una conversación
	// donde receiverID es el destinatario y senderID es el remitente.
	MarkConversationRead(ctx context.Context, receiverID, senderID uuid.UUID) error
	// CountUnread retorna la cantidad de mensajes no leídos recibidos por userID.
	CountUnread(ctx context.Context, userID uuid.UUID) (int64, error)
}

// FavoriteRepository define el contrato para acceder a datos de favoritos.
type FavoriteRepository interface {
	Create(ctx context.Context, favorite *domain.Favorite) error
	Delete(ctx context.Context, userID, petID uuid.UUID) error
	GetByUserID(ctx context.Context, userID uuid.UUID, limit, offset int) ([]domain.Favorite, error)
	IsFavorited(ctx context.Context, userID, petID uuid.UUID) (bool, error)
}

// ShareLinkRepository define el contrato para acceder a datos de links compartibles.
type ShareLinkRepository interface {
	Create(ctx context.Context, link *domain.ShareLink) error
	GetByToken(ctx context.Context, token string) (*domain.ShareLink, error)
	GetByPetID(ctx context.Context, petID uuid.UUID) ([]domain.ShareLink, error)
	IncrementViewCount(ctx context.Context, id uuid.UUID) error
	IncrementClickedContact(ctx context.Context, id uuid.UUID) error
}

// BlockedUserRepository define el contrato para acceder a datos de bloqueos.
type BlockedUserRepository interface {
	Create(ctx context.Context, block *domain.BlockedUser) error
	Delete(ctx context.Context, blockerID, blockedID uuid.UUID) error
	IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error)
	GetBlockedByUserID(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error)
}

// ShelterRepository define el contrato para acceder a datos de refugios.
type ShelterRepository interface {
	Create(ctx context.Context, shelter *domain.Shelter) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Shelter, error)
	GetAll(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error)
	Update(ctx context.Context, shelter *domain.Shelter) error
}

// DeviceTokenRepository define el contrato para acceder a tokens FCM de dispositivos.
// Style A: context.Context + uuid.UUID.
type DeviceTokenRepository interface {
	Upsert(ctx context.Context, token *domain.DeviceToken) error
	FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.DeviceToken, error)
	DeleteByToken(ctx context.Context, token string) error
}

// VerificationTokenRepository define el contrato para tokens OTP de verificación.
// Style A: context.Context + uuid.UUID.
type VerificationTokenRepository interface {
	Create(ctx context.Context, token *domain.VerificationToken) error
	// FindActiveByUser retorna un token activo (used=false AND expires_at > NOW()) para el canal dado.
	FindActiveByUser(ctx context.Context, userID uuid.UUID, channel string) (*domain.VerificationToken, error)
	MarkUsed(ctx context.Context, id uuid.UUID) error
	// IncrementAttempts incrementa el contador de intentos de forma atómica y retorna el nuevo valor.
	IncrementAttempts(ctx context.Context, id uuid.UUID) (int, error)
	// DeleteExpired elimina tokens expirados y retorna la cantidad eliminada.
	DeleteExpired(ctx context.Context) (int64, error)
}

// AbuseReportRepository define el contrato para denuncias de fraude/abuso.
// Style A: context.Context + uuid.UUID.
type AbuseReportRepository interface {
	Create(ctx context.Context, report *domain.ReportAbuse) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.ReportAbuse, error)
	GetAll(ctx context.Context, resolved *bool, limit, offset int) ([]domain.ReportAbuse, error)
	Resolve(ctx context.Context, id uuid.UUID, resolvedBy uuid.UUID, status string) error
}

// LocalGroupRepository define el contrato para grupos locales por ciudad.
// Style A: context.Context + uuid.UUID.
type LocalGroupRepository interface {
	Create(ctx context.Context, group *domain.LocalGroup) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error)
	GetAll(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error)
	IncrementMemberCount(ctx context.Context, id uuid.UUID) error
	DecrementMemberCount(ctx context.Context, id uuid.UUID) error
}

// GroupMemberRepository define el contrato para miembros de grupos.
// Style A: context.Context + uuid.UUID.
type GroupMemberRepository interface {
	Create(ctx context.Context, member *domain.GroupMember) error
	Delete(ctx context.Context, groupID, userID uuid.UUID) error
	IsMember(ctx context.Context, groupID, userID uuid.UUID) (bool, error)
	GetByGroupID(ctx context.Context, groupID uuid.UUID, limit, offset int) ([]domain.GroupMember, error)
}

// SuccessStoryRepository define el contrato para acceder a historias de éxito.
// Style A: context.Context + uuid.UUID.
type SuccessStoryRepository interface {
	Create(ctx context.Context, story *domain.SuccessStory) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.SuccessStory, error)
	GetByPetID(ctx context.Context, petID uuid.UUID) (*domain.SuccessStory, error)
	GetAll(ctx context.Context, featured *bool, limit, offset int) ([]domain.SuccessStory, error)
	IncrementLikes(ctx context.Context, id uuid.UUID) error
	SetFeatured(ctx context.Context, id uuid.UUID, featured bool, featuredBy uuid.UUID) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// BadgeRepository define el contrato para acceder a logros/badges de usuarios.
// Style A: context.Context + uuid.UUID.
type BadgeRepository interface {
	Create(ctx context.Context, badge *domain.Badge) error
	HasBadge(ctx context.Context, userID uuid.UUID, badgeType string) (bool, error)
	FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.Badge, error)
}

// UserPointsRepository define el contrato para acceder a puntos de gamificación.
// Style A: context.Context + uuid.UUID.
type UserPointsRepository interface {
	// Upsert crea o incrementa puntos para el usuario. pointsDelta se suma a points y al campo field
	// (total_reports, found_count, share_count). Retorna el registro actualizado.
	Upsert(ctx context.Context, userID uuid.UUID, pointsDelta int, field string) (*domain.UserPoints, error)
	GetByUserID(ctx context.Context, userID uuid.UUID) (*domain.UserPoints, error)
	FindLeaderboard(ctx context.Context, city string, limit int) ([]domain.UserPoints, error)
}

// LocationAlertRepository define el contrato para alertas de ubicación.
// Style A: context.Context + uuid.UUID.
type LocationAlertRepository interface {
	Create(ctx context.Context, alert *domain.LocationAlert) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.LocationAlert, error)
	GetByUserID(ctx context.Context, userID uuid.UUID) ([]domain.LocationAlert, error)
	Update(ctx context.Context, alert *domain.LocationAlert) error
	// Delete hace soft-delete: pone IsActive = false en lugar de borrar el registro.
	Delete(ctx context.Context, id uuid.UUID) error
	// FindActiveAlertsNear retorna todas las alertas activas cuyo radio cubre el punto (lat, lng).
	// Usa PostGIS ST_DWithin con geography para cálculo geodésico preciso (single DB call).
	// petType "" coincide con cualquier tipo de mascota.
	FindActiveAlertsNear(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error)
	// CountActiveByUserID retorna cuántas alertas activas tiene el usuario.
	// Usado para aplicar el cap de 10 alertas por usuario.
	CountActiveByUserID(ctx context.Context, userID uuid.UUID) (int64, error)
}
