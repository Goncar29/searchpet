package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
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
		if err := tx.Model(&domain.User{}).Where("id = ?", targetID).Update("is_admin", grant).Error; err != nil {
			return err
		}
		return tx.Create(entry).Error
	})
}

func (r *postgresAdminRepository) CountAdmins(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.User{}).Where("is_admin = ?", true).Count(&n).Error
	return n, err
}

func (r *postgresAdminRepository) ListRoleChanges(ctx context.Context, limit int) ([]domain.AdminAuditLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var entries []domain.AdminAuditLog
	err := r.db.WithContext(ctx).Order("created_at DESC").Limit(limit).Find(&entries).Error
	return entries, err
}
