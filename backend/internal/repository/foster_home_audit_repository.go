package repository

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresFosterHomeAuditRepository struct {
	db *gorm.DB
}

func NewFosterHomeAuditRepository(db *gorm.DB) FosterHomeAuditRepository {
	return &postgresFosterHomeAuditRepository{db: db}
}

func (r *postgresFosterHomeAuditRepository) CreateModerationLog(ctx context.Context, l *domain.FosterHomeModerationLog) error {
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *postgresFosterHomeAuditRepository) ListModerationLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeModerationLog, error) {
	var list []domain.FosterHomeModerationLog
	err := r.db.WithContext(ctx).Where("foster_home_id = ?", fhID).
		Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *postgresFosterHomeAuditRepository) CreateChangeLog(ctx context.Context, l *domain.FosterHomeChangeLog) error {
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *postgresFosterHomeAuditRepository) ListChangeLogs(ctx context.Context, fhID uuid.UUID) ([]domain.FosterHomeChangeLog, error) {
	var list []domain.FosterHomeChangeLog
	err := r.db.WithContext(ctx).Where("foster_home_id = ?", fhID).
		Order("created_at DESC").Find(&list).Error
	return list, err
}

var _ FosterHomeAuditRepository = (*postgresFosterHomeAuditRepository)(nil)
