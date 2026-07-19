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
	// FindByReporterID returns the pets a user reported (stray pets carry the
	// reporter's id; they have no owner).
	FindByReporterID(reporterID string) ([]domain.Pet, error)
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
	// Delete removes a report by id (admin moderation). Returns ErrReportNotFound if absent.
	Delete(ctx context.Context, id uuid.UUID) error
	// SetEpisodeID stamps an existing report with its search episode ID.
	SetEpisodeID(reportID string, episodeID uuid.UUID) error
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
	// MarkConversationUnread marca como NO leído el último mensaje recibido por
	// receiverID desde senderID. No-op silencioso si no hay mensajes recibidos.
	MarkConversationUnread(ctx context.Context, receiverID, senderID uuid.UUID) error
	// CountUnread retorna la cantidad de mensajes no leídos recibidos por userID.
	CountUnread(ctx context.Context, userID uuid.UUID) (int64, error)
}

// ConversationHideRepository define el contrato para ocultamientos de conversación.
type ConversationHideRepository interface {
	// Upsert crea el ocultamiento (userID oculta su conversación con otherUserID)
	// o refresca hidden_at si ya existía.
	Upsert(ctx context.Context, userID, otherUserID uuid.UUID) error
}

// ShareLinkRepository define el contrato para acceder a datos de links compartibles.
type ShareLinkRepository interface {
	Create(ctx context.Context, link *domain.ShareLink) error
	GetByToken(ctx context.Context, token string) (*domain.ShareLink, error)
	GetByPetID(ctx context.Context, petID uuid.UUID) ([]domain.ShareLink, error)
	// GetOrCreateForPet atomically returns the pet's most recent share link or,
	// if none exists, creates one via build(). Concurrent first-time creates for
	// the same pet are serialized so anonymous callers can't insert duplicates.
	GetOrCreateForPet(ctx context.Context, petID uuid.UUID, build func() (*domain.ShareLink, error)) (*domain.ShareLink, error)
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
	// GetAll retorna SOLO refugios approved — es el listado del directorio público.
	GetAll(ctx context.Context, city string, isVerified *bool) ([]domain.Shelter, error)
	// GetByOwner retorna el refugio del usuario. ErrShelterNotFound si no tiene.
	GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.Shelter, error)
	// GetPendingQueue retorna la cola de revisión admin: registros pending +
	// approved con cambios de links staged. Más viejos primero (FIFO).
	GetPendingQueue(ctx context.Context) ([]domain.Shelter, error)
	Update(ctx context.Context, shelter *domain.Shelter) error
}

// FosterHomeRepository define el contrato para acceder a datos de hogares transitorios.
type FosterHomeRepository interface {
	Create(ctx context.Context, fh *domain.FosterHome) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.FosterHome, error)
	GetByOwner(ctx context.Context, ownerID uuid.UUID) (*domain.FosterHome, error)
	GetApproved(ctx context.Context, city, animalType string) ([]domain.FosterHome, error)
	GetPendingQueue(ctx context.Context) ([]domain.FosterHome, error)
	Update(ctx context.Context, fh *domain.FosterHome) error
}

// FosterHomePhotoRepository define el contrato para fotos del hogar.
type FosterHomePhotoRepository interface {
	Create(ctx context.Context, p *domain.FosterHomePhoto) error
	CountByFosterHome(ctx context.Context, fhID uuid.UUID) (int64, error)
	FindByFosterHome(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomePhoto, error)
	FindByID(ctx context.Context, id uuid.UUID) (*domain.FosterHomePhoto, error)
	DeleteByID(ctx context.Context, id uuid.UUID) error
}

// FosterHomeAuditRepository persiste los rastros append-only (nunca se borra).
type FosterHomeAuditRepository interface {
	CreateModerationLog(ctx context.Context, l *domain.FosterHomeModerationLog) error
	ListModerationLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeModerationLog, error)
	CreateChangeLog(ctx context.Context, l *domain.FosterHomeChangeLog) error
	ListChangeLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeChangeLog, error)
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
	CountAll(ctx context.Context, resolved *bool) (int64, error)
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
	CountAll(ctx context.Context, featured *bool) (int64, error)
	AddLike(ctx context.Context, storyID, userID uuid.UUID) (added bool, newCount int, err error)
	RemoveLike(ctx context.Context, storyID, userID uuid.UUID) (removed bool, newCount int, err error)
	LikedStoryIDs(ctx context.Context, userID uuid.UUID, storyIDs []uuid.UUID) (map[uuid.UUID]bool, error)
	SetFeatured(ctx context.Context, id uuid.UUID, featured bool, featuredBy uuid.UUID) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// BadgeRepository define el contrato para acceder a logros/badges de usuarios.
// Style A: context.Context + uuid.UUID.
type BadgeRepository interface {
	Create(ctx context.Context, badge *domain.Badge) error
	HasBadge(ctx context.Context, userID uuid.UUID, badgeType string) (bool, error)
	FindByUserID(ctx context.Context, userID uuid.UUID) ([]domain.Badge, error)
	// FindByUserIDs retorna los badges de varios usuarios en una sola query (evita N+1).
	FindByUserIDs(ctx context.Context, userIDs []uuid.UUID) ([]domain.Badge, error)
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

// UserReviewRepository define el contrato para acceder a reseñas de usuarios.
// Style A: context.Context + uuid.UUID.
type UserReviewRepository interface {
	Create(ctx context.Context, review *domain.UserReview) error
	Update(ctx context.Context, review *domain.UserReview) error
	FindByReviewee(ctx context.Context, revieweeID uuid.UUID, limit, offset int) ([]domain.UserReview, error)
	FindByReviewerAndReviewee(ctx context.Context, reviewerID, revieweeID uuid.UUID) (*domain.UserReview, error)
	GetAverageRating(ctx context.Context, revieweeID uuid.UUID) (float64, int, error) // avg, count, err
	// Delete elimina de forma permanente la reseña del par (reviewerID, revieweeID).
	// Retorna ErrReviewNotFound si no existe ninguna reseña con ese par.
	Delete(ctx context.Context, reviewerID, revieweeID uuid.UUID) error
}

// PetEmbeddingRepository stores and queries CLIP vector embeddings for pet photos.
// Style A: context.Context + uuid.UUID.
// NOTE: The backing table (pet_embeddings) is managed exclusively via SQL migration
// 000009_add_pgvector_embeddings — it is NOT included in GORM AutoMigrate.
type PetEmbeddingRepository interface {
	// Upsert inserts or updates the embedding row keyed by photo_id.
	Upsert(ctx context.Context, emb *domain.PetEmbedding) error
	// FindSimilar returns up to limit lost pets ranked by cosine similarity to queryVec.
	// Results are deduplicated by pet_id (best-matching photo per pet wins).
	FindSimilar(ctx context.Context, queryVec []float32, limit int) ([]domain.ImageSearchResult, error)
	// DeleteByPetID removes all embedding rows for the given pet (called on pet.found).
	DeleteByPetID(ctx context.Context, petID uuid.UUID) error
}

// EpisodeRepository manages search episodes (one continuous search per pet).
type EpisodeRepository interface {
	// Open inserts a new open episode and points pets.current_episode_id at it.
	Open(petID string) (*domain.SearchEpisode, error)
	// CloseCurrent sets ended_at=now and resolution on the pet's OPEN episode
	// (ended_at IS NULL). No-op if the pet has no open episode.
	CloseCurrent(petID string, resolution string) error
	// FindCurrent returns the pet's most-recently-started episode, or nil.
	FindCurrent(petID string) (*domain.SearchEpisode, error)
}

// VetRepository persiste y consulta veterinarias importadas de OSM.
type VetRepository interface {
	Upsert(ctx context.Context, vet *domain.Vet) error
	FindNearby(ctx context.Context, lat, lng, radiusMeters float64, limit int) ([]domain.VetNearbyResult, error)
}

// AdminRepository owns admin-role mutations that must be atomic with their audit
// trail, plus the admin count used for the last-admin guard.
// Style A: context.Context + uuid.UUID.
type AdminRepository interface {
	// SetAdminWithAudit flips users.is_admin for targetID and inserts the audit
	// row in the same transaction. Either both happen or neither does.
	SetAdminWithAudit(ctx context.Context, targetID uuid.UUID, grant bool, entry *domain.AdminAuditLog) error
	// CountAdmins returns how many users currently have is_admin = true.
	CountAdmins(ctx context.Context) (int64, error)
	// ListRoleChanges returns a page of audit rows, newest first.
	ListRoleChanges(ctx context.Context, limit, offset int) ([]domain.AdminAuditLog, error)
	// CountRoleChanges returns the total number of audit rows.
	CountRoleChanges(ctx context.Context) (int64, error)
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
