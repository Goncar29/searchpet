package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresBlockedUserRepository struct {
	db *gorm.DB
}

// NewBlockedUserRepository construye un BlockedUserRepository respaldado por PostgreSQL.
func NewBlockedUserRepository(db *gorm.DB) BlockedUserRepository {
	return &postgresBlockedUserRepository{db: db}
}

// Create persiste un nuevo bloqueo en la BD.
func (r *postgresBlockedUserRepository) Create(ctx context.Context, block *domain.BlockedUser) error {
	return r.db.WithContext(ctx).Create(block).Error
}

// Delete elimina un bloqueo dirigido (blocker → blocked).
// Retorna ErrBlockNotFound si no existe ningún registro para ese par.
func (r *postgresBlockedUserRepository) Delete(ctx context.Context, blockerID, blockedID uuid.UUID) error {
	result := r.db.WithContext(ctx).
		Where("blocker_id = ? AND blocked_id = ?", blockerID, blockedID).
		Delete(&domain.BlockedUser{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return domain.ErrBlockNotFound
	}
	return nil
}

// IsBlocked verifica si existe un bloqueo en cualquier dirección entre userA y userB.
// Retorna true si A bloqueó a B O si B bloqueó a A.
func (r *postgresBlockedUserRepository) IsBlocked(ctx context.Context, userA, userB uuid.UUID) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&domain.BlockedUser{}).
		Where(
			"(blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
			userA, userB, userB, userA,
		).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetBlockedByUserID retorna todos los usuarios bloqueados por blockerID.
func (r *postgresBlockedUserRepository) GetBlockedByUserID(ctx context.Context, userID uuid.UUID) ([]domain.BlockedUser, error) {
	var blocks []domain.BlockedUser
	err := r.db.WithContext(ctx).
		Where("blocker_id = ?", userID).
		Order("created_at DESC").
		Preload("Blocked").
		Find(&blocks).Error
	return blocks, err
}

// Verificación estática: postgresBlockedUserRepository satisface BlockedUserRepository.
var _ BlockedUserRepository = (*postgresBlockedUserRepository)(nil)
