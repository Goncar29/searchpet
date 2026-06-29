package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"lost-pets/internal/domain"
)

type postgresAdminRepository struct {
	db *gorm.DB
}

// NewAdminRepository crea el repositorio de operaciones de admin.
func NewAdminRepository(db *gorm.DB) AdminRepository {
	return &postgresAdminRepository{db: db}
}

func (r *postgresAdminRepository) SetAdminWithAudit(ctx context.Context, targetID uuid.UUID, grant bool, entry *domain.AdminAuditLog) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Atomic last-admin guard. When revoking, lock every admin row (FOR UPDATE)
		// so concurrent revokes serialize here instead of each reading a stale count.
		// Without this, two simultaneous revokes of two different admins both pass a
		// non-transactional count check and leave zero admins (TOCTOU). The service
		// also does an early count for a fast error, but THIS is the authoritative
		// invariant.
		if !grant {
			var admins []domain.User
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("is_admin = ?", true).
				Find(&admins).Error; err != nil {
				return err
			}
			if len(admins) <= 1 {
				return domain.ErrCannotRevokeLastAdmin
			}
		}

		result := tx.Model(&domain.User{}).Where("id = ?", targetID).Update("is_admin", grant)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return domain.ErrUserNotFound
		}
		return tx.Create(entry).Error
	})
}

func (r *postgresAdminRepository) CountAdmins(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.User{}).Where("is_admin = ?", true).Count(&n).Error
	return n, err
}

func (r *postgresAdminRepository) ListRoleChanges(ctx context.Context, limit, offset int) ([]domain.AdminAuditLog, error) {
	if limit <= 0 || limit > domain.MaxRoleChangeLimit {
		limit = domain.DefaultRoleChangeLimit
	}
	if offset < 0 {
		offset = 0
	}
	var entries []domain.AdminAuditLog
	// Tiebreak on id so paging stays stable when rows share created_at — otherwise
	// OFFSET can duplicate or skip rows across page boundaries.
	err := r.db.WithContext(ctx).Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&entries).Error
	return entries, err
}

func (r *postgresAdminRepository) CountRoleChanges(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.AdminAuditLog{}).Count(&n).Error
	return n, err
}
