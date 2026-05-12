package repository

import (
	"context"

	"github.com/google/uuid"
	"lost-pets/internal/domain"
	"lost-pets/internal/dto"
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
	Search(filters dto.PetSearchFilters) ([]domain.Pet, int64, error)
}

// ReportRepository define el contrato para acceder a datos de reportes.
type ReportRepository interface {
	Create(report *domain.Report) error
	FindByID(id string) (*domain.Report, error)
	FindByPetID(petID string) ([]domain.Report, error)
	FindNearby(lat, lng float64, radiusMeters float64) ([]domain.Report, error)
}

// PhotoRepository define el contrato para acceder a datos de fotos de mascotas.
type PhotoRepository interface {
	Create(photo *domain.Photo) error
	FindByPetID(petID string) ([]domain.Photo, error)
	HasPrimaryPhoto(petID string) (bool, error)
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

// LocationAlertRepository define el contrato para alertas de ubicación.
// Style A: context.Context + uuid.UUID.
type LocationAlertRepository interface {
	Create(ctx context.Context, alert *domain.LocationAlert) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.LocationAlert, error)
	GetByUserID(ctx context.Context, userID uuid.UUID) ([]domain.LocationAlert, error)
	Update(ctx context.Context, alert *domain.LocationAlert) error
	// Delete hace soft-delete: pone IsActive = false en lugar de borrar el registro.
	Delete(ctx context.Context, id uuid.UUID) error
	// FindMatchingAlerts retorna todas las alertas activas cuyo radio cubre el punto (lat, lng).
	// Usa PostGIS ST_DWithin con geography para cálculo geodésico preciso (single DB call).
	// petType "" coincide con cualquier tipo de mascota.
	FindMatchingAlerts(ctx context.Context, lat, lng float64, petType string) ([]domain.LocationAlert, error)
	// CountActiveByUserID retorna cuántas alertas activas tiene el usuario.
	// Usado para aplicar el cap de 10 alertas por usuario.
	CountActiveByUserID(ctx context.Context, userID uuid.UUID) (int64, error)
}
