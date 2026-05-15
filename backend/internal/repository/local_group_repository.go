package repository

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"lost-pets/internal/domain"
)

type postgresLocalGroupRepository struct {
	db *gorm.DB
}

// NewLocalGroupRepository construye el repositorio de grupos locales.
func NewLocalGroupRepository(db *gorm.DB) LocalGroupRepository {
	return &postgresLocalGroupRepository{db: db}
}

func (r *postgresLocalGroupRepository) Create(ctx context.Context, group *domain.LocalGroup) error {
	err := r.db.WithContext(ctx).Create(group).Error
	if err != nil {
		// Unique constraint en city → caller interpreta como 409 Conflict
		if strings.Contains(err.Error(), "duplicate key") ||
			strings.Contains(err.Error(), "unique constraint") ||
			strings.Contains(err.Error(), "23505") {
			return domain.ErrCityGroupExists
		}
		return err
	}
	return nil
}

func (r *postgresLocalGroupRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.LocalGroup, error) {
	var group domain.LocalGroup
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&group).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrGroupNotFound
		}
		return nil, err
	}
	return &group, nil
}

func (r *postgresLocalGroupRepository) GetAll(ctx context.Context, city string, limit, offset int) ([]domain.LocalGroup, error) {
	var groups []domain.LocalGroup
	q := r.db.WithContext(ctx)
	if city != "" {
		q = q.Where("city ILIKE ?", "%"+city+"%")
	}
	if limit <= 0 {
		limit = 20
	}
	err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&groups).Error
	return groups, err
}

// IncrementMemberCount incrementa member_count de forma atómica.
func (r *postgresLocalGroupRepository) IncrementMemberCount(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.LocalGroup{}).
		Where("id = ?", id).
		UpdateColumn("member_count", gorm.Expr("member_count + 1")).Error
}

// DecrementMemberCount decrementa member_count de forma atómica (no baja de 0).
func (r *postgresLocalGroupRepository) DecrementMemberCount(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Model(&domain.LocalGroup{}).
		Where("id = ? AND member_count > 0", id).
		UpdateColumn("member_count", gorm.Expr("member_count - 1")).Error
}
